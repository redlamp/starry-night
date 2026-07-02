---
tags:
  - domain/3d
  - domain/visual-language
  - status/superseded
  - scope/m2
  - origin/external-research
---

# Decision: Streets-First City Generation

**Superseded by** [[decision-grid-first-city-generation]].

**Date**: 2026-05-26
**Status**: adopted — all 20 grilling branches resolved; implementation staged across multiple PRs.

Supersedes [[decision-district-based-city-layout]].

**Partially superseded (2026-05-30) by [[decision-grid-first-city-generation]]**: the road-network + block-formation mechanism below (pipeline steps 6–11 — the radial arterial model, the per-district rotated-grid + stripe-fill generator, "streets-last" ordering) is replaced by a grid-first model with continuous seam streets. The *grammar* in this note — district characters, silhouette templates, zone palette, height-cap matrix, streetlight planning, naming, heritage buffer, podium-tower — **remains in force**.

## Goal

Different seeds produce **categorically different cities** — not variations of one template. A viewer doing a slow orbit can read a city's identity at a glance: its network topology, where its centres of gravity lie, what its dominant heights look like.

The system is **streets-first**: highway and arterial network is laid down before buildings exist; the network's geometric closure defines where districts can form; buildings emerge inside lots bounded by streets — never overlapping, always respecting per-zone setbacks and per-district height caps.

**Plausibility lives at grammar level** — real urban-planning topologies, real zoning categories, real silhouette templates. The grammar is observable from orbit. Street-level details (sidewalks, awnings, ground-floor commerce, fenestration patterns) are deliberately out of scope until a closer-camera milestone is scheduled.

**Determinism is preserved end-to-end:** every choice (topology, district placement, district character, silhouette template, polygon zone, block, lot, building) derives from sub-seeds of the master seed. The Districts and Roads debug panels expose generator state in a verifiable way.

## Generative pipeline

```
master seed
  ↓
1. Pick network topology — Crossroads / Bypass / Ring / Ring + radial (weighted)
2. Lay highways per topology
3. Highways + map-edge partition map into N regions (district shells)
4. Assign character to each district — Downtown high-rise / Subcentre high-rise / Heritage / Residential / Industrial / Mixed-use
5. Per high-rise district, pick silhouette template — Tabletop / Wedding cake / Twin-peak / Landmark (weighted)
6. Lay arterials inside districts — radiating from district centre or following long axis
7. Polygon-subdivide each district using arterials + local street boundaries
8. Per-polygon zone assignment biased by district character
9. Per-polygon block subdivision down to zone-target block size
10. Per-block lot subdivision with setback rule
11. One building per lot, height capped by zone × district matrix × silhouette field
```

## Grammar locked

### Network

- **Highway** — first-class polyline, may curve. 1–2 per seed. Width ~30–50 m. Buildings excluded from corridor. Forms district boundaries.
- **Arterial** — first-class polyline, mostly straight. 3–6 per seed. Width ~15–25 m. Interior to a district. Cluster centres nucleate at high-betweenness arterial intersections.
- **Local street** — implicit. Gap between adjacent blocks. Not a first-class primitive.
- **Collector tier folded into Arterial** (FHWA classification collapsed for v1 visibility).

### Topology library

| Topology | Weight | Notes |
|---|---|---|
| Crossroads | 0.35 | Two highways cross, ±30° from cardinal. American mid-size feel. |
| Bypass | 0.25 | Single highway arcs tangent to city centre. Houston / Atlanta feel. |
| Ring | 0.20 | Single highway as closed loop, 60–80% map extent. European / Asian. |
| Ring + radial | 0.20 | Ring + one radial. Paris / Tokyo signature. |

Weights are tunable from still-frame samples.

### District

A bounded perceptual area of the city. Composed of polygons. Bounded by *Highways* + map-edge. Arterials run *through* a district, not between them.

Characters:
- **Downtown high-rise** — 0–1 per city. Carries silhouette template. Tallest heights.
- **Subcentre high-rise** — 0–N per city. Carries silhouette template. Secondary CBDs (Tokyo Shinjuku / Shibuya model).
- **Heritage** — 0–1 per city. Low-capped, irregular blocks, no silhouette template (uniform low is the point). Pattern 5 from Q2.
- **Residential** — background fill. Mid-rise + low-rise mix, density falls from arterials outward.
- **Industrial** — background fill, biased to highway corridors + map edges.
- **Mixed-use** — transitional bands around high-rise districts.

Approximate distribution after featured (Downtown / Subcentre / Heritage) placement:
- Residential ≈ 55%
- Commercial-leaning Mixed-use / Subcentre ≈ 15%
- Industrial ≈ 20%
- Mixed-use ≈ 10%

