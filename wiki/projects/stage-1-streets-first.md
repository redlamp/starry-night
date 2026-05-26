# Stage 1 — Streets-First City Generation

Implementation plan for Stage 1 of the streets-first grammar locked in [[decision-streets-first-city-generation]].

**Status**: planned, not started
**Scope**: M2 (city iteration), unblocks Stage 2/3
**Branch convention**: off `dev`, likely `feature/streets-first-stage-1`

## Stage 1 deliverables

1. **Seed-derived primary network** replaces hardcoded `ARTERIALS` in `lib/seed/cityGen.ts`
2. **Topology library** — 4 weighted options (Crossroads, Bypass, Ring, Ring + radial)
3. **District shells** derived from highway + map-edge partition (replaces hardcoded `DISTRICTS` array)
4. **District character assignment** with identity (Downtown / Subcentre) + silhouette template for high-rise
5. **Per-cluster `coreProximity` field** replaces the global `downtownBias` ellipse
6. **Existing block-and-stripe generator** runs *inside* district shells (proper polygon-aware) until Stage 2 replaces it with lot subdivision
7. **District naming** — cardinal + character + stable ID
8. **`/plan` route** — top-down ortho grid of 12–20 seeds, layered visualization (highways, arterials, district fills, zones, streetlights, building footprints)
9. **Districts + Roads panels** — minimum viable, wire into existing shadcn sidebar
10. **Gate 1 asserts** — building overlaps, corridor violations, lot validity (where lots apply; full lot system is Stage 2)
11. **Streetlight planning rules** — per-tier + per-zone matrix, 4% variant-bulb chance, failure flag reusing window TV-flicker shader path

## Out of Stage 1 (Stage 2/3)

- Polygon-subdivision of district shells into proper macro-polygons via network closure
- Recursive block subdivision down to zone-target band
- Lot subdivision + per-zone setback rule (one-building-per-lot)
- Mixed-use `transitional-bias` flag adjacent to Industrial
- Heritage adjacency buffer
- District-merging-across-highways name collapse
- Podium-and-tower archetype + Pacific Rim flag
- Hierarchy weighting (Stage 3 — block size / lot width / cap from distance to network nodes)
- Proper-noun naming overlay

## File-level migration map

### Files to rewrite

- `lib/seed/cityGen.ts` — primary surface; rewrite as topology + district-shell + cluster-placement generator. Existing `Building` type extends with `districtId`, `coreProximity` replaces `downtownBias`. The current `generateCity` returns `{ buildings, districts, highways, arterials, streetlights }` instead of just `Building[]`.
- `lib/seed/lightingGen.ts` — re-read district character from new structure, drop hardcoded `DistrictCharacter` assumptions for `oldtown` etc. Preserve current mood + cross-pollination logic since it's working.

### Files to add

- `lib/seed/topology.ts` — topology library (4 types), seed-derived highway polylines per topology
- `lib/seed/district.ts` — district shells from network partition, character + identity + silhouette assignment, cardinal-name derivation
- `lib/seed/streetlights.ts` — per-tier + per-zone matrix, variant-bulb-chance, failure-flag assignment (uses existing window TV-flicker shader path)
- `app/plan/page.tsx` — `/plan` route, top-down ortho grid view of N seeds with layer toggles
- `components/scene/PlanView.tsx` — top-down rendering of single seed for use in grid + future main-scene camera-mode toggle
- `components/ui/DistrictsPanel.tsx` — districts layer toggles (Zone fill, character outlines, Heritage hatch, macro-polygons, blocks, lots, regularity sliders)
- `components/ui/RoadsPanel.tsx` — road tier toggles, streetlight settings, variant-bulb-chance slider, sodium-LED ratio slider

### Files to extend

- `lib/state/sceneStore.ts` — add panel-state slice for Districts + Roads visibility toggles; `clusterAffinityToNetwork` slider (defaults to 0.75)
- `components/scene/Scene.tsx` — receive new structured city data shape; remove hardcoded `DISTRICTS` references
- `components/scene/Streetlights.tsx` — accept per-light kelvin + isFailing + tier metadata from new streetlight generator
- `components/ui/CameraPanel.tsx` (or whichever holds the sidebar accordion) — add Districts + Roads sections
- `lib/shaders/window.ts` — extend to support streetlight failure flicker using same `uTime`-based pattern (per Q13 lock; no new shader, parameterise existing)

### Files to delete (after migration)

- The `DISTRICTS` const + `ARTERIALS` const + `downtownBias()` function in current `cityGen.ts`. Replaced by topology + district + cluster systems.

## Sequence (suggested PRs)

1. **PR 1: topology + highways** — add `topology.ts`, generate 1–2 highways from seed per topology, render as polylines in scene + plan view. Existing district generation continues to run alongside (parallel, not integrated). Districts panel scaffold (empty), Roads panel scaffold (highway toggle only).
2. **PR 2: district shells from network** — partition map by highways, replace hardcoded `DISTRICTS` array with derived shells. Existing buildings now generated inside shells. Districts panel shows zone fills + character outlines.
3. **PR 3: cluster placement + silhouette template** — `coreProximity` replaces `downtownBias` ellipse; high-rise districts get silhouette templates applied as height-multiplier fields; arterials radiate from cluster centres.
4. **PR 4: streetlight planning matrix** — rewrite streetlight generator with per-tier + per-zone rules, variant-bulb-chance, failure flag.
5. **PR 5: `/plan` route + Gate 1 asserts** — top-down ortho grid renderer; in-gen asserts for overlaps + corridor violations. Verification deliverable for Stage 1 review.

Each PR ships independently. Each ships behind a feature flag (`?stage1=1` URL param) until PR 5 lands, then becomes default.

## Stage 1 verification (locked from grilling)

See [[decision-streets-first-city-generation]] §Stage 1 verification — two-gate review.

**Gate 1**: quantitative asserts (no overlaps, no corridor violations, district count matches topology).

**Gate 2**: two-pass eyeball.
- Pass A: `/plan` route grid, confirm grammar correctness across 12–20 seeds
- Pass B: orbit-view capture of same seeds, confirm ≥16/20 seeds feel categorically different

**Regression**: 16+ accepted seeds pinned in `samples/curated/stage1/`.

## Dependencies / risks

- **Polygon subdivision algorithm choice** — Stage 2 uses recursive halving with per-district regularity. The Stage 1 placeholder (existing block-and-stripe inside district shells) is *not* what Stage 2 ships — accept that some Stage 1 visual texture will change in Stage 2. Tell the still-frame reviewer.
- **`/palette` route precedent** — `/plan` follows the same throwaway-but-useful pattern. Don't over-engineer; this route earns its keep by verification, not production polish.
- **Streetlight density spike** — per-tier + per-zone rules + arterial bias may multiply streetlight count substantially over current. Profile draw-call budget (PRD §4.1 says <50 total scene); streetlights stay one InstancedMesh.
- **`coreProximity` field on `Building`** — preserve determinism. Computed from district centroid + cluster centre, not from camera or runtime state.

## Related

- [[decision-streets-first-city-generation]] — the grammar this implements.
- [[decision-prd-v1-architecture]] — rendering + state model still valid.
- [[building-sizes-real-world-references]] — meters reference for block + building dims.
- [[city-planning-references]] — pre-existing research note.
