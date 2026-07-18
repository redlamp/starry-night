"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
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
import { IconTip, ShowMore } from "@/components/ui/columns/EntityColumns";
import {
  WorkplaceKindBadge,
  WORKPLACE_KIND_ICON,
  WORKPLACE_KIND_COLOR,
} from "@/components/ui/columns/workplaceIcons";
import type { WorkplaceType } from "@/lib/seed/personaData";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn, approxCount } from "@/lib/utils";
import { generateCity, type Building } from "@/lib/seed/cityGen";
import type { Address, CityNames } from "@/lib/seed/naming";
import type { Persona, Business } from "@/lib/seed/personas";
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

// Companies registry (#92): browsable list over EVERY business (7k+ at the
// default tier), reached via the existing Companies kind-filter tab when the
// search box is empty — that combination was previously a dead end (kind
// filter only ever gated search results). Staff-descending is the default
// sort since "who employs the most people" was the issue's motivating case.
type CompanySort = "staff" | "name" | "kind" | "district";

const COMPANY_SORTS: Array<{ value: CompanySort; label: string }> = [
  { value: "staff", label: "By Staff" },
  { value: "name", label: "By Name" },
  { value: "kind", label: "By Industry" },
  { value: "district", label: "By District" },
];

// Initial page + per-click increment for every per-kind browse list (people
// need this most — 41k+ personas — but streets/buildings/companies share it
// too). No virtualization library in this repo (search results just hard-cap
// at MAX_SEARCH_RESULTS with no way to see past it); this reuses the columns'
// ShowMore affordance but increments the visible window instead of jumping
// straight to "all 41,000 rows", which is what keeps the DOM small at any tier.
const BROWSE_PAGE_SIZE = 100;

// Shared page-window mechanics for the four kind-filter browse lists
// (companies/streets/buildings/people): a visible-count cursor that grows via
// ShowMore, reset to the first page whenever `resetKey` changes. The reset is
// done during render (React's "adjusting state when a prop changes" idiom —
// CompaniesView's own sort/filter reset used this before this hook existed),
// not an effect, which would cost an extra render. Callers with no
// sort/filter control of their own (streets/buildings/people) just pass a
// constant resetKey — there's nothing to reset FOR, but the component still
// gets a fresh page cursor on mount (kind-filter switches unmount these
// views, so a stale cursor from a previous look never lingers).
function usePagedRows<T>(rows: T[], pageSize: number, resetKey: string) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [pagingFor, setPagingFor] = useState(resetKey);
  if (pagingFor !== resetKey) {
    setPagingFor(resetKey);
    setVisibleCount(pageSize);
  }
  return {
    visible: rows.slice(0, visibleCount),
    total: rows.length,
    visibleCount,
    showMore: () => setVisibleCount((c) => Math.min(rows.length, c + pageSize)),
  };
}

type CompanyRow = {
  id: string;
  name: string;
  kind: WorkplaceType;
  kindLabel: string;
  districtId: string;
  districtName: string;
  listed: number;
  total: number;
};

// Every named road, sorted by name (secondary: building count descending) —
// the empty-query Streets browse (#92 feedback round 2).
type StreetRow = { id: string; name: string; buildingCount: number };

// Every addressed building, sorted by street then address number — the
// empty-query Buildings browse. `name` only exists for the named subset.
type BuildingRow = {
  id: number;
  number: number;
  street: string;
  name?: string;
  districtName: string;
};