### Silhouette template (high-rise districts only)

Each high-rise district draws one template; no-repeat constraint within seed (avoid two Tabletops in same city).

| Template | Weight | Origin | Real reference |
|---|---|---|---|
| Tabletop | 0.45 | *informal* | Manhattan Midtown, Chicago Loop |
| Wedding cake | 0.30 | **NYC 1916 Zoning Resolution** | Pre-war NYC, Tokyo Marunouchi |
| Twin-peak | 0.15 | **planning term for two-centred patterns** | Hong Kong (IFC + ICC), Petronas |
| Landmark | 0.10 | **Kevin Lynch,** *Image of the City* (1960) | Frankfurt Mainhattan, Shanghai Lujiazui |

Template applies as a height-multiplier *field* over the district footprint, applied on top of base zone × district cap.

### Zone (every polygon)

- *Residential*, *Commercial*, *Industrial*, *Mixed-use*
- Polygon zone biased by district character but not strictly inherited
- Industrial preferentially appears at district edges adjacent to highways or map perimeter

### Height-cap matrix

`max height = matrix[zone][districtCharacter] × silhouette-field(pos) × jitter`

| Zone | Base cap | Heritage | Subcentre high-rise | Downtown high-rise |
|---|---|---|---|---|
| Residential | 30m | 20m | 80m | (treat as Subcentre) |
| Commercial | 80m | 25m | 150m | 250m |
| Industrial | 25m | 20m | n/a | n/a |
| Mixed-use | 50m | 25m | 100m | 200m |

### Block + lot + setback

- Macro polygons (the district subdivisions enclosed by network) recursively subdivide along long axis until in zone-target block-size band:
  - Commercial: 60–80 m
  - Residential: 100–150 m
  - Industrial: 150–250 m
  - Mixed-use: 80–120 m
- Each block subdivides into lots along its frontage. Lot widths:
  - Residential: 8–20 m
  - Commercial / Mixed-use: 20–60 m
  - Industrial: 40–120 m
- Per-zone setbacks (combined front + side + rear margin for v1):
  - Residential: 3 m
  - Commercial: 0–1 m
  - Industrial: 5 m
  - Mixed-use: 1 m
- One building per lot. Building footprint = lot rect inset by setback.

This structurally kills the existing two classes of overlap bug:
1. District-bbox overlap (district footprints are now polygon sets, not rectangles)
2. Two-stripe within-block overlap (replaced by lot subdivision)

## Debug visualization (Districts + Roads panels)

Both panels live in the existing shadcn settings sidebar. Closed by default; toggles off when reopened.

### "Districts" panel (Lynchian perceptual map)

- Toggle: show Zone colour-fill (4 colours)
- Toggle: show District character outlines + label
- Toggle: show Heritage hatch (distinct from high-rise)
- Toggle: show macro-polygons vs subdivided blocks
- Toggle: show lot subdivision (very dense, off by default)

### "Roads" panel

- Toggle: show Highways (polyline highlight)
- Toggle: show Arterials (polyline highlight, thinner)
- Toggle: show Local-street boundaries (block edges)
- Toggle: show Streetlights (point markers coloured by kelvin)
- Setting: streetlight density multiplier
- Setting: sodium-vs-LED kelvin balance ratio
- Setting: show streetlight illumination cone vs. point only

Only the streetlight settings *bake* into generator output. Visualization toggles are overlays.

## Staged implementation

Three-stage migration from current generator. Each shipped stage already looks better than current city.

### Stage 1 — Network and district shell

- Seed-derived primary network (1–2 highways + topology) replaces hardcoded `ARTERIALS`
- Highways + map-edge partition map into district regions
- District character assigned per region; silhouette template per high-rise district
- Existing block-and-stripe generator runs *inside* district shells with biased archetype + height by `coreProximity` (distance to nearest cluster centre, replacing current `downtownBias` ellipse)
- Districts + Roads panels minimum-viable: zone colours + highway / arterial polylines

### Stage 2 — Network closure → block → lot → setback

- Polygon-subdivide districts into proper macro-polygons via network closure
- Recursive block subdivision down to zone-target band
- Lot subdivision + per-zone setback rule
- One building per lot (replaces stripe filler)
- Overlap classes structurally eliminated

### Stage 3 — Hierarchy weighting

- Block size, lot width, and effective height-cap derive from distance to highway / arterial nodes
- Tokyo-style: dense + tall near transit nodes; sparse + low at edges
- Tunable `clusterAffinityToNetwork` slider (0 = scattered, 1 = node-locked)

## Stage 1 verification — two-gate review

**Gate 1 — quantitative in-gen asserts (dev-only throws):**

