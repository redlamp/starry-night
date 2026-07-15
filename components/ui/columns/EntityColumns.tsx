"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Cone,
  Layers,
  Square,
  X,
  Map as MapIcon,
  Route,
  Building2,
  Store,
  User,
} from "lucide-react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { flyToBuilding } from "@/lib/scene/focusBuilding";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ensureBuildingStories } from "@/lib/seed/personaStory";
import { useSceneStore, type EntityRef } from "@/lib/state/sceneStore";
import { useEntityIndexes, useEntityIndexesDeferred, type EntityIndexes } from "./entityData";
import { DistrictColumn } from "./DistrictColumn";
import { StreetColumn } from "./StreetColumn";
import { BuildingColumn } from "./BuildingColumn";
import { CompanyColumn } from "./CompanyColumn";
import { PersonaColumn } from "./PersonaColumn";

// Entity columns: the Miller-columns drill (macOS Finder columns) unifying
// district / street / building / company / persona details, docked top-left
// so column headers align. Three display states (cycle button in the header):
//   side — flat columns side by side, every column fully interactive;
//          clicking inside an EARLIER column branches the path from there
//          (capture-phase jump + the click's own push = Miller semantics).
//   deck — the CSS-3D stack: earlier columns recede as tilted slivers,
//          click a sliver to jump back; only the top column is readable.
//   collapsed — just the top card.
// Back/Forward walk the path without truncating it (forward history survives
// until a new push branches). Replaces BuildingInfoPanel + PersonaPanel.

const VIEW_META = {
  side: { icon: Columns3, label: "Side by Side", next: "deck" },
  deck: { icon: Layers, label: "3D Deck", next: "collapsed" },
  collapsed: { icon: Square, label: "Collapsed", next: "side" },
} as const;

const KIND_ICON: Record<EntityRef["kind"], typeof MapIcon> = {
  district: MapIcon,
  street: Route,
  building: Building2,
  company: Store,
  persona: User,
};

const KIND_LABEL: Record<EntityRef["kind"], string> = {
  district: "District",
  street: "Street",
  building: "Building",
  company: "Company",
  persona: "Resident",
};

// Card title (user 2026-07-11): larger + selectable for residents, and their
// maiden name rides the header as secondary text — `Jessica Chen born Park`
// ("born" over "née", user 2026-07-11: same meaning, no French gloss) —
// instead of a separate meta line inside the card.
function RefTitle({ entityRef, indexes }: { entityRef: EntityRef; indexes: EntityIndexes }) {
  const persona =
    entityRef.kind === "persona" ? indexes.directory.personas.get(entityRef.id) : undefined;
  return (
    <div
      className={cn(
        "select-text cursor-text font-medium leading-snug [overflow-wrap:anywhere]",
        entityRef.kind === "persona" ? "text-lg" : "text-sm",
      )}
    >
      {refTitle(entityRef, indexes)}
      {/* Long name + maiden pairs drop the word and read "(Park)" so the
          line stays comfortable (user 2026-07-11 round 3). */}
      {persona?.maidenName && (
        <span className="text-sm font-normal text-muted-foreground">
          {" "}
          {refTitle(entityRef, indexes).length + persona.maidenName.length > 24
            ? `(${persona.maidenName})`
            : `born ${persona.maidenName}`}
        </span>
      )}
    </div>
  );
}

function refTitle(ref: EntityRef, indexes: EntityIndexes): string {
  switch (ref.kind) {
    case "district":
      return indexes.names.districtNames.get(ref.id) ?? ref.id;
    case "street":
      return indexes.roadById.get(ref.id)?.name ?? "Unnamed Road";
    case "building": {
      const named = indexes.names.buildingNames.get(ref.id);
      if (named) return named;
      const address = indexes.names.addresses.get(ref.id);
      return address ? `${address.number} ${address.street}` : `Building #${ref.id}`;
    }
    case "company":
      return indexes.directory.businesses.get(ref.id)?.name ?? "Closed Business";
    case "persona":
      return indexes.directory.personas.get(ref.id)?.fullName ?? "Unknown Resident";
  }
}

