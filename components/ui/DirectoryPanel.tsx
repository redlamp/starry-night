"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  Building2,
  MapPin,
  Route,
  Signature,
  SquareDashed,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { usePersonaDirectoryDeferred } from "@/lib/hooks/usePersonaDirectory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IconTip } from "@/components/ui/columns/EntityColumns";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn, approxCount } from "@/lib/utils";
import { generateCity, type Building } from "@/lib/seed/cityGen";
import type { Address } from "@/lib/seed/naming";
import type { Persona } from "@/lib/seed/personas";
import { personaDirectoryBuildProgress } from "@/lib/seed/personas";
import { ensureBuildingStories } from "@/lib/seed/personaStory";
import { focusBuilding } from "@/lib/scene/focusBuilding";

// City Directory (ControlDock overlay): search-first phone book over the
// whole city — streets, buildings, companies, AND people (user 2026-07-08:
// search on top, a kind filter under it, then the spotlight, then the
// district browse tree with colored single-line headers). Everything derived
// recomputes from the seed; only query/filter/spotlight-step are UI state.

const MAX_SEARCH_RESULTS = 50;

// Address numbers render as a right-aligned column sized by the city's widest
// address (tabular-nums is inherited panel-wide), so "1203 Martin Parkway"
// and "9 Martin Parkway" align their street names (user 2026-07-08).
function AddrNum({ n, width }: { n: number; width: number }) {
  return (
    <span className="inline-block text-right" style={{ minWidth: `${width}ch` }}>
      {n}
    </span>
  );
}

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

type SearchKind = "street" | "building" | "company" | "person";
type KindFilter = "all" | SearchKind;

// "All" stays a word; the entity kinds are icons with a tooltip title
// (user 2026-07-08).
const KIND_FILTERS: Array<{ value: KindFilter; label: string; icon?: LucideIcon }> = [
  { value: "all", label: "All" },
  { value: "street", label: "Streets", icon: Route },
  { value: "building", label: "Buildings", icon: Building2 },
  { value: "company", label: "Companies", icon: Briefcase },
  { value: "person", label: "People", icon: Users },
];

// How many names ride the marquee (two copies render for the seamless loop).
const MARQUEE_COUNT = 24;

type DistrictSort = "residents" | "roads" | "businesses" | "name";

const DISTRICT_SORTS: Array<{ value: DistrictSort; label: string }> = [
  { value: "residents", label: "By Residents" },
  { value: "roads", label: "By Roads" },
  { value: "businesses", label: "By Businesses" },
  { value: "name", label: "By Name" },
];

const KIND_BADGE: Record<SearchKind, string> = {
  street: "Street",
  building: "Building",
  company: "Company",
  person: "Person",
};

type SearchEntry = {
  kind: SearchKind;
  id: string; // roadId | buildingId as string | businessId | personaId
  label: string;
  sub: string;
  // Structured address for building rows — rendered as a fixed-width number
  // column so search results align like the street lists.
  addr?: { number: number; street: string };
  lower: string;
};

type DistrictAgg = {
  id: string;
  properName: string;
  displayName: string;
  color: string;
  residentCount: number;
  roadCount: number;
  businessCount: number;
  buildings: Array<{
    buildingId: number;
    name?: string;
    address?: Address;
    householdCount: number;
  }>;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
};