| Assert | Fail condition |
|---|---|
| No building overlaps | Any two building footprints' AABBs intersect |
| No building in highway corridor | Building centre within `highway.halfWidth` of highway polyline |
| No building in arterial corridor | Building centre within `arterial.halfWidth` of arterial polyline |
| Valid lots | Every lot has area > 0 and width ≥ zone-minimum |
| Setback respected | Building footprint within (lot ⊖ setback) |
| District count matches topology | Crossroads=4, Bypass=2, Ring=2, Ring+radial=4–6 |

**Gate 2 — two-pass eyeball review:**

*Pass A — Plan view (correctness):*
- New `/plan` route, like `/palette` precedent
- Grid of 12–20 seeds, top-down ortho, each tile with topology label
- Layers via Districts + Roads panels: highways (thick), arterials (medium), block boundaries (thin), district fills tinted by character, zone overlay, featured-cluster outlines + labels, streetlight dots coloured by kelvin, building footprints opacity-shaded by height
- Used to confirm grammar correctness across topologies/districts/silhouettes

*Pass B — Orbit view (vibe):*
- Same seeds rendered at canonical orbit distance via `bun run capture` → `/samples/stage1-candidates/`
- Bar: ≥16/20 (80%) seeds feel categorically different — not 20 variations of one template
- Failures lead to weight tuning, not grammar regen

**Post-Stage-1 polish:** plan view promotes from `/plan` route to a camera-mode toggle in main scene via existing `ProjectionBlender.tsx`. Earns its keep only if revisited after Stage 1 ships.

**Regression baseline:** the ≥16 accepted seeds get pinned in `samples/curated/stage1/`. Stage 2 must reproduce these or explain divergence.

## Block subdivision regularity

Per-district `regularity` value ∈ [0, 1] drives subdivision style — one algorithm, one knob.

- 0.0 — rigid recursive halving on long axis, no jitter
- 0.3 — cut position ±15%, long-axis preferred
- 0.6 — cut position ±25%, occasional cross-axis cut, slight cut-line wobble
- 0.9 — cut position ±40%, frequent axis-skip, occasional non-axis-aligned (Voronoi-light) cut

**Per-district defaults:**

| District character | Regularity |
|---|---|
| Downtown high-rise | 0.10 (CBD regulations tight) |
| Subcentre high-rise | 0.20 (master-planned-later) |
| Industrial | 0.15 (single-owner mega-parcels) |
| Mixed-use | 0.45 |
| Residential | 0.35 (subdivision varies by era) |
| Heritage | 0.85 (pre-planning organic) |

Defaults exposed in Districts panel as per-district override sliders. Generates Manhattan-rigid CBD next to Greenwich-Village-organic Heritage next to suburban-jittered Residential — all from one recursive subdivision routine with different parameters.

## District naming

Each district carries two name fields:

- **ID** — stable identifier (`district-0`, `district-1`, …), used in code, logs, Districts-panel toggles, regression snapshots
- **Display name** — `cardinal + character`, derived from district centroid relative to city centre

Algorithm:

```
for each district:
  if count[character] == 1:
    display = character             // "Downtown", "Heritage"
  else:
    angle = atan2(centroid - cityCentre)
    rose  = snap-to-8(angle)        // N, NE, E, SE, S, SW, W, NW
    display = `${rose} ${character}` // "North Heritage", "Southwest Industrial"
```

If two districts share a character + rose, secondary disambiguation: shift one to the next-nearest rose direction. Final fallback: append a numeric suffix.

Proper-noun overlay ("Brookmoor Financial District") deferred as Stage 2+ flavour layer.

## Industrial / high-rise interface

Stage 1: lean matrix. No new district character. Mixed-use carries soft-edge work between high-rise and Industrial via existing zone biasing.

Stage 2: **`transitional-bias` flag on Mixed-use polygons adjacent to Industrial polygons.** Flagged polygons skew archetype roll toward warehouse-conversion + loft + low-flat brick — the contemporary post-industrial signature (Brooklyn Dumbo, LA Arts District, London Shoreditch, Berlin Friedrichshain). One boolean, no new character; reuses existing matrix.

Stage 3+: optionally promote `transitional-bias` clusters to a full *Post-industrial* district character with own silhouette behaviour (low-flat brick + scattered conversion towers).

## District merging across highways

Stage 1: strict rule. Highways are absolute district boundaries.

Stage 2: cheap promotion — when two same-character districts sit on opposite sides of a highway, collapse to a shared *display name* and annotate `severed-by: <highway-id>`. Geometry unchanged. Districts panel can optionally render a dashed connecting line. Adds the "this district was cut by a highway" story without geometric merging.

Geometric merging (asymmetric subdivision regularity per half, ~5–10% seed roll) explicitly dropped — payoff doesn't read at orbit distance.

