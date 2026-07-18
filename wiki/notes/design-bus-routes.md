---
tags:
  - domain/city-gen
  - domain/personas
  - status/draft
---

# Design - Mapped Bus Routes (#91)

Follow-up to the named-transit fiction. Today the city gets a rail spine
(`CityIdentity.transitLine`, e.g. "Blue Line") and three named bus lines
(`CityIdentity.busLines`, e.g. "the 5 bus", "the Circulator") in
`lib/seed/naming.ts` `makeCityIdentity`, and `transitLineFor` in
`components/ui/columns/PersonaColumn.tsx` assigns a rider a line by HASHING the
persona id - pure flavour, no geometry. This note designs the real thing:
deterministic bus ROUTES traced along the road network, drawn as an overlay,
with transit commuters riding the line that actually serves their home -> work
pair.

The city model this builds on: roads are RK4-traced tensor-field streamlines
(`lib/seed/tensorField.ts` -> `lib/seed/cityGen.ts` `buildTensorRoadsImpl`),
bucketed into `topology.highways` (`Highway[]`), `arterials` and `streets`
(`RoadPoly[]`), each a finely-sampled polyline (~2-4 m vertex steps). Population
lives in `lib/seed/population.ts` (`buildPopulationField`, `sample(x,z)` -> 0..1,
p99-normalised). Determinism is the contract: every draw is a seeded rng stream
keyed `${seed}::...`, gen caches key on
`${seed}::${shape}::${scale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}::${densityProfileKey()}`.
Related: [[decision-tensor-field-roads]], [[decision-network-aligned-districts]],
[[decision-population-density-field]], [[decision-persona-architecture]].

## 1. Routing graph from the road data

The roads are independent polylines. Tensor streamlines are traced separately,
so two crossing roads do NOT share a vertex at the crossing - a crossing is a
GEOMETRIC intersection, not a topological one. So the graph has to be recovered,
not read off.

Proposed new module `lib/seed/roadGraph.ts`, memoised on the standard city
cache key:

- **Segment index.** Reuse the packed-cell spatial hash already proven twice in
  this codebase (`buildSegmentGrid`/`nearestSegment` in `naming.ts`,
  `RoadIndex` in `cityGen.ts`). Bin every road segment (all tiers) into ~40 m
  cells.
- **Intersection detection.** For each segment, test only segments sharing a
  cell for a proper crossing (segment-segment intersection) or a near-touch
  (endpoint within a small tolerance, ~3 m, catches T-junctions where a street
  dead-ends onto an arterial). Each unique crossing point becomes a NODE; snap
  near-coincident hits (<~4 m) to one node so a plus-crossing is one node, not
  four.
- **Edges.** Split each polyline at its node crossings. The run of original
  vertices between two consecutive nodes is one EDGE, carrying: `fromNode`,
  `toNode`, `roadId`, `tier` (highway/arterial/minor), `length` (summed chord),
  and the vertex list (kept, so the overlay can draw the real curve, not a
  chord).
- **Precompute** node adjacency (node -> incident edges) once. This is the
  routable graph. Cost is O(segments) binning + O(segments x local-cell
  occupancy) pairwise, the same envelope as the address pass, well under a
  second at the metro tier. Cache it like `tensorRoadsCache`.

Highways are in the graph as express trunk edges but carry no stops (a freeway
has no frontage - same "mains exempt" reasoning as streetlights and traffic).

## 2. Deterministic route generation

New module `lib/seed/busRoutes.ts`. One route per entry in `busLines`, generated
in array order, each on its OWN stream `${seed}::busroutes::${lineIndex}` (index,
not name - names can collide and the index is the stable key).

- **Terminal anchoring to density.** Build a seeded, sorted candidate-anchor
  list from the district set + population field: each district's centroid,
  weighted by its integrated `buildPopulationField` sample (downtown /
  subcentre / dense residential score high; industrial / rural score low). Per
  line, seeded-weighted-pick two anchors, biased so lines FAN OUT across
  distinct district pairs rather than stacking (penalise an anchor already
  claimed by an earlier line, mirroring the highway same-corridor dedupe in
  `buildTensorRoadsImpl`). Snap each anchor to the nearest graph node.
- **Path policy = weighted shortest path.** Dijkstra/A* on the graph, edge cost
  `length x tierPenalty`. Arterials cheap (bus trunks), minor streets dear
  (used only for the last reach into a terminal), highways cheapest for
  express-flavoured lines. Map the NAME to policy so the fiction and geometry
  agree:
  - numbered locals ("the 5 bus") -> arterial-following, normal stop spacing;
  - "Express" / "Limited" -> highway/arterial-biased penalties, sparse stops;
  - "Circulator" -> closed loop (route the shortest path terminal -> terminal,
    then a distinct return path home by penalising already-used edges).
  A mild "scenic"/coverage term (penalise edges already claimed by earlier
  lines) spreads the network while still letting lines share the downtown trunk
  the way real systems do.
- **Stops.** Walk the chosen path and drop a stop every `STOP_SPACING`
  (~350-450 m), snapping to the nearest graph node within reach so stops land at
  intersections; densify where `buildPopulationField.sample` is high, thin where
  low (same population-coupling idiom as traffic `busyness()`), with seeded
  jitter on the same stream. Terminals are always stops.
- No `Math.random`/`Date.now`; all draws in fixed order so tuning stop spacing
  never shifts terminal selection. Same seed -> same routes.

Output per line: `{ name, lineIndex, color, path: Vec2[] (road-conforming),
stops: {x,z,nodeId}[] }`.

## 3. Overlay rendering