// The "cone" action (user 2026-07-08): frame every location tied to the top
// card — a commuter's home + work + their connections' homes, a company's
// building + its people's homes, a street's full run, a district's bounds.
// Reuses the #87 focus mechanism: bounding sphere -> 45-degree look-down glide.
function showLocations(ref: EntityRef, indexes: EntityIndexes): void {
  const pts: Array<[number, number, number]> = [];
  // A persona's home→work pair is the PRIMARY arc (the thick commute) — the frame is
  // centred on ITS midpoint and must contain both ends (test round 3.17: a point-mass
  // cluster of nearby family homes dragged the centroid off the commute midline and the
  // long commute arc left the frame). Secondary points (connections) still frame by
  // percentile so one cross-town relative doesn't zoom everything out.
  let primaryPair: [[number, number, number], [number, number, number]] | null = null;
  const addBuilding = (buildingId: number | undefined) => {
    if (buildingId === undefined) return;
    const b = indexes.buildingById.get(buildingId);
    if (b) pts.push([b.x, b.height / 2, b.z]);
  };
  const addPersonaPlaces = (pid: string, withConnections: boolean) => {
    const p = indexes.directory.personas.get(pid);
    if (!p) return;
    addBuilding(p.homeBuildingId);
    addBuilding(p.commuteTargetBuildingId);
    if (!withConnections) return;
    const connect = (id: string | undefined) => {
      if (!id) return;
      const q = indexes.directory.personas.get(id);
      if (q) addBuilding(q.homeBuildingId);
    };
    connect(p.partnerId);
    for (const link of p.family) connect(link.personaId);
    // The relation edge is lazy-tier: materialize this persona's building
    // before reading it (event-path helper, so getState() is the idiom).
    ensureBuildingStories(useSceneStore.getState().masterSeed, indexes.directory, p.homeBuildingId);
    connect(p.story.relation?.targetId);
  };
  switch (ref.kind) {
    case "persona": {
      addPersonaPlaces(ref.id, true);
      const p = indexes.directory.personas.get(ref.id);
      const h = p ? indexes.buildingById.get(p.homeBuildingId) : undefined;
      const w =
        p && p.commuteTargetBuildingId !== undefined
          ? indexes.buildingById.get(p.commuteTargetBuildingId)
          : undefined;
      if (h && w && h.id !== w.id) {
        primaryPair = [
          [h.x, h.height / 2, h.z],
          [w.x, w.height / 2, w.z],
        ];
      }
      break;
    }
    case "company": {
      const biz = indexes.directory.businesses.get(ref.id);
      if (!biz) break;
      addBuilding(biz.buildingId);
      for (const pid of biz.employeeIds) addPersonaPlaces(pid, false);
      for (const pid of biz.studentIds ?? []) {
        const p = indexes.directory.personas.get(pid);
        if (p) addBuilding(p.homeBuildingId);
      }
      break;
    }
    case "building": {
      addBuilding(ref.id);
      // Where this building's people go: residents' work/school, and the
      // homes of everyone employed here.
      for (const hh of indexes.householdsInBuilding(ref.id))
        for (const pid of hh.memberIds) {
          const p = indexes.directory.personas.get(pid);
          if (p) addBuilding(p.commuteTargetBuildingId);
        }
      for (const biz of indexes.companiesInBuilding(ref.id))
        for (const pid of biz.employeeIds) {
          const p = indexes.directory.personas.get(pid);
          if (p) addBuilding(p.homeBuildingId);
        }
      break;
    }
    case "street": {
      const road = indexes.roadById.get(ref.id);
      if (road) for (const v of road.vertices) pts.push([v.x, 6, v.z]);
      break;
    }
    case "district": {
      const d = indexes.districtById.get(ref.id);
      if (d) {
        pts.push([d.minX, 6, d.minZ], [d.maxX, 6, d.minZ], [d.minX, 6, d.maxZ], [d.maxX, 6, d.maxZ]);
      }
      break;
    }
  }
  if (pts.length === 0) return;
  // Frame centre: the primary commute's MIDPOINT when there is one (the thick arc's
  // midline — 3.17), else the centroid. Radius: the 85th-percentile spread (one
  // cross-town outlier must not zoom the whole view out, user 2026-07-08) — but the
  // primary pair's endpoints are ALWAYS inside (the commute arc never leaves frame).
  let cx = 0, cy = 0, cz = 0;
  if (primaryPair) {
    cx = (primaryPair[0][0] + primaryPair[1][0]) / 2;
    cy = (primaryPair[0][1] + primaryPair[1][1]) / 2;
    cz = (primaryPair[0][2] + primaryPair[1][2]) / 2;
  } else {
    for (const [x, y, z] of pts) { cx += x; cy += y; cz += z; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
  }
  const dists = pts.map(([x, y, z]) => Math.hypot(x - cx, y - cy, z - cz)).sort((a, b) => a - b);
  const p85 = dists[Math.min(dists.length - 1, Math.ceil(dists.length * 0.85) - 1)] ?? 0;
  const halfSpan = primaryPair
    ? Math.hypot(primaryPair[1][0] - cx, primaryPair[1][1] - cy, primaryPair[1][2] - cz)
    : 0;
  const radius = Math.min(
    primaryPair ? Math.max(3600, halfSpan * 1.2) : 1800,
    Math.max(150, Math.max(p85, halfSpan) * 1.15 + 40),
  );
  const st = useSceneStore.getState();
  // Arc-perpendicular view bearing (Cam v3): the arcs all emanate from the FIRST
  // collected point (a persona's home / a company's site / the building itself — each
  // case above pushes it first), so the spokes anchor→location are the drawn arcs'
  // ground directions. Find the camera azimuth whose view direction is, on average,
  // most perpendicular to them, so the arcs present broadside instead of end-on.
  // Arc directions are AXIAL (an arc and its reverse read the same), so average in
  // doubled-angle space — φ̄ = ½·atan2(Σ w·sin 2φ, Σ w·cos 2φ), weighted by horizontal
  // span (a cross-town commute outweighs a next-door neighbour). The two perpendicular
  // headings are 180° apart; pick the one nearer the live azimuth (shortest swing).
  let viewAzimuthDeg: number | undefined;
  if ((ref.kind === "persona" || ref.kind === "company" || ref.kind === "building") && pts.length >= 2) {
    let s2 = 0, c2 = 0;
    const [ax, , az] = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - ax;
      const dz = pts[i][2] - az;
      const w = Math.hypot(dx, dz);
      if (w < 1) continue; // same building / same block — no direction signal
      const phi = Math.atan2(dx, dz);
      s2 += w * Math.sin(2 * phi);
      c2 += w * Math.cos(2 * phi);
    }
    if (s2 * s2 + c2 * c2 > 1e-6) {
      const meanDeg = (0.5 * Math.atan2(s2, c2) * 180) / Math.PI; // dominant arc bearing
      const cur = st.orbit.azimuthDeg;
      const candA = meanDeg + 90;
      const candB = meanDeg - 90;
      const dA = Math.abs((((candA - cur) % 360) + 540) % 360 - 180);
      const dB = Math.abs((((candB - cur) % 360) + 540) % 360 - 180);
      viewAzimuthDeg = ((dA <= dB ? candA : candB) % 360 + 360) % 360;
    }
  }
  st.setFocusPivot([cx, cy, cz]);
  st.setFocusRequest({ x: cx, y: cy, z: cz, radius, fit: "fill", viewAzimuthDeg });
}