## Heritage adjacency buffer

Literal view-corridor rules (London St Paul's / Edinburgh) don't translate — slow-orbit camera has no fixed viewpoint to protect.

Replaced with **Heritage adjacency buffer**: neighbouring polygons within distance `D` of a Heritage district's boundary get a height-cap multiplier scaled by distance — 0.5× at edge ramping to 1.0× at distance D.

- Stage 1: no buffer. Heights live entirely off the zone × district matrix.
- Stage 2: optional buffer parameter (default `D = 80 m`). Tunable via Districts panel slider.

Real-planning analogue: *transition zone* / *height step-down* in NYC Special Historic District zoning. Heritage districts visually "feel respected" by neighbours stepping toward them.

## Podium-and-tower (Pacific Rim flavour)

Real urban form: wide low *podium* (3–6 floors, retail/parking/lobby, covers ~85% of lot) with a slender *tower* covering ~45% of podium footprint rising from it. Hong Kong / Vancouverism / Singapore / Sydney / Dubai signature.

- Stage 1: not introduced. Existing archetypes carry American / European skyline grammar.
- Stage 2: add `podium-tower` archetype to high-rise district archetype pool. Geometric form = wide podium (~85% lot × 8–15 m) + thin tower (~45% podium footprint × per-matrix-cap). Two `InstancedMesh` draw calls (one podium, one tower) or single extruded stepped mesh.
- **Pacific Rim flag**: per-seed roll that boosts podium-tower archetype rate to ~50% in Subcentre / Downtown high-rise districts. Without flag, podium-tower stays at ~10% minority rate. Adds a *city-cultural* axis to seed diversity — one of the strongest "different seeds = different cities" levers.

Visual payoff is high; podium-tower is the most distinctive missing archetype globally. Tower-bases-fatter-than-tower-tops reads instantly at orbit as not-Manhattan.

## Streetlight planning rules

Modern-city assumption (post-LED-retrofit, ~2020 baseline). Two-axis defaults: per-road-tier dominant, per-zone fallback for local-streets only.

**Per-tier (uniform across map):**

| Tier | Kelvin |
|---|---|
| Highway | 4000K LED, mount 12 m, spacing 50 m |
| Arterial | 4000K LED, +50% intensity, mount +2 m, spacing 35 m |
| Local | per-zone default below |

**Per-zone (locals only):**

| Zone | Kelvin | Spacing | Mount |
|---|---|---|---|
| Residential | 2700K warm LED | 30 m | 6 m |
| Commercial | 3500K LED | 25 m | 8 m |
| Industrial | 4500K LED | 35 m | 10 m |
| Mixed-use | 3000K LED | 28 m | 7 m |

**Per-light variant chance** — 4% of lights roll to a *different* common kelvin from the matrix (one-batch-replacement realism, no exotic tech). Tunable via Roads panel `variant-bulb-chance` slider.

**District overrides:**
- Heritage — mount height drops to 4–5 m (pedestrian-scale posts), kelvin tracks Residential, variant-bulb-chance bumped to 8% (legacy-mix infrastructure)

**Failure / flicker** — reuse window TV-flicker shader math in `lib/shaders/window.ts`. ~3–5% of lights flagged `isFailing` → constant-dim OR slow-flicker via same `uTime`-based path. Failure period compressed to 10–20s phase for orbit visibility. No new flicker system.

Gas-lamp / mercury-vapor / pure-sodium-as-default not modelled (live infrastructure rarity globally outside London Westminster ~1,500 surviving gas lamps).

## References

- **Urban Code: 100 Lessons for Understanding the City** (Mikoleit & Pürckhauer, MIT Press 2011) — flagged by user as primary reference. Most of its 100 lessons sit *below* v1 camera resolution (ground-floor commerce, signage, awnings); revisit when a close-camera milestone is scheduled.
- Kevin Lynch, *Image of the City* (1960) — origin of *Landmark* silhouette template name and the perceptual-district frame ("Districts" panel name).
- NYC 1916 Zoning Resolution — origin of *Wedding cake* setback skyline.
- FHWA functional classification — road hierarchy collapsed to Highway + Arterial for v1.
- Joel Garreau, *Edge City* (1991) — Subcentre placement on bypass / ring topologies.
- Parish & Müller, *Procedural Modeling of Cities* (2001) — closest existing procedural reference.
- [[city-planning-references]] — pre-existing research note (multi-grid + diagonal arterials).
- [[building-sizes-real-world-references]] — meters reference for block + building dims.

## Related decisions

- [[decision-district-based-city-layout]] — **superseded** by this note.
- [[decision-prd-v1-architecture]] — rendering + state model still valid.
- [[decision-1-unit-equals-1-meter]] — unit convention preserved.
