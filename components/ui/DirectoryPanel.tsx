"use client";

import { useMemo, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SubGroup } from "@/components/ui/panels/shared";
import { generateCity, type Building } from "@/lib/seed/cityGen";
import { buildPersonaDirectory, type Persona, type PersonaId } from "@/lib/seed/personas";
import { focusBuilding } from "@/lib/scene/focusBuilding";

// City Directory: a settings-drawer section (not a floating overlay like
// BuildingInfoPanel/PersonaPanel) that surfaces the persona directory as a
// browsable phone book — a seeded "who's up tonight" spotlight, a name
// search, and a district → building → household browse tree. Every list is
// recomputed from the seed in the useMemo below; nothing derived is stored in
// Zustand (only query text and the spotlight step are UI-only React state).

const MAX_SEARCH_RESULTS = 20;

// Deterministic index into an array of length `mod`, seeded on the master
// seed's own characters (FNV-1a) — never Math.random/Date.now. Gives every
// city a stable "resident of the night" without needing entropy to pick one.
function hashSeedIndex(seed: string, mod: number): number {
  if (mod <= 0) return 0;
  let h = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % mod;
}

type DistrictAgg = {
  id: string;
  properName: string;
  displayName: string;
  residentCount: number;
  buildings: Array<{ buildingId: number; label: string; householdCount: number }>;
};