// Every listed persona (41k+), sorted by family name then given name — the
// empty-query People browse. Paging is mandatory at this scale.
type PersonRow = {
  id: string;
  fullName: string;
  familyName: string;
  givenName: string;
  age: number;
};

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
  const setDemographicsOpen = useSceneStore((s) => s.setDemographicsOpen);

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

    // One flat search index across every entity kind, plus the base rows for
    // each kind's empty-query browse list (#92 feedback round 2) — built in
    // the SAME passes so there's no second 41k/577-item walk. Sorted once
    // here (fixed order, no user sort control on these three), so re-renders
    // from typing in the unrelated search box never re-sort anything.
    const searchIndex: SearchEntry[] = [];
    const adults: Persona[] = [];
    const personRows: PersonRow[] = [];
    for (const p of directory.personas.values()) {
      if (p.age >= 18) adults.push(p);
      searchIndex.push({
        kind: "person",
        id: p.id,
        label: p.fullName,
        sub: `${p.age} · ${names.districtNames.get(p.homeDistrictId) ?? ""}`,
        lower: p.fullName.toLowerCase(),
      });
      personRows.push({
        id: p.id,
        fullName: p.fullName,
        familyName: p.familyName,
        givenName: p.givenName,
        age: p.age,
      });
    }
    personRows.sort(
      (a, b) => a.familyName.localeCompare(b.familyName) || a.givenName.localeCompare(b.givenName),
    );

    const streetRows: StreetRow[] = [];
    for (const [roadId, name] of names.streetNames) {
      const count = names.buildingsByRoad.get(roadId)?.length ?? 0;
      searchIndex.push({
        kind: "street",
        id: roadId,
        label: name,
        sub: `${count} building${count === 1 ? "" : "s"}`,
        lower: name.toLowerCase(),
      });
      streetRows.push({ id: roadId, name, buildingCount: count });
    }
    streetRows.sort((a, b) => a.name.localeCompare(b.name) || b.buildingCount - a.buildingCount);
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
    const buildingRows: BuildingRow[] = [];
    for (const [buildingId, address] of names.addresses) {
      const building = idToBuilding.get(buildingId);
      buildingRows.push({
        id: buildingId,
        number: address.number,
        street: address.street,
        name: names.buildingNames.get(buildingId),
        districtName: building ? (names.districtNames.get(building.districtId) ?? "") : "",
      });
      if (!building) continue;
      let roads = districtRoads.get(building.districtId);
      if (!roads) {
        roads = new Set();
        districtRoads.set(building.districtId, roads);
      }
      roads.add(address.roadId);
    }
    buildingRows.sort((a, b) => a.street.localeCompare(b.street) || a.number - b.number);
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

    return {
      idToBuilding,
      adults,
      searchIndex,
      districtList,
      streetRows,
      buildingRows,
      personRows,
    };
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

  // Search matches + their paging sit ABOVE the early return (hook rules).
  // Growable Show More window instead of the old hard 50-row crop with no way
  // past it (user 2026-07-18: "the directory list gets cropped").
  const trimmedQuery = query.trim().toLowerCase();
  const allMatches = useMemo(
    () =>
      bundle && trimmedQuery
        ? bundle.searchIndex.filter(
            (n) => (kindFilter === "all" || n.kind === kindFilter) && n.lower.includes(trimmedQuery),
          )
        : [],
    [bundle, trimmedQuery, kindFilter],
  );
  const pagedMatches = usePagedRows(allMatches, MAX_SEARCH_RESULTS, `${trimmedQuery}::${kindFilter}`);

  // After the directory build lands the bundle derivation above is warm;
  // until then render the masthead skeleton below instead of blocking.
  if (!directory || !bundle) {
    return <DirectorySkeleton />;
  }
  const { idToBuilding, districtList, streetRows, buildingRows, personRows } = bundle;

  const goToBuilding = (buildingId: number) => {
    const building = idToBuilding.get(buildingId);
    if (building) focusBuilding(building);
    resetColumns([{ kind: "building", id: buildingId }]);
  };

  // Streets/People browse row opens (#92 feedback round 2) — same targets as
  // the matching kind in search results (openResult below): a street resets
  // the stack to just that street, a person pushes onto whatever's open.
  const openStreet = (roadId: string) => resetColumns([{ kind: "street", id: roadId }]);
  const openPersona = (id: string) => pushColumn({ kind: "persona", id });

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
          <IconTip label="Demographics">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDemographicsOpen(true)}
              className="ml-auto h-7 gap-1.5 text-xs"
            >
              <BarChart3 className="size-3.5" aria-hidden />
              Demographics
            </Button>
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
            {pagedMatches.total === 0 && (
              <div className="text-muted-foreground px-1 text-sm">
                Nothing matches &quot;{query.trim()}&quot;.
              </div>
            )}
            {pagedMatches.visible.map((entry) => (
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
      ) : null}
      {trimmedQuery ? (
        <div className="shrink-0">
          <ShowMore
            total={pagedMatches.total}
            cap={pagedMatches.visibleCount}
            expanded={false}
            onToggle={pagedMatches.showMore}
            noun="matches"
          />
        </div>
      ) : kindFilter === "company" ? (
        <>
          <Separator className="shrink-0" />
          <CompaniesView
            businesses={directory.businesses}
            idToBuilding={idToBuilding}
            names={directory.names}
            districtList={districtList}
            isSelected={isSelected}
            onOpen={(id) => pushColumn({ kind: "company", id })}
          />
        </>
      ) : kindFilter === "street" ? (
        <>
          <Separator className="shrink-0" />
          <StreetsView rows={streetRows} isSelected={isSelected} onOpen={openStreet} />
        </>
      ) : kindFilter === "building" ? (
        <>
          <Separator className="shrink-0" />
          <BuildingsView
            rows={buildingRows}
            maxAddressDigits={directory.names.maxAddressDigits}
            isSelected={isSelected}
            onOpen={goToBuilding}
          />
        </>
      ) : kindFilter === "person" ? (
        <>
          <Separator className="shrink-0" />
          <PeopleView rows={personRows} isSelected={isSelected} onOpen={openPersona} />
        </>
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
              <Select
                value={districtSort}
                onValueChange={(v) => setDistrictSort(v as DistrictSort)}
              >
                <SelectTrigger size="sm" className="w-32">
                  <SelectValue>
                    {(v: DistrictSort) =>
                      DISTRICT_SORTS.find((o) => o.value === v)?.label ?? "Sort"
                    }
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

// The companies registry (#92): every business in the directory, sortable by
// staff/name/kind/district with an optional district filter. Rows show the
// FULL headcount (`totalHeadcount`, #96) as the primary number — that's what
// answers "who has the most employees" — with the listed sample as a muted
// footnote, matching the "listed of total" vocabulary
// (wiki/notes/decision-listed-residents-term.md).
function CompaniesView({
  businesses,
  idToBuilding,
  names,
  districtList,
  isSelected,
  onOpen,
}: {
  businesses: Map<string, Business>;
  idToBuilding: Map<number, Building>;
  names: CityNames;
  districtList: DistrictAgg[];
  isSelected: (kind: SearchKind, id: string) => boolean;
  onOpen: (id: string) => void;
}) {
  const [sort, setSort] = useState<CompanySort>("staff");
  const [districtFilter, setDistrictFilter] = useState<string>("all");
  // Industry sub-filter (user 2026-07-18): only offered while sorting By
  // Industry, and cleared when the sort moves away so no invisible filter
  // keeps narrowing the list.
  const [industryFilter, setIndustryFilter] = useState<WorkplaceType | "all">("all");

  // Base rows: one O(businesses) pass, independent of sort/filter so those
  // stay cheap to change. Stable as long as the directory/city bundle is
  // (i.e. only rebuilds on a seed/shape change, never per keystroke).
  const rows = useMemo(() => {
    const list: CompanyRow[] = [];
    for (const biz of businesses.values()) {
      const building = idToBuilding.get(biz.buildingId);
      const districtId = building?.districtId ?? "";
      list.push({
        id: biz.id,
        name: biz.name,
        kind: biz.kind,
        kindLabel: biz.schoolTier ? `${biz.schoolTier} school` : biz.kind,
        districtId,
        districtName: names.districtNames.get(districtId) ?? "",
        listed: biz.employeeIds.length,
        total: biz.totalHeadcount,
      });
    }
    return list;
  }, [businesses, idToBuilding, names]);

  // Sorting 7k rows only recomputes on a sort/filter change, not on every
  // render.
  const sortedFiltered = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (districtFilter === "all" || r.districtId === districtFilter) &&
        (industryFilter === "all" || r.kind === industryFilter),
    );
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "kind":
          return a.kindLabel.localeCompare(b.kindLabel) || a.name.localeCompare(b.name);
        case "district":
          return a.districtName.localeCompare(b.districtName) || a.name.localeCompare(b.name);
        default:
          return b.total - a.total || a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [rows, sort, districtFilter, industryFilter]);

  // Re-page from the top whenever the sort or filter changes — the "next
  // 100" from the old ordering rarely means anything under the new one.
  const { visible, total, visibleCount, showMore } = usePagedRows(
    sortedFiltered,
    BROWSE_PAGE_SIZE,
    `${sort}:${districtFilter}:${industryFilter}`,
  );
  const sortedDistricts = useMemo(
    () => [...districtList].sort((a, b) => a.properName.localeCompare(b.properName)),
    [districtList],
  );
  // Industries actually present in this city, for the sub-filter menu.
  const industries = useMemo(() => {
    const present = new Set<WorkplaceType>();
    for (const r of rows) present.add(r.kind);
    return [...present].sort();
  }, [rows]);

  return (
    <>
      {/* Title + available count on the first line, every dropdown on the
          second (user 2026-07-18). flex-wrap lets the industry sub-filter
          spill to a third line on narrow panels instead of clipping. */}
      <div className="flex shrink-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Companies</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {total.toLocaleString()} available
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {sortedDistricts.length > 1 && (
            <Select value={districtFilter} onValueChange={(v) => setDistrictFilter(v ?? "all")}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue>
                  {(v: string) =>
                    v === "all"
                      ? "All Districts"
                      : (sortedDistricts.find((d) => d.id === v)?.properName ?? "All Districts")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {sortedDistricts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.properName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as CompanySort);
              if (v !== "kind") setIndustryFilter("all");
            }}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue>
                {(v: CompanySort) => COMPANY_SORTS.find((o) => o.value === v)?.label ?? "Sort"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COMPANY_SORTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Industry sub-filter, offered while sorting By Industry (user
              2026-07-18). Items carry the pill's own icon + hue. */}
          {sort === "kind" && (
            <Select
              value={industryFilter}
              onValueChange={(v) => setIndustryFilter((v as WorkplaceType | "all") ?? "all")}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue>
                  {(v: string) =>
                    v === "all" ? (
                      "All Industries"
                    ) : (
                      <span className="capitalize" style={{ color: WORKPLACE_KIND_COLOR[v as WorkplaceType] }}>
                        {v}
                      </span>
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Industries</SelectItem>
                {industries.map((k) => {
                  const Icon = WORKPLACE_KIND_ICON[k];
                  return (
                    <SelectItem key={k} value={k}>
                      <span
                        className="flex items-center gap-1.5 capitalize"
                        style={{ color: WORKPLACE_KIND_COLOR[k] }}
                      >
                        <Icon aria-hidden className="size-3.5" />
                        {k}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* -mr-3/pr-4: same edge-and-gap fix as the other lists in this panel. */}
      <ScrollArea className="-mr-3 **:data-[slot=scroll-area-viewport]:max-h-[calc(100vh-24rem)]">
        <div className="flex flex-col gap-0.5 pr-4">
          {total === 0 && (
            <div className="text-muted-foreground px-1 text-sm">No companies match the filters.</div>
          )}
          {visible.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpen(row.id)}
              className={cn(
                "hover:bg-foreground/10 -mx-1 flex items-center justify-between gap-2 rounded px-1 text-left text-sm",
                isSelected("company", row.id) && "bg-primary/15",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{row.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {row.districtName}
                </span>
              </span>
              <WorkplaceKindBadge kind={row.kind} label={row.kindLabel} />
              <span className="flex shrink-0 flex-col items-end tabular-nums">
                <span>{row.total.toLocaleString()}</span>
                <span className="text-muted-foreground text-xs">
                  {row.listed.toLocaleString()} listed
                </span>
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
      {/* Pinned below the scroll, not buried at the end of the list — the
          user couldn't find it there (2026-07-18). Same for every browse. */}
      <div className="shrink-0">
        <ShowMore
          total={total}
          cap={visibleCount}
          expanded={false}
          onToggle={showMore}
          noun="companies"
        />
      </div>
    </>
  );
}

// Every named road, sorted by name (secondary: building count descending) —
// the Streets kind-filter tab's empty-query browse (#92 feedback round 2).
function StreetsView({
  rows,
  isSelected,
  onOpen,
}: {
  rows: StreetRow[];
  isSelected: (kind: SearchKind, id: string) => boolean;
  onOpen: (id: string) => void;
}) {
  const { visible, total, visibleCount, showMore } = usePagedRows(
    rows,
    BROWSE_PAGE_SIZE,
    "streets",
  );
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-sm font-medium">Streets</span>
        <span className="text-muted-foreground text-xs">{total.toLocaleString()} streets</span>
      </div>
      <ScrollArea className="-mr-3 **:data-[slot=scroll-area-viewport]:max-h-[calc(100vh-24rem)]">
        <div className="flex flex-col gap-0.5 pr-4">
          {visible.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpen(row.id)}
              className={cn(
                "hover:bg-foreground/10 -mx-1 flex items-center justify-between gap-2 rounded px-1 text-left text-sm",
                isSelected("street", row.id) && "bg-primary/15",
              )}
            >
              <span className="min-w-0 truncate">{row.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {row.buildingCount} building{row.buildingCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
      <div className="shrink-0">
        <ShowMore total={total} cap={visibleCount} expanded={false} onToggle={showMore} noun="streets" />
      </div>
    </>
  );
}

// Every addressed building, sorted by street then address number — the
// Buildings kind-filter tab's empty-query browse (#92 feedback round 2).
function BuildingsView({
  rows,
  maxAddressDigits,
  isSelected,
  onOpen,
}: {
  rows: BuildingRow[];
  maxAddressDigits: number;
  isSelected: (kind: SearchKind, id: string) => boolean;
  onOpen: (id: number) => void;
}) {
  const { visible, total, visibleCount, showMore } = usePagedRows(
    rows,
    BROWSE_PAGE_SIZE,
    "buildings",
  );
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-sm font-medium">Buildings</span>
        <span className="text-muted-foreground text-xs">{total.toLocaleString()} buildings</span>
      </div>
      <ScrollArea className="-mr-3 **:data-[slot=scroll-area-viewport]:max-h-[calc(100vh-24rem)]">
        <div className="flex flex-col gap-0.5 pr-4">
          {visible.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpen(row.id)}
              className={cn(
                "hover:bg-foreground/10 -mx-1 flex items-center justify-between gap-2 rounded px-1 text-left text-sm",
                isSelected("building", String(row.id)) && "bg-primary/15",
              )}
            >
              <span className="min-w-0">
                <span className="flex items-baseline gap-1.5">
                  <AddrNum n={row.number} width={maxAddressDigits} />
                  <span className="truncate">{row.street}</span>
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {row.districtName}
                </span>
              </span>
              {row.name && (
                <Badge variant="outline" className="max-w-[7rem] shrink-0 truncate">
                  {row.name}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
      <div className="shrink-0">
        <ShowMore total={total} cap={visibleCount} expanded={false} onToggle={showMore} noun="buildings" />
      </div>
    </>
  );
}

// Every listed persona (41k+), sorted by family name then given name — the
// People kind-filter tab's empty-query browse (#92 feedback round 2). Paging
// is mandatory at this scale, not just a nicety.
function PeopleView({
  rows,
  isSelected,
  onOpen,
}: {
  rows: PersonRow[];
  isSelected: (kind: SearchKind, id: string) => boolean;
  onOpen: (id: string) => void;
}) {
  const { visible, total, visibleCount, showMore } = usePagedRows(rows, BROWSE_PAGE_SIZE, "people");
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-sm font-medium">People</span>
        <span className="text-muted-foreground text-xs">{total.toLocaleString()} listed</span>
      </div>
      <ScrollArea className="-mr-3 **:data-[slot=scroll-area-viewport]:max-h-[calc(100vh-24rem)]">
        <div className="flex flex-col gap-0.5 pr-4">
          {visible.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpen(row.id)}
              className={cn(
                "hover:bg-foreground/10 -mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm",
                isSelected("person", row.id) && "bg-primary/15",
              )}
            >
              <span className="min-w-0 truncate">{row.fullName}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">{row.age}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
      <div className="shrink-0">
        <ShowMore total={total} cap={visibleCount} expanded={false} onToggle={showMore} noun="residents" />
      </div>
    </>
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
