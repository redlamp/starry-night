---
tags:
  - domain/chess-engine
  - domain/stack
  - status/adopted
  - origin/v1-failure
---

# Decision: Tensor-Field Roads (Streets-First, the Real One)

**Date:** 2026-05-31

## Context

The earlier city generators read as "slop" from above (see [[decision-grid-first-city-generation]], [[decision-streets-first-city-generation]], [[decision-district-based-city-layout]]). Root cause, confirmed by reading the code + an adversarial design review: the generator was **district-first**, not streets-first. Districts were Voronoi blobs; each stamped a rotated rectangular block array across its own bounding box at its own rotation; the drawn roads (random-tilt topology highways, radial arterials, Voronoi-seam streets) were *separate passes the blocks never referenced*. Three+ non-aligned line families + radial spokes = spider-web.

User direction (after seeing real references + the r/proceduralgeneration tensor-field post): use **tensor fields** for roads, à la ProbableTrain MapGenerator + Parish-Müller. The "no spider-web" rule was specifically about a *cheap* execution (3–4 straight roads through one point), **not** a ban on curves or well-formed radial/plaza districts.

## Options considered

1. **Structured axis-aligned grid** (interim, shipped + discarded). Continuous rectangular grid, one orientation. Clean Manhattan look, ~190 lines, bulletproof. But mechanical/uniform; user wanted organic.
2. **Full tensor field + planar-graph face extraction → lots → buildings.** The "correct" CityEngine pipeline. Adversarial review rated the hand-rolled planar face walk *not robust* (silent block-merges) and over-engineered for a top-down night view.
3. **Tensor field roads + frontage building fill (chosen).** Trace streamlines for roads; skip explicit planar-graph faces; place buildings by lining the street frontage. Gets the organic tensor look without the fragile face extractor.

## Chosen

**Option 3.** Pipeline:

- **Tensor field** (`lib/seed/tensorField.ts`): a 4×4 lattice of *grid* basis fields oriented by the existing center-anchored lattice (θ0 + squared edge-drift) plus per-seed **waviness**; ~35% of seeds add ONE compact off-centre *radial* field (a roundabout/plaza district — rings, not a city-wide starburst). Pure math, no RNG in `sample()`.
- **Streamlines** (`lib/seed/tensorStreets.ts`): RK4 integration of the major + minor eigenvector families at TWO separation scales — sparse (arterials) + dense (minor streets). Both families at both scales, so arterials criss-cross and streets criss-cross; same-family roads space apart, cross-family roads cross freely. Strictly two-phase deterministic seeding (drain a sorted arterial-endpoint queue, then seeded PRNG).
- **Roads** (`cityGen.ts buildTensorRoads`): ring-like arterials are demoted to streets (a circle is never an arterial/highway); the longest straight arterial is promoted to the single **highway** (highways no longer the random-tilt topology set). Radial spokes dropped.
- **Buildings** (`cityGen.ts fillTensorBuildings`): walk each street + arterial both sides, lay tight rows of road-facing buildings set just off the kerb. Footprint corners + centre cleared against the whole road network (corridor-safe); SAT overlap rejection (overlap-safe). Block interiors left open — no orphan buildings. All archetype / height / silhouette / window logic reused unchanged → the `Building` contract the renderer + window shader consume is identical.

**Tensor is the default and only intended city model.** `generateCity` / `generateStreetlights` default to it; the 3D scene picks it up automatically (it passes a plain seed). Legacy + interim-grid bodies are dormant/unreachable, pending a dead-code purge.

## Why

- Organic-but-coherent roads (curves, the occasional roundabout) without the spider-web — the field is a sum of *grids*, whose eigenvectors never converge on a point.
- Robust + deterministic + **headlessly verifiable** (no screenshots needed): `gate1` asserts 0 overlaps, 0 corridor hits, district count in band, in-bounds, determinism, on 20 seeds.
- Avoids the highest-risk algorithm (planar-graph face extraction) the review flagged.

## Verified

`gate1` PASS on 20 seeds (tensor default): ~1,500 buildings/city, 0 overlaps, 0 corridor hits, deterministic. Build green. Visual sign-off across several iterations (street density, criss-cross arterials, frontage buildings, no orphan interiors).

## Still ahead

Explicit block + lot polygons; districts that follow street/arterial bounds (not Voronoi); per-character street density; purge the dormant legacy/grid code. Research queued on districting, procedural building enhancement, star/fog appeal, and car head/tail-lights.

Supersedes the geometry-ownership parts of [[decision-grid-first-city-generation]] and [[decision-streets-first-city-generation]] (their building-grammar + silhouette decisions still hold).