export function DirectorySection() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  // citySize/citySketch don't feed generateCity's args directly, but are
  // listed as memo deps (matching BuildingInfoPanel/PersonaPanel's memo) so a
  // tier/sketch switch rebuilds the directory instead of serving a stale one.
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const pushColumn = useSceneStore((s) => s.pushColumn);
  const resetColumns = useSceneStore((s) => s.resetColumns);

  const [query, setQuery] = useState("");
  const [spotlightStep, setSpotlightStep] = useState(0);
  // Reset the spotlight step when the seed changes — adjust state during
  // render (React docs pattern, same idiom as CameraPanel's SeedRow) rather
  // than an effect.
  const [prevSeed, setPrevSeed] = useState(masterSeed);
  if (masterSeed !== prevSeed) {
    setPrevSeed(masterSeed);
    setSpotlightStep(0);
  }

  const { directory, idToBuilding, adults, nameIndex, districtList } = useMemo(() => {
    void citySize;
    void citySketch;
    const directory = buildPersonaDirectory(masterSeed, cityShape, cityShapeScale);
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    const idToBuilding = new Map<number, Building>(buildings.map((b) => [b.id, b]));
    const idToDistrict = new Map(districts.map((d) => [d.id, d]));

    // Adults for the spotlight, in the directory's own (building-ascending,
    // order-stable) iteration order.
    const adults: Persona[] = [];
    // Lowercase name index for search, built once here rather than per keystroke.
    const nameIndex: Array<{ id: PersonaId; lower: string }> = [];
    for (const p of directory.personas.values()) {
      if (p.age >= 18) adults.push(p);
      nameIndex.push({ id: p.id, lower: p.fullName.toLowerCase() });
    }

    // Per-district aggregates: resident count + the buildings that host a
    // featured household, sorted by household count within the district.
    const byDistrict = new Map<string, DistrictAgg>();
    for (const [buildingId, households] of directory.byHomeBuilding) {
      const building = idToBuilding.get(buildingId);
      if (!building) continue;
      const districtId = building.districtId;
      let agg = byDistrict.get(districtId);
      if (!agg) {
        agg = {
          id: districtId,
          properName: directory.names.districtNames.get(districtId) ?? districtId,
          displayName: idToDistrict.get(districtId)?.displayName ?? districtId,
          residentCount: 0,
          buildings: [],
        };
        byDistrict.set(districtId, agg);
      }
      agg.residentCount += households.reduce((sum, hh) => sum + hh.memberIds.length, 0);
      const buildingName = directory.names.buildingNames.get(buildingId);
      const address = directory.names.addresses.get(buildingId);
      const label =
        buildingName ?? (address ? `${address.number} ${address.street}` : `Building #${buildingId}`);
      agg.buildings.push({ buildingId, label, householdCount: households.length });
    }
    const districtList = [...byDistrict.values()].sort((a, b) => b.residentCount - a.residentCount);
    for (const d of districtList) d.buildings.sort((a, b) => b.householdCount - a.householdCount);

    return { directory, idToBuilding, adults, nameIndex, districtList };
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  const spotlightIndex =
    adults.length > 0 ? (hashSeedIndex(masterSeed, adults.length) + spotlightStep) % adults.length : -1;
  const spotlight = spotlightIndex >= 0 ? adults[spotlightIndex] : undefined;

  const trimmedQuery = query.trim().toLowerCase();
  const allMatches = trimmedQuery ? nameIndex.filter((n) => n.lower.includes(trimmedQuery)) : [];
  const shownMatches = allMatches.slice(0, MAX_SEARCH_RESULTS);

  const goToBuilding = (buildingId: number) => {
    const building = idToBuilding.get(buildingId);
    if (building) focusBuilding(building);
    resetColumns(
      building
        ? [
            { kind: "district", id: building.districtId },
            { kind: "building", id: buildingId },
          ]
        : [{ kind: "building", id: buildingId }],
    );
  };

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="text-muted-foreground text-sm">
        {directory.names.city.name} · {directory.totals.personas.toLocaleString()} residents ·{" "}
        {directory.totals.businesses.toLocaleString()} businesses
      </div>

      {spotlight && (
        <div className="border-foreground/10 bg-foreground/[0.03] flex flex-col gap-1.5 rounded-lg border p-2.5">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => pushColumn({ kind: "persona", id: spotlight.id })}
              className="flex min-w-0 flex-col text-left hover:underline"
            >
              <span className="truncate text-sm font-medium">{spotlight.fullName}</span>
              {spotlight.story.epithet && (
                <span className="text-muted-foreground truncate text-sm italic">
                  {spotlight.story.epithet}
                </span>
              )}
            </button>
            <Button
              variant="secondary"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => setSpotlightStep((n) => n + 1)}
            >
              Next
            </Button>
          </div>
          <div className="text-muted-foreground text-sm">
            {spotlight.age} · {spotlight.pronouns} ·{" "}
            {directory.names.districtNames.get(spotlight.homeDistrictId) ?? spotlight.homeDistrictId}
          </div>
          {spotlight.story.hook && (
            <div className="border-l-2 pl-2 text-sm italic">{spotlight.story.hook}</div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search residents…"
          aria-label="Search residents"
          className="h-8"
        />
        {trimmedQuery && (
          <div className="flex flex-col gap-0.5">
            {allMatches.length > MAX_SEARCH_RESULTS && (
              <div className="text-muted-foreground px-1 text-sm">{allMatches.length} matches</div>
            )}
            {allMatches.length === 0 && (
              <div className="text-muted-foreground px-1 text-sm">No residents match &quot;{query.trim()}&quot;.</div>
            )}
            {shownMatches.map(({ id }) => {
              const persona = directory.personas.get(id);
              if (!persona) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => pushColumn({ kind: "persona", id })}
                  className="hover:bg-foreground/10 -mx-1 flex items-center justify-between gap-2 rounded px-1 text-left text-sm"
                >
                  <span className="truncate">{persona.fullName}</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {persona.age} ·{" "}
                    {directory.names.districtNames.get(persona.homeDistrictId) ?? persona.homeDistrictId}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      <ScrollArea className="max-h-[50vh]">
        <div className="flex flex-col gap-0.5 pr-2">
          {districtList.map((d) => (
            <SubGroup
              key={d.id}
              label={d.properName}
              action={
                <span className="text-muted-foreground text-[11px] normal-case">
                  {d.displayName} · {d.residentCount.toLocaleString()} residents
                </span>
              }
            >
              {d.buildings.map((b) => (
                <button
                  key={b.buildingId}
                  type="button"
                  onClick={() => goToBuilding(b.buildingId)}
                  className="hover:bg-foreground/10 -mx-1 flex items-center justify-between gap-2 rounded px-1 text-left text-sm"
                >
                  <span className="truncate">{b.label}</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {b.householdCount} household{b.householdCount === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </SubGroup>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