Routes ARE road-conforming polylines, so reuse the existing ribbon builder
`lib/seed/roadMesh.ts` `buildRoadGeometry` exactly as `components/scene/Roads.tsx`
does. New `components/scene/BusRoutes.tsx`:

- One thin ribbon (~3-4 m) per line from its `path` vertices, lifted just above
  the road surface (road sits at `ROAD_Y = 0.05`; draw the route at ~0.12 with
  `polygonOffset` + `depthWrite:false` + `toneMapped:false` + `fog:false`, the
  same material recipe Roads uses). Per-line colour from a small transit palette
  (or seeded), each line tinted independently -> one draw call per line, 3 lines.
- **Stops (cheap):** a single `InstancedMesh` of a small emissive disc/ring
  glyph, one instance per stop across all lines (tens to low hundreds -
  trivial). Tile-cullable like the rest of the scene; no per-frame cost. A
  points-sprite (like `Traffic`/streetlights) is the even-cheaper alternative if
  the disc reads too solid.
- Gate behind a new `cityPlanning.showBusRoutes` toggle in the scene store
  (`lib/state/sceneStore.ts` `cityPlanning` block + `CITY_PLANNING_VIS_PERSIST`
  list) and a row in `components/ui/RoadsPanel.tsx`, mirroring
  showHighways/showArterials. Also surfaces on `/plan`.

Line2 (screen-space width, as `CommuteArc` uses) is the fallback if thin ribbons
alias badly at distance, but the ribbon path is cheaper for long polylines and
matches the road overlay it sits on.

## 4. Commuter assignment

Replace `transitLineFor`'s hash with "the line that actually serves home ->
work". New `lib/seed/busRoutes.ts` helper `lineServing(homeXZ, workXZ)`:

- Precompute a stop spatial hash (same packed-cell grid) over all lines' stops.
- For a pair: nearest-stop query near home and near work (O(1) grid lookups). A
  line SERVES the pair if it has a stop within `WALK_R` (~400 m) of BOTH ends.
  Among serving lines, pick the one minimising `walkToStop + walkFromStop` (or,
  richer, on-graph ride length between the two stops); tie-break by `lineIndex`
  so it is fully deterministic.
- **Fallback ladder** when no bus serves the pair: (1) the rail spine
  (`transitLine`) - rail stays abstract/citywide until it gets its own geometry
  (see open questions), so it is the natural catch-all; (2) if you want to keep
  everyone on a mapped line, the single nearest line to home, ridden partway.
  Recommend the rail spine as the primary fallback - it is honest about what is
  and is not mapped yet.

Perf envelope (39k personas): graph + routes + stops are built ONCE per city and
memoised. Assignment is per-pair O(1) grid lookups. Only `transit`-mode personas
need a line named, and only when a card is shown - so compute it LAZILY on card
open and memoise per persona id (the `ensureBuildingStories` pattern in
`personaStory.ts`), or fold a cheap pass into the directory build if a
whole-city readout is ever wanted. Either way it is off the render path and off
the eager 39k build's critical section. `PersonaColumn` then reads home/work
from `homeBuildingId` + `commuteTargetBuildingId` (already resolved on the
persona) and calls `lineServing`.

## 5. Phasing

- **Phase 1 (smallest shippable, visual only).** `roadGraph.ts` +
  `busRoutes.ts` route generation for the existing named lines + `BusRoutes.tsx`
  overlay (ribbons + instanced stops) + the `showBusRoutes` toggle. No persona
  change. Self-contained, low-risk; lets the routes be eyeballed for
  plausibility on `/plan` before anything depends on them. Unlocks: the map
  reads as a transit system.
- **Phase 2 (commuters ride real lines).** `lineServing` + replace
  `transitLineFor`; cards name the specific line, with the rail-spine fallback.
  Optionally extend `CommuteArc` so a transit persona draws walk-to-stop -> ride
  along the route -> walk-from-stop instead of one straight bezier. Unlocks:
  grounds the naming fiction; segmented commute arcs.
- **Phase 3 (polish, optional).** Rail-spine geometry (the "Blue Line" as a real
  route on a dedicated corridor), stop names, per-line ridership stats panel,
  and animated buses along routes (reuse the `traffic.ts` #57 journey-window
  shader). Unlocks: a transit panel; buses in the traffic layer.

## 6. Open questions (for the user)

1. **Rail spine.** Does the "Blue Line" (`transitLine`) get real traced geometry
   too, or stay an abstract citywide fallback? It changes whether the fallback
   in Section 4 is "rail" or "nearest bus". Recommend abstract for Phase 1-2,
   geometry in Phase 3.
2. **Line count vs city tier.** `busLines` is exactly 3 today. A Metropolis
   (tier 8) with three buses reads thin. Scale the count with tier, or keep 3
   named + let coverage stretch? (Scaling means touching `makeCityIdentity`,
   which re-rolls naming draws - needs the append-at-end discipline.)
3. **Name -> route-shape mapping.** Adopt the Section 2 mapping (Express =
   highway-biased, Circulator = loop, numbered = local), or keep every line the
   same policy and let names be pure flavour?
4. **"Served" radius + mode wording.** Is ~400 m the right walk-to-stop
   threshold? And when a bus serves a `transit`-mode persona, do we keep the mode
   label "transit" and just name the bus, or relabel to "bus" (currently "bus"
   is reserved for kids' school rides in `COMMUTE_COLORS`)?
5. **Coverage vs shared trunks.** Prefer routes that spread to cover more ground,
   or realistic shared downtown trunks (several lines down the same arterial
   spine)? Recommend shared trunks with a mild dedup.
6. **Overlay default.** Toggle-only in the planning panel (like Arterials), or a
   faint always-on layer at night? Recommend toggle-only.