// Camera follows the SELECTION (user 2026-07-11 round 3): whichever card
// lands on top of the drill, glide to its place — a resident's home, a
// company's or building's site, a street's run, a district's bounds. Fly-to
// buttons still exist for the row-specific places (work, partner, commute).
function flyToEntity(ref: EntityRef, indexes: EntityIndexes): void {
  switch (ref.kind) {
    case "persona": {
      const p = indexes.directory.personas.get(ref.id);
      const b = p ? indexes.buildingById.get(p.homeBuildingId) : undefined;
      if (b) flyToBuilding(b);
      break;
    }
    case "company": {
      const biz = indexes.directory.businesses.get(ref.id);
      const b = biz ? indexes.buildingById.get(biz.buildingId) : undefined;
      if (b) flyToBuilding(b);
      break;
    }
    case "building": {
      const b = indexes.buildingById.get(ref.id);
      if (b) flyToBuilding(b);
      break;
    }
    // Streets and districts have no single building — frame their extent.
    case "street":
    case "district":
      showLocations(ref, indexes);
      break;
  }
}

function ColumnBody({
  entityRef,
  part,
  hideFamilyTree,
}: {
  entityRef: EntityRef;
  part: "pinned" | "rest";
  hideFamilyTree?: boolean;
}) {
  switch (entityRef.kind) {
    case "district":
      return <DistrictColumn id={entityRef.id} part={part} />;
    case "street":
      return <StreetColumn id={entityRef.id} part={part} />;
    case "building":
      return <BuildingColumn id={entityRef.id} part={part} />;
    case "company":
      return <CompanyColumn id={entityRef.id} part={part} />;
    case "persona":
      return <PersonaColumn id={entityRef.id} part={part} hideFamilyTree={hideFamilyTree} />;
  }
}