// Traces a host's border while the persona directory's cold build is still in
// flight (test plan 07-11) — a conic-gradient ring masked down to a stroke.
// Purely observational: polls personaDirectoryBuildProgress() (derived-from-seed
// state, never Date.now/Math.random) via requestAnimationFrame, only
// re-rendering when the fraction moves by more than half a percent, and stops
// polling for good once the build completes.
//
// `className` carries the radius (default `rounded-xl`, matching the panel
// this was originally built for) so callers mounting it over a different
// shape — e.g. the round dock button — can override it (`rounded-full`).
// `thickness` sets the mask padding (stroke width) in px. A second, static
// low-alpha track ring renders underneath the animated arc so progress reads
// against a dark backdrop (the dock button has no panel chrome to contrast
// against); it shares the mask/radius and disappears with the arc at 100%.
export function DirectoryBuildRing({
  className = "rounded-xl",
  thickness = 2,
}: {
  className?: string;
  thickness?: number;
} = {}) {
  const [progress, setProgress] = useState(() => personaDirectoryBuildProgress());
  const lastRef = useRef(progress);

  useEffect(() => {
    if (lastRef.current >= 1) return;
    let raf = 0;
    let stopped = false;
    const tick = () => {
      const next = personaDirectoryBuildProgress();
      if (next >= 1 || Math.abs(next - lastRef.current) > 0.005) {
        lastRef.current = next;
        setProgress(next);
      }
      if (next < 1 && !stopped) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  if (progress >= 1) return null;

  const maskStyle = {
    padding: thickness,
    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    WebkitMaskComposite: "xor",
    mask: "linear-gradient(#fff 0 0) content-box exclude, linear-gradient(#fff 0 0)",
  } as const;

  return (
    <>
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0", className)}
        style={{
          ...maskStyle,
          background: "color-mix(in oklab, var(--primary) 25%, transparent)",
        }}
      />
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0", className)}
        style={{
          ...maskStyle,
          background: `conic-gradient(var(--primary) ${progress * 360}deg, transparent 0deg)`,
        }}
      />
    </>
  );
}

export function DirectorySection() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  // citySize/citySketch don't feed generateCity's args directly, but are
  // listed as memo deps (matching the columns' memo) so a tier/sketch switch
  // rebuilds the directory instead of serving a stale one.
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const pushColumn = useSceneStore((s) => s.pushColumn);
  const resetColumns = useSceneStore((s) => s.resetColumns);
  // Whatever the columns currently show on top gets highlighted here
  // (user 2026-07-08: "if something is selected, highlight it").
  const columnPath = useSceneStore((s) => s.columnPath);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  const topRef = columnCursor >= 0 ? columnPath[columnCursor] : undefined;
  const isSelected = (kind: SearchKind, id: string) =>
    topRef !== undefined &&
    ((kind === "person" && topRef.kind === "persona" && topRef.id === id) ||
      (kind === "street" && topRef.kind === "street" && topRef.id === id) ||
      (kind === "company" && topRef.kind === "company" && topRef.id === id) ||
      (kind === "building" && topRef.kind === "building" && String(topRef.id) === id));
  const setHoverDistrictId = useSceneStore((s) => s.setHoverDistrictId);
  const pinnedDistrictId = useSceneStore((s) => s.pinnedDistrictId);
  const setPinnedDistrictId = useSceneStore((s) => s.setPinnedDistrictId);
  const showDistrictBoundaries = useSceneStore((s) => s.showDistrictBoundaries);
  const setShowDistrictBoundaries = useSceneStore((s) => s.setShowDistrictBoundaries);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [districtSort, setDistrictSort] = useState<DistrictSort>("residents");

  // Stage A perf fix: null until the persona directory's ~2.2s cold build
  // lands. DirectorySection only mounts while the directory overlay is open
  // (ControlDock's `{directoryOpen && <DirectorySection />}`), so `true` just
  // means "peek/build as soon as this component exists" — the panel itself
  // is already the gate.
  const directory = usePersonaDirectoryDeferred(true);

  const bundle = useMemo(() => {
    void citySize;
    void citySketch;
    if (!directory) return null;
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    const idToBuilding = new Map<number, Building>(buildings.map((b) => [b.id, b]));
    const idToDistrict = new Map(districts.map((d) => [d.id, d]));
    const names = directory.names;

    // One flat search index across every entity kind.
    const searchIndex: SearchEntry[] = [];
    const adults: Persona[] = [];
    for (const p of directory.personas.values()) {
      if (p.age >= 18) adults.push(p);
      searchIndex.push({
        kind: "person",
        id: p.id,
        label: p.fullName,
        sub: `${p.age} · ${names.districtNames.get(p.homeDistrictId) ?? ""}`,
        lower: p.fullName.toLowerCase(),
      });
    }
    for (const [roadId, name] of names.streetNames) {
      const count = names.buildingsByRoad.get(roadId)?.length ?? 0;
      searchIndex.push({
        kind: "street",
        id: roadId,
        label: name,
        sub: `${count} building${count === 1 ? "" : "s"}`,
        lower: name.toLowerCase(),
      });
    }
    for (const [buildingId, name] of names.buildingNames) {
      const address = names.addresses.get(buildingId);
      searchIndex.push({
        kind: "building",
        id: String(buildingId),
        label: name,
        sub: "",
        addr: address ? { number: address.number, street: address.street } : undefined,
        lower: name.toLowerCase(),
      });
    }
    for (const biz of directory.businesses.values()) {
      const address = names.addresses.get(biz.buildingId);
      searchIndex.push({
        kind: "company",
        id: biz.id,
        label: biz.name,
        sub: `${biz.kind}${address ? ` · ${address.street}` : ""}`,
        lower: biz.name.toLowerCase(),
      });
    }

    // Per-district aggregates: residents + roads + businesses + the buildings
    // that host featured households.
    const byDistrict = new Map<string, DistrictAgg>();
    const districtRoads = new Map<string, Set<string>>();
    const agg = (districtId: string): DistrictAgg => {
      let a = byDistrict.get(districtId);
      if (!a) {
        const d = idToDistrict.get(districtId);
        a = {
          id: districtId,
          properName: names.districtNames.get(districtId) ?? districtId,
          displayName: d?.displayName ?? districtId,
          color: d?.color ?? "#8a94a8",
          residentCount: 0,
          roadCount: 0,
          businessCount: 0,
          buildings: [],
          bounds: d ? { minX: d.minX, maxX: d.maxX, minZ: d.minZ, maxZ: d.maxZ } : undefined,
        };
        byDistrict.set(districtId, a);
      }
      return a;
    };
    for (const [buildingId, households] of directory.byHomeBuilding) {
      const building = idToBuilding.get(buildingId);
      if (!building) continue;
      const a = agg(building.districtId);
      a.residentCount += households.reduce((sum, hh) => sum + hh.memberIds.length, 0);
      a.buildings.push({
        buildingId,
        name: names.buildingNames.get(buildingId),
        address: names.addresses.get(buildingId),
        householdCount: households.length,
      });
    }
    for (const [buildingId, address] of names.addresses) {
      const building = idToBuilding.get(buildingId);
      if (!building) continue;
      let roads = districtRoads.get(building.districtId);
      if (!roads) {
        roads = new Set();
        districtRoads.set(building.districtId, roads);
      }
      roads.add(address.roadId);
    }
    for (const biz of directory.businesses.values()) {
      const building = idToBuilding.get(biz.buildingId);
      if (building && byDistrict.has(building.districtId)) {
        agg(building.districtId).businessCount += 1;
      }
    }
    for (const [districtId, roads] of districtRoads) {
      if (byDistrict.has(districtId)) agg(districtId).roadCount = roads.size;
    }
    const districtList = [...byDistrict.values()].sort((a, b) => b.residentCount - a.residentCount);
    for (const d of districtList) d.buildings.sort((a, b) => b.householdCount - a.householdCount);

    return { idToBuilding, adults, searchIndex, districtList };
  }, [directory, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  // Marquee cast: a seed-stable run of adults starting at the old spotlight
  // index (the "resident of the night" now leads the parade). Guarded on the
  // bundle (null while the directory build is still pending) rather than
  // `adults` directly, since `adults` only exists once `bundle` does.
  const marqueeCast = useMemo(() => {
    if (!bundle || !directory || bundle.adults.length === 0) return [];
    const { adults } = bundle;
    const start = hashSeedIndex(masterSeed, adults.length);
    const count = Math.min(MARQUEE_COUNT, adults.length);
    const cast = Array.from({ length: count }, (_, i) => adults[(start + i) % adults.length]);
    // The hover cards read epithet/hook, which are lazy-tier — materialize
    // the cast's buildings now (two dozen buildings, single-digit ms).
    for (const p of cast) ensureBuildingStories(masterSeed, directory, p.homeBuildingId);
    return cast;
  }, [bundle, directory, masterSeed]);

  // After the directory build lands the bundle derivation above is warm;
  // until then render the masthead skeleton below instead of blocking.
  if (!directory || !bundle) {
    return <DirectorySkeleton />;
  }
  const { idToBuilding, searchIndex, districtList } = bundle;

  const trimmedQuery = query.trim().toLowerCase();
  const allMatches = trimmedQuery
    ? searchIndex.filter(
        (n) => (kindFilter === "all" || n.kind === kindFilter) && n.lower.includes(trimmedQuery),
      )
    : [];
  const shownMatches = allMatches.slice(0, MAX_SEARCH_RESULTS);

  const goToBuilding = (buildingId: number) => {
    const building = idToBuilding.get(buildingId);
    if (building) focusBuilding(building);
    resetColumns([{ kind: "building", id: buildingId }]);
  };

  // Pin: sticky district highlight + a 45° glide framing the district bounds
  // (same focus mechanism as the columns' cone). Clicking the pinned pin
  // again unpins.
  const pinDistrict = (d: DistrictAgg) => {
    if (pinnedDistrictId === d.id) {
      setPinnedDistrictId(null);
      return;
    }
    setPinnedDistrictId(d.id);
    if (!d.bounds) return;
    const cx = (d.bounds.minX + d.bounds.maxX) / 2;
    const cz = (d.bounds.minZ + d.bounds.maxZ) / 2;
    const corner = Math.hypot(
      (d.bounds.maxX - d.bounds.minX) / 2,
      (d.bounds.maxZ - d.bounds.minZ) / 2,
    );
    const radius = Math.min(1800, Math.max(150, corner * 1.15 + 40));
    const st = useSceneStore.getState();
    st.setFocusPivot([cx, 6, cz]);
    st.setFocusRequest({ x: cx, y: 6, z: cz, radius, fit: "fill" });
  };

  const openResult = (entry: SearchEntry) => {
    switch (entry.kind) {
      case "person":
        pushColumn({ kind: "persona", id: entry.id });
        break;
      case "street":
        resetColumns([{ kind: "street", id: entry.id }]);
        break;
      case "building":
        goToBuilding(Number(entry.id));
        break;
      case "company":
        pushColumn({ kind: "company", id: entry.id });
        break;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-1 tabular-nums">
      {/* Masthead: city name in caps, icon stats below (user 2026-07-08). */}
      <div className="flex shrink-0 flex-col gap-1">
        <div className="text-base font-semibold tracking-[0.14em] uppercase">
          {directory.names.city.name}
        </div>
        {/* Full-capacity city first, listed sample second (#96): the
            directory is a detailed slice of a much larger town. */}
        <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
          <IconTip label="Population">
            <span className="flex items-center gap-1 tabular-nums">
              <Users className="size-3.5" aria-hidden />
              {approxCount(directory.city.population)}
              <span className="opacity-75">
                · {directory.totals.personas.toLocaleString()} listed
              </span>
            </span>
          </IconTip>
          <IconTip label="Businesses">
            <span className="flex items-center gap-1 tabular-nums">
              <Briefcase className="size-3.5" aria-hidden />
              {approxCount(directory.city.establishments)}
              <span className="opacity-75">
                · {directory.totals.businesses.toLocaleString()} listed
              </span>
            </span>
          </IconTip>
        </div>
      </div>

      {marqueeCast.length > 0 && (
        <ResidentMarquee
          cast={marqueeCast}
          districtNames={directory.names.districtNames}
          onOpen={(id) => pushColumn({ kind: "persona", id })}
        />
      )}

      {/* Search + kind filter stay pinned; only the list below scrolls. */}
      <div className="flex shrink-0 flex-col gap-1.5">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the city…"
          aria-label="Search streets, buildings, companies, and people"
          className="h-8"
        />
        <Tabs value={kindFilter} onValueChange={(v) => setKindFilter(v as KindFilter)}>
          <TabsList className="h-7 w-full">
            {KIND_FILTERS.map((f) =>
              f.icon ? (
                <IconTip key={f.value} label={f.label}>
                  <TabsTrigger value={f.value} aria-label={f.label} className="px-2 text-xs">
                    <f.icon className="size-3.5" />
                  </TabsTrigger>
                </IconTip>
              ) : (
                <TabsTrigger key={f.value} value={f.value} className="px-2 text-xs">
                  {f.label}
                </TabsTrigger>
              ),
            )}
          </TabsList>
        </Tabs>
      </div>

      {/* Both lists cap the VIEWPORT's max-height directly (vh units are
          always definite). The overlay is max-h-sized, so any height:100%
          chain resolves to auto and nothing ever scrolls; capping the
          viewport makes it the real scroll container and keeps the panel
          content-sized when the list is short. */}
      {trimmedQuery ? (
        // -mr-3 bleeds through ControlDock's own p-3 pr-3 wrapper so the
        // scrollbar sits flush at the card's inner edge, same as the columns'
        // ScrollArea (which has no such outer padding to fight); pr-4 on the
        // content below is the columns' text-to-scrollbar gap (user
        // 2026-07-08: "scrollbar too close to text, and far from edge").
        <ScrollArea className="-mr-3 **:data-[slot=scroll-area-viewport]:max-h-[calc(100vh-21rem)]">
          <div className="flex flex-col gap-0.5 pr-4">
            {allMatches.length > MAX_SEARCH_RESULTS && (
              <div className="text-muted-foreground px-1 text-sm">{allMatches.length} matches</div>
            )}
            {allMatches.length === 0 && (
              <div className="text-muted-foreground px-1 text-sm">
                Nothing matches &quot;{query.trim()}&quot;.
              </div>
            )}
            {shownMatches.map((entry) => (
              <button
                key={`${entry.kind}:${entry.id}`}
                type="button"
                onClick={() => openResult(entry)}
                className={cn(
                  "hover:bg-foreground/10 -mx-1 flex items-center justify-between gap-2 rounded px-1 text-left text-sm",
                  isSelected(entry.kind, entry.id) && "bg-primary/15",
                )}
              >
                <span className="min-w-0">
                  {/* Named buildings read in italic (user 2026-07-08). */}
                  <span className={cn("block truncate", entry.kind === "building" && "italic")}>
                    {entry.label}
                  </span>
                  {(entry.sub || entry.addr) && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {entry.addr ? (
                        <>
                          <AddrNum n={entry.addr.number} width={directory.names.maxAddressDigits} />{" "}
                          {entry.addr.street}
                        </>
                      ) : (
                        entry.sub
                      )}
                    </span>
                  )}
                </span>
                <Badge variant="outline" className="shrink-0">
                  {KIND_BADGE[entry.kind]}
                </Badge>
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <>
          <Separator className="shrink-0" />

          <div className="flex shrink-0 items-center justify-between gap-2">
            <span className="text-sm font-medium">Districts</span>
            <div className="flex items-center gap-1">
              {/* Boundaries toggle (user 2026-07-10): outline every district
                  in its colour on the map; hovering a header then fills its
                  district at 20% alpha (SelectedDistrictOutline). */}
              <IconTip label="Show Boundaries">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Show Boundaries"
                  aria-pressed={showDistrictBoundaries}
                  onClick={() => setShowDistrictBoundaries(!showDistrictBoundaries)}
                  className={cn(
                    "text-muted-foreground size-7",
                    // /30, not the usual /15 selection tint — an icon-only
                    // active state needs the extra contrast (user 2026-07-10).
                    showDistrictBoundaries && "bg-primary/30 text-foreground",
                  )}
                >
                  <SquareDashed className="size-3.5" />
                </Button>
              </IconTip>
              <Select value={districtSort} onValueChange={(v) => setDistrictSort(v as DistrictSort)}>
                <SelectTrigger size="sm" className="w-32">
                  <SelectValue>
                    {(v: DistrictSort) => DISTRICT_SORTS.find((o) => o.value === v)?.label ?? "Sort"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DISTRICT_SORTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* -mr-3/pr-4: same edge-and-gap fix as the search list above. */}
          <ScrollArea className="-mr-3 **:data-[slot=scroll-area-viewport]:max-h-[calc(100vh-24rem)]">
            <div className="flex flex-col pr-4">
              {[...districtList]
                .sort((a, b) =>
                  districtSort === "name"
                    ? a.properName.localeCompare(b.properName)
                    : districtSort === "roads"
                      ? b.roadCount - a.roadCount
                      : districtSort === "businesses"
                        ? b.businessCount - a.businessCount
                        : b.residentCount - a.residentCount,
                )
                .map((d) => (
                  // Hover lives on the Collapsible ROOT, not just the header (user
                  // 2026-07-08): that way the expanded building list — which sits
                  // between this header and the next one — keeps the district
                  // highlighted instead of dropping through to the pinned fallback.
                  // The list above dropped its row gap-1 in favor of py-0.5 HERE so
                  // every row's hover hitbox is vertically contiguous with its
                  // neighbors — no dead gap that snaps the highlight back to the
                  // pinned district while the cursor is between headers.
                  <Collapsible
                    key={d.id}
                    className="py-0.5"
                    onMouseEnter={() => setHoverDistrictId(d.id)}
                    onMouseLeave={() => setHoverDistrictId(null)}
                  >
                    {/* The WHOLE header expands (user 2026-07-08): district name in
                        its legend color on one line, counts below. Hovering traces
                        the district border on the map; the pin makes it stick and
                        flies the camera to the district. Pin sits inside the
                        trigger, immediately left of its auto-appended chevron
                        (user 2026-07-08), rendered as a span (not a button) so it
                        doesn't nest inside the trigger's own button element. */}
                    <CollapsibleTrigger
                      className={cn(
                        "hover:bg-muted/60 min-w-0 items-center rounded-md px-1.5 py-1.5",
                        topRef?.kind === "district" && topRef.id === d.id && "bg-primary/15",
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                        <span className="truncate text-sm">
                          <span className="font-medium" style={{ color: d.color }}>
                            {d.properName}
                          </span>
                          <span className="text-muted-foreground text-xs"> · {d.displayName}</span>
                        </span>
                        <span className="text-muted-foreground truncate text-xs">
                          {d.roadCount} roads · {d.businessCount} businesses ·{" "}
                          {d.residentCount.toLocaleString()} residents
                        </span>
                      </span>
                      <IconTip label="Pin District">
                        <Button
                          render={<span />}
                          // Renders as a span ON PURPOSE (a real <button> can't
                          // nest inside the CollapsibleTrigger's button) — this
                          // tells Base UI so it wires role/keyboard semantics
                          // instead of warning about the missing native element.
                          nativeButton={false}
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Pin ${d.properName}`}
                          aria-pressed={pinnedDistrictId === d.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            pinDistrict(d);
                          }}
                          className={cn(
                            "size-6 shrink-0 [&_svg]:size-3.5",
                            // Pinned state matches the Show Boundaries toggle's
                            // primary tint, at /30 for contrast (user 2026-07-10 —
                            // replaced the foreground plate). The pin icon keeps
                            // its district color in both states.
                            pinnedDistrictId === d.id && "bg-primary/30",
                          )}
                          style={{ color: d.color }}
                        >
                          <MapPin />
                        </Button>
                      </IconTip>
                    </CollapsibleTrigger>
                    <CollapsiblePanel>
                      <div className="flex flex-col gap-0.5 py-1 pl-2">
                        {/* Building rows (user 2026-07-08): address leads — number
                            right-aligned in a fixed 4-char column, then the street.
                            Named buildings get a Signature icon right-aligned just
                            left of the "N hh" column; hovering it reveals the name
                            (the row itself no longer carries the name inline). The
                            icon's slot width is reserved even when empty so the hh
                            column stays aligned across named and unnamed rows. */}
                        {d.buildings.map((b) => (
                          <button
                            key={b.buildingId}
                            type="button"
                            onClick={() => goToBuilding(b.buildingId)}
                            className={cn(
                              "hover:bg-foreground/10 -mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm",
                              isSelected("building", String(b.buildingId)) && "bg-primary/15",
                            )}
                          >
                            <span className="flex min-w-0 items-baseline gap-1.5">
                              {b.address ? (
                                <>
                                  <AddrNum n={b.address.number} width={4} />
                                  <span className="truncate">{b.address.street}</span>
                                </>
                              ) : (
                                <span className="truncate">Building #{b.buildingId}</span>
                              )}
                            </span>
                            <span className="text-muted-foreground flex shrink-0 items-baseline gap-3 text-xs">
                              <span className="inline-flex w-3.5 shrink-0 justify-end">
                                {b.name && (
                                  <IconTip label={b.name}>
                                    <span className="inline-flex">
                                      <Signature className="size-3.5" aria-hidden />
                                    </span>
                                  </IconTip>
                                )}
                              </span>
                              <span className="inline-block w-9 text-right">
                                {b.householdCount} hh
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </CollapsiblePanel>
                  </Collapsible>
                ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

// Skeleton state for the directory build's cold ~2.2s window (Stage A perf
// fix). Mirrors DirectorySection's masthead/search/districts vertical rhythm
// (same gap classes) so the real content doesn't jump when it swaps in — the
// search Input + kind-filter tabs are the REAL controls (just disabled),
// since they're cheap and static; everything that depends on the directory
// (city name, stat chips, marquee, district rows) is a Skeleton bar instead.
function DirectorySkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-1 tabular-nums">
      <div className="flex shrink-0 flex-col gap-1">
        <Skeleton className="h-6 w-40" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>

      <Skeleton className="h-6 w-full" />

      <div className="flex shrink-0 flex-col gap-1.5">
        <Input
          type="search"
          disabled
          placeholder="Search the city…"
          aria-label="Search streets, buildings, companies, and people"
          className="h-8"
        />
        <Tabs defaultValue="all">
          <TabsList className="h-7 w-full">
            {KIND_FILTERS.map((f) =>
              f.icon ? (
                <IconTip key={f.value} label={f.label}>
                  <TabsTrigger
                    value={f.value}
                    disabled
                    aria-label={f.label}
                    className="px-2 text-xs"
                  >
                    <f.icon className="size-3.5" />
                  </TabsTrigger>
                </IconTip>
              ) : (
                <TabsTrigger key={f.value} value={f.value} disabled className="px-2 text-xs">
                  {f.label}
                </TabsTrigger>
              ),
            )}
          </TabsList>
        </Tabs>
      </div>

      <Separator className="shrink-0" />

      <div className="flex shrink-0 items-center justify-between gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-7 w-32" />
      </div>

      <div className="flex flex-col gap-1">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}

// Slow single-line parade of residents above the search field (user
// 2026-07-08, replaces the spotlight card): hover pauses the run and opens a
// hover card; click pulls the persona up in the columns. Two copies of the
// cast + translateX(-50%) make the loop seamless (keyframes in globals.css).
function ResidentMarquee({
  cast,
  districtNames,
  onOpen,
}: {
  cast: Persona[];
  districtNames: Map<string, string>;
  onOpen: (personaId: string) => void;
}) {
  return (
    <div className="group relative shrink-0 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
      <div className="flex w-max animate-[directory-marquee_90s_linear_infinite] group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0" aria-hidden={copy === 1}>
            {cast.map((p) => (
              <HoverCard key={p.id}>
                <HoverCardTrigger
                  render={
                    <button
                      type="button"
                      tabIndex={copy === 1 ? -1 : 0}
                      onClick={() => onOpen(p.id)}
                      className="text-muted-foreground hover:text-foreground pr-5 text-xs whitespace-nowrap transition-colors"
                    >
                      {p.fullName}
                    </button>
                  }
                />
                <HoverCardContent>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-col">
                      <span className="font-medium">{p.fullName}</span>
                      {p.story.epithet && (
                        <span className="text-muted-foreground italic">{p.story.epithet}</span>
                      )}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {p.age} · {p.pronouns} · {districtNames.get(p.homeDistrictId) ?? ""}
                    </div>
                    {p.story.hook && <div className="border-l-2 pl-2 italic">{p.story.hook}</div>}
                  </div>
                </HoverCardContent>
              </HoverCard>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
