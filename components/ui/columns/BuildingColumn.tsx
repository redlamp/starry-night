"use client";

import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { focusBuilding, unfocusBuilding } from "@/lib/scene/focusBuilding";
import { buildingPopulation } from "@/lib/seed/population";
import { siftBuilding } from "@/lib/seed/personaStory";
import { ARCHETYPE_LABELS } from "@/components/ui/panels/WindowsPanel";
import { useEntityIndexes } from "./entityData";
import { ColumnStat, IconTip } from "./EntityColumns";

// Column port of the old BuildingInfoPanel: stats + the occupants list split
// between companies and households, every entry a push into the next column.

export function BuildingColumn({ id, part }: { id: number; part: "pinned" | "rest" }) {
  const push = useSceneStore((s) => s.pushColumn);
  const focusedBuildingId = useSceneStore((s) => s.focusedBuildingId);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const setHoveredTenant = useSceneStore((s) => s.setHoveredTenant);
  const indexes = useEntityIndexes();
  const building = indexes.buildingById.get(id);
  if (!building) {
    return part === "pinned" ? null : (
      <div className="text-sm text-muted-foreground">Building not found.</div>
    );
  }

  const district = indexes.districtById.get(building.districtId);
  const address = indexes.names.addresses.get(id);
  const companies = indexes.companiesInBuilding(id);
  const households = indexes.householdsInBuilding(id);
  // Self-materializes this building's stories (lazy since 2026-07-10).
  const siftLine = siftBuilding(masterSeed, indexes.directory, id);
  const population = Math.round(buildingPopulation(building));
  const isFocused = focusedBuildingId === id;

  if (part === "pinned") {
    return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary">{ARCHETYPE_LABELS[building.archetype]}</Badge>
        <IconTip label={isFocused ? "Unfocus" : "Focus"}>
          <Button
            variant={isFocused ? "default" : "secondary"}
            size="icon-sm"
            onClick={() => (isFocused ? unfocusBuilding() : focusBuilding(building))}
            aria-label={isFocused ? "Unfocus this building" : "Focus this building"}
            aria-pressed={isFocused}
          >
            <MapPin />
          </Button>
        </IconTip>
      </div>

      {district && (
        <button
          type="button"
          onClick={() => push({ kind: "district", id: district.id })}
          className="flex items-center gap-1.5 text-left text-sm font-medium hover:underline"
          style={{ color: district.color }}
        >
          <MapPin className="size-4 shrink-0" />
          <span className="truncate">
            {indexes.names.districtNames.get(district.id) ?? district.displayName}
          </span>
        </button>
      )}
      {address && (
        <button
          type="button"
          onClick={() => push({ kind: "street", id: address.roadId })}
          className="-mt-1 text-left text-sm text-muted-foreground hover:underline"
        >
          {address.number} {address.street}
        </button>
      )}

      <div className="flex flex-col gap-1">
        <ColumnStat label="Est. Population" value={`~${population.toLocaleString()}`} />
        <ColumnStat label="Height" value={`${Math.round(building.height)} m · ${building.floors} floors`} />
        <ColumnStat
          label="Footprint"
          value={`${Math.round(building.width)} × ${Math.round(building.depth)} m`}
          muted
        />
      </div>
    </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-medium">Occupants</div>
        {siftLine && <div className="text-sm italic text-muted-foreground">{siftLine}</div>}
        {companies.length === 0 && households.length === 0 && (
          <div className="text-sm text-muted-foreground">Nobody&apos;s home tonight.</div>
        )}

        {companies.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Companies
            </div>
            {companies.map((biz) => (
              <button
                key={biz.id}
                type="button"
                onClick={() => push({ kind: "company", id: biz.id })}
                onMouseEnter={() => setHoveredTenant({ buildingId: id, businessId: biz.id })}
                onMouseLeave={() => setHoveredTenant(null)}
                className="-mx-1 flex items-center justify-between gap-2 rounded px-1 text-left text-sm hover:bg-foreground/10"
              >
                <span className="truncate">{biz.name}</span>
                <Badge variant="outline" className="shrink-0 capitalize">
                  {biz.kind}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {companies.length > 0 && households.length > 0 && <Separator className="my-0.5" />}

        {households.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Residents</span>
              <span>Age</span>
            </div>
            {households.map((hh) => (
              <div
                key={`${hh.buildingId}:${hh.index}`}
                className="flex flex-col gap-0.5"
                onMouseEnter={() => setHoveredTenant({ buildingId: hh.buildingId, householdIndex: hh.index })}
                onMouseLeave={() => setHoveredTenant(null)}
              >
                {/* Unit right-aligned in the row, like the ages column
                    (user 2026-07-08). Pilled so it reads as metadata, distinct
                    from the plain-text ages below (user 2026-07-10). */}
                <div className="flex items-baseline justify-between gap-2 text-sm font-medium">
                  <span className="truncate">{hh.label}</span>
                  {hh.unit && (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                      Unit {hh.unit}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 pl-1">
                  {hh.memberIds.map((pid) => {
                    const persona = indexes.directory.personas.get(pid);
                    if (!persona) return null;
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => push({ kind: "persona", id: pid })}
                        className="-mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm hover:bg-foreground/10"
                      >
                        <span className="truncate">
                          {persona.givenName} {persona.familyName}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {persona.age}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