// Outer shell: subscribes only what's needed to decide open/close and to run
// the two store-bridge effects that must keep working while the panel is
// closed (a scene click opening a path; a reroll closing one). Everything
// that only matters once a path is open — including the persona-directory
// build — lives in EntityColumnsBody, so those subscriptions/effects/hooks
// never mount (and never pay the directory's cold build) while closed.
export function EntityColumns() {
  const columnPath = useSceneStore((s) => s.columnPath);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const closeColumns = useSceneStore((s) => s.closeColumns);
  const resetColumns = useSceneStore((s) => s.resetColumns);

  const visible = columnPath.slice(0, columnCursor + 1);
  const open = visible.length > 0;

  // Bridge: a scene building click (InstancedCity → setSelectedBuildingId)
  // opens a fresh [district, building] path; deselection (Esc, empty-space
  // click, regen, inspect-off) closes any path that involved a building.
  // syncColumnSelection keeps store-side state consistent, so this only
  // fires on real divergence — no feedback loop.
  useEffect(() => {
    let lastBuilding: number | null = null;
    for (const ref of visible) if (ref.kind === "building") lastBuilding = ref.id;
    if (selectedBuildingId === null) {
      if (lastBuilding !== null) closeColumns();
      return;
    }
    if (lastBuilding === selectedBuildingId) return;
    // Just the building — its card links to the district (user 2026-07-08:
    // don't pre-stack a district card nobody asked for).
    resetColumns([{ kind: "building", id: selectedBuildingId }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuildingId]);

  // A reroll invalidates every id in the path — close rather than resolve
  // refs against the wrong city.
  useEffect(() => {
    closeColumns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterSeed]);

  if (!open) return null;
  return <EntityColumnsBody />;
}

// Everything that only runs while a path is open: the rest of the store
// subscriptions, the (deferred — Stage A perf fix) persona-directory-backed
// indexes, and the keyboard/wheel/cone-follow effects. Recomputes its own
// visible/open (cheap — slice + length check) rather than threading them
// down as props.
function EntityColumnsBody() {
  const columnPath = useSceneStore((s) => s.columnPath);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  const columnsView = useSceneStore((s) => s.columnsView);
  const setColumnsView = useSceneStore((s) => s.setColumnsView);
  const columnBack = useSceneStore((s) => s.columnBack);
  const columnForward = useSceneStore((s) => s.columnForward);
  const jumpToColumn = useSceneStore((s) => s.jumpToColumn);
  const closeColumns = useSceneStore((s) => s.closeColumns);
  const panelHidden = useSceneStore((s) => s.panelHidden);
  const settingsPanelWidth = useSceneStore((s) => s.settingsPanelWidth);
  const directoryOpen = useSceneStore((s) => s.directoryOpen);
  const coneFollow = useSceneStore((s) => s.coneFollow);
  const setConeFollow = useSceneStore((s) => s.setConeFollow);
  // Stage A perf fix: null until the ~2.2s persona-directory cold build has
  // landed (deferred off the mount-critical path) — render a skeleton card
  // below until then instead of blocking on the sync build.
  const indexes = useEntityIndexesDeferred();

  const visible = columnPath.slice(0, columnCursor + 1);
  const open = visible.length > 0;

  // Escape closes the whole stack (same idiom the old panels used).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeColumns();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeColumns]);

  // ←/→ walk the stack (user 2026-07-08) — the same moves as the header
  // chevrons. Inert while typing or while any dialog is up (family tree,
  // tutorial), so arrows there keep their native meaning.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector('[data-slot="dialog-popup"]')) return;
      const st = useSceneStore.getState();
      if (e.key === "ArrowLeft") {
        if (st.columnCursor > 0) {
          e.preventDefault();
          st.columnBack();
        }
      } else if (st.columnCursor < st.columnPath.length - 1) {
        e.preventDefault();
        st.columnForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The row can outgrow its slot — keep the newest column in view, and let
  // the mouse wheel pan the row horizontally while hovering it (native
  // listener: React's onWheel can't preventDefault reliably).
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columnCursor, columnPath, columnsView]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      const vp = viewportRef.current;
      if (!vp || vp.scrollWidth <= vp.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // real horizontal wheel: let it be
      // A card's own scrollable content wins: if any ancestor viewport under
      // the cursor can still scroll vertically in this direction, let the
      // wheel do that (user 2026-07-08: expanded lists were unscrollable).
      for (
        let el = e.target instanceof Element ? e.target : null;
        el && el !== root;
        el = el.parentElement
      ) {
        if (
          el.getAttribute("data-slot") === "scroll-area-viewport" &&
          el.scrollHeight > el.clientHeight
        ) {
          const up = e.deltaY < 0;
          const canScroll = up
            ? el.scrollTop > 0
            : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
          if (canScroll) return;
        }
      }
      vp.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [open]);

  // Cone-follow: re-frame to the top card's location set whenever the drill
  // moves (or the mode is switched on). Needs indexes — while the directory
  // build hasn't landed there's nothing to frame yet.
  const topRef = visible.length > 0 ? visible[visible.length - 1] : undefined;
  const topKey = topRef ? `${topRef.kind}:${topRef.id}` : null;
  useEffect(() => {
    if (!coneFollow || !topRef || !indexes) return;
    showLocations(topRef, indexes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coneFollow, topKey, indexes]);

  // Selection-follow (user 2026-07-11 round 3): every card that lands on
  // top glides the camera to its place — pushing, back/forward, and the
  // tree's Open Full Card included. Cone-follow supersedes with its
  // multi-location framing above.
  useEffect(() => {
    if (coneFollow || !topRef || !indexes) return;
    flyToEntity(topRef, indexes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topKey, indexes]);

  if (!open) return null;

  const top = visible.length - 1;
  const canBack = columnCursor >= 0;
  const canForward = columnCursor < columnPath.length - 1;
  const view = VIEW_META[columnsView];
  // Stop short of the settings drawer (live width) or, when it's hidden, the
  // gear button — plus the left dock margin.
  const rightReserve = panelHidden ? 64 : settingsPanelWidth + 12;
  // With the City Directory overlay open (w-[21rem] at left-3), the column
  // row slides to its right instead of stacking underneath (user 2026-07-08).
  const leftOffset = directoryOpen ? 12 + 336 + 12 : 12;

  if (!indexes) {
    // Same positioned container the real row uses (left/maxWidth math),
    // holding one skeleton card in place of the row — the real card swaps in
    // at the same origin so nothing jumps once the directory build lands.
    return (
      <div
        ref={rootRef}
        className="pointer-events-auto fixed top-16 z-30 tabular-nums"
        style={{
          left: leftOffset,
          maxWidth: `calc(100vw - ${leftOffset + rightReserve}px)`,
        }}
      >
        <div className="flex w-72 shrink-0 flex-col gap-2.5 rounded-xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur-md">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-4/6" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      // data-camera-obstruction: fly-to framing measures this row's right
      // edge and fits targets into the viewport right of it (user 2026-07-11).
      data-camera-obstruction
      className="pointer-events-auto fixed top-16 z-30 tabular-nums"
      style={{
        left: leftOffset,
        maxWidth: `calc(100vw - ${leftOffset + rightReserve}px)`,
      }}
    >
      <ScrollAreaPrimitive.Root className="flex flex-col">
        {/* Horizontal scrollbar ABOVE the columns (user 2026-07-08) — the
            primitive composed directly: the shared ScrollBar's variant
            classes (absolute, bottom-0) would win the cascade against plain
            overrides and drop the bar back below the cards. */}
        <ScrollAreaPrimitive.Scrollbar
          orientation="horizontal"
          className="order-first mb-1 flex h-2 w-full touch-none flex-col select-none"
          style={{ position: "static" }}
        >
          <ScrollAreaPrimitive.Thumb className="bg-border relative flex-1 rounded-full" />
        </ScrollAreaPrimitive.Scrollbar>
        <ScrollAreaPrimitive.Viewport ref={viewportRef} className="w-full">
          <div
            className={cn(
              "flex items-start pb-1",
              columnsView === "side" && "gap-2",
              columnsView === "deck" && "py-3",
            )}
          >
            {visible.map((ref, i) => {
        const isTop = i === top;
        if (columnsView === "collapsed" && !isTop) return null;
        const deck = columnsView === "deck";
        const depth = top - i;
        const Icon = KIND_ICON[ref.kind];
        return (
          <div
            key={`${ref.kind}:${ref.id}:${i}`}
            // deck: the whole sliver is a jump-back button. side: columns stay
            // fully interactive; a capture-phase jump re-roots the path at
            // this column, then the click's own push branches from here.
            onClick={deck && !isTop ? () => jumpToColumn(i) : undefined}
            onClickCapture={
              !deck && !isTop && columnsView === "side" ? () => jumpToColumn(i) : undefined
            }
            role={deck && !isTop ? "button" : undefined}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-md",
              // Transition transform/filter ONLY — margins snap. Animating
              // margin-right is a per-frame reflow (the choppiness the user
              // saw); transforms composite on the GPU.
              "transition-[transform,filter] duration-300 will-change-transform motion-reduce:transition-none",
              deck && !isTop && "cursor-pointer",
            )}
            style={
              !deck || isTop
                ? { zIndex: 30 + i }
                : {
                    zIndex: 30 + i,
                    marginRight: "-15rem", // leave a ~3rem sliver of the older card
                    // PER-CARD perspective, pivoted on the card's own right
                    // edge: a shared container perspective projects cards left
                    // of the vanishing axis upward and out of the dock (user
                    // 2026-07-08). Tilt + stack only — Y stays top-aligned.
                    // Positive tilt (left side toward the viewer) — the
                    // fanned-cards look the user picked. Kept moderate: the
                    // near-side growth at these params stays inside the tab
                    // cap + row padding, so nothing clips.
                    transform: `perspective(1200px) rotateY(${Math.min(26, 11 + depth * 4)}deg)`,
                    transformOrigin: "100% 35%",
                    filter: "brightness(0.68)",
                  }
            }
          >
            {/* Header row 1: kind icon + type chip left, nav cluster right.
                Row 2: the full name/address title, free to WRAP — long
                company/building names no longer crop (user 2026-07-08). */}
            <div className="flex flex-col gap-0.5 border-b border-border/60 px-3 py-2">
              <div className="flex items-center justify-between gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[ref.kind]}
                    {columnsView === "collapsed" && top > 0 && ` · ${top} behind`}
                  </span>
                </div>
                {isTop && (
                <div className="flex shrink-0 items-center">
                  <IconTip label="Follow Locations">
                    <Button
                      variant={coneFollow ? "default" : "ghost"}
                      size="icon-sm"
                      onClick={() => setConeFollow(!coneFollow)}
                      aria-label="Follow this card's locations with the camera"
                      aria-pressed={coneFollow}
                    >
                      <Cone />
                    </Button>
                  </IconTip>
                  <IconTip label={`View: ${view.label}`}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setColumnsView(view.next)}
                      aria-label={`Column view: ${view.label}. Switch view.`}
                    >
                      <view.icon />
                    </Button>
                  </IconTip>
                  <IconTip label="Back">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={columnBack}
                      disabled={!canBack}
                      aria-label="Back one column"
                    >
                      <ChevronLeft />
                    </Button>
                  </IconTip>
                  <IconTip label="Forward">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={columnForward}
                      disabled={!canForward}
                      aria-label="Forward one column"
                    >
                      <ChevronRight />
                    </Button>
                  </IconTip>
                  <IconTip label="Close">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={closeColumns}
                      aria-label="Close columns"
                    >
                      <X />
                    </Button>
                  </IconTip>
                </div>
                )}
              </div>
              <RefTitle entityRef={ref} indexes={indexes} />
            </div>
            {/* One persistent wrapper whose MAX-HEIGHT tweens between the
                deck-tab cap and the full-card cap — a component swap here
                would remount and kill the transition (user 2026-07-08:
                "super quick tween when expanding/collapsing"). Deck slivers
                read as uniform tabs via the cap + fade-out mask; the inner
                ScrollArea pins its scrollbar to the card's inner-right edge. */}
            {/* Summary details stay pinned ABOVE the scrolling lists (user
                2026-07-08) — expanding a long list scrolls below while the
                stats stay put. */}
            <div className="flex flex-col gap-2.5 px-3 pt-3">
              <ColumnBody entityRef={ref} part="pinned" />
            </div>
            <div
              className="overflow-hidden transition-[max-height] duration-200 ease-out motion-reduce:transition-none"
              style={{
                maxHeight: deck && !isTop ? "11rem" : "min(60vh, calc(100vh - 16rem))",
                maskImage:
                  deck && !isTop
                    ? "linear-gradient(to bottom, black 60%, transparent)"
                    : undefined,
                WebkitMaskImage:
                  deck && !isTop
                    ? "linear-gradient(to bottom, black 60%, transparent)"
                    : undefined,
              }}
            >
              {/* Cap the VIEWPORT, not the root — the card's height chain is
                  indefinite, so a root max-h never makes the viewport scroll
                  (see the directory scroll lesson, 2026-07-08). */}
              <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-[min(60vh,calc(100vh-16rem))]">
                <div className="flex flex-col gap-2.5 p-3 pr-4">
                  <ColumnBody entityRef={ref} part="rest" />
                </div>
              </ScrollArea>
            </div>
          </div>
        );
            })}
          </div>
        </ScrollAreaPrimitive.Viewport>
      </ScrollAreaPrimitive.Root>
    </div>
  );
}

// The SAME card the columns dock renders, standing alone — frame, kind-chip
// header, pinned stats, scrolling body. Used by the FamilyTree dialog so the
// selected member's details are literally the 3D card, not a bespoke pane
// (user 2026-07-08). `actions` fills the header's right cluster.
export function StandaloneEntityCard({
  entityRef,
  actions,
  hideFamilyTree,
}: {
  entityRef: EntityRef;
  actions?: ReactNode;
  hideFamilyTree?: boolean;
}) {
  const indexes = useEntityIndexes();
  const Icon = KIND_ICON[entityRef.kind];
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-md tabular-nums">
      <div className="flex flex-col gap-0.5 border-b border-border/60 px-3 py-2">
        <div className="flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
              {KIND_LABEL[entityRef.kind]}
            </span>
          </div>
          {actions && <div className="flex shrink-0 items-center">{actions}</div>}
        </div>
        <RefTitle entityRef={entityRef} indexes={indexes} />
      </div>
      <div className="flex flex-col gap-2.5 px-3 pt-3">
        <ColumnBody entityRef={entityRef} part="pinned" hideFamilyTree={hideFamilyTree} />
      </div>
      <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-[min(60vh,calc(100vh-16rem))]">
        <div className="flex flex-col gap-2.5 p-3 pr-4">
          <ColumnBody entityRef={entityRef} part="rest" hideFamilyTree={hideFamilyTree} />
        </div>
      </ScrollArea>
    </div>
  );
}

// shadcn tooltip for short action labels (user 2026-07-08: shadcn tooltips or
// hover cards everywhere — no native title attrs). Rich content stays in
// hover-card.tsx; this is the action-name-only wrapper for icon buttons.
export function IconTip({
  label,
  children,
  delay = 300,
}: {
  label: string;
  children: ReactElement;
  // Fly-to buttons pass delay={0} for instant tooltips (user 2026-07-11).
  delay?: number;
}) {
  return (
    <TooltipProvider delay={delay}>
      <Tooltip>
        <TooltipTrigger render={children} />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// "+N more" that actually expands (user 2026-07-08). Column sections keep a
// local expanded flag and pass it through here.
export function ShowMore({
  total,
  cap,
  expanded,
  onToggle,
  noun,
}: {
  total: number;
  cap: number;
  expanded: boolean;
  onToggle: () => void;
  noun?: string;
}) {
  if (total <= cap) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="px-1 text-left text-sm text-muted-foreground hover:underline"
    >
      {expanded ? "Show fewer" : `+${total - cap} more${noun ? ` ${noun}` : ""}`}
    </button>
  );
}

// Small shared row primitive for the column bodies. `stack` breaks the row
// into two lines — label above, value below at full width — for values too
// long to share a line with their label (user 2026-07-08: long profession /
// commute rows wrapped into the label).
export function ColumnStat({
  label,
  value,
  muted,
  stack,
}: {
  label: string;
  value: ReactNode;
  muted?: boolean;
  stack?: boolean;
}) {
  if (stack) {
    return (
      <div className="flex flex-col text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("text-right", muted ? "text-muted-foreground" : "font-medium")}>
          {value}
        </span>
      </div>
    );
  }
  // flex-wrap so the value drops WHOLE to its own right-aligned line when it
  // can't share the row with the label, instead of word-wrapping in place
  // (user 2026-07-11).
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "ml-auto min-w-0 max-w-full break-words text-right",
          muted ? "text-muted-foreground" : "font-medium",
        )}
      >
        {value}
      </span>
    </div>
  );
}
