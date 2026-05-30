---
tags:
  - domain/3d
  - domain/visual-language
  - status/adopted
  - scope/m2
  - origin/external-research
---

# Decision: Grid-First City Generation

**Date**: 2026-05-30
**Status**: adopted — grilled end-to-end on 2026-05-30 (see [[2026-05-30]]); informed by two agent workflows (current-generator map + grid-technique design/judge panel).

**Partially supersedes** [[decision-streets-first-city-generation]]. That note's *grammar* stays valid — district characters, silhouette templates, zone palette, height-cap matrix, streetlight planning, naming, heritage buffer, podium-tower. This note replaces its *road-network + block-formation mechanism* (pipeline steps 6–11): the arterial model, the per-district rotated-grid + stripe-fill block generator, and the "streets-last" ordering.

## Why this decision exists

The shipped generator (`lib/seed/*`) implemented only **Stage 1** of the streets-first plan and diverged from it. Two concrete failures, confirmed by reading the code:

1. **The radial "starburst".** `arterials.ts:80-91` lays 6–8 arterial spokes from the single most-central district out to the map edge, in **100% of seeds, under every topology**. This — not the 10% ring-radial *highway* case — is the radial mess seen from above. It directly violates the streets-first note's own spec ("arterials interior to a district, 3–6 per seed").
2. **Streets-last, not streets-first.** Districts are Voronoi cells with their own independently-rotated block grids (`cityGen.ts:600-625`); arterials/highways are bolted on afterward and buildings merely deleted where they collide. Blocks are never bounded by roads. Adjacent districts' grids don't align; buildings stand 15–30 m off the street (corridor-rejection margin) instead of forming a street wall.

The realism the user wanted — coherent grid, buildings flush-ish to the street, blocks that read as filled — is partly the **unbuilt Stage 2**, but Stage 2's *own* arterial model is also radial. So rather than finish a flawed plan, we re-grounded the road model in **how real (American) cities form**.

## The model

**Grid-first.** A coherent street grid is the primary substrate, laid before buildings. Districts are **zones painted over the grid** — they differ by block size, density, zone, and height, **mostly not by orientation**. Built as successive **layers laid over time**:

1. **Grid substrate** — the platted street grid. Continuous lines; intersections + blocks are *emergent* (see invariant below).
2. **Legacy diagonals** — 0–3 rare pre-grid roads (Broadway / Woodward style) crossing the grid at real intersections. The only sanctioned non-grid surface lines.
3. **Highways** — the topology layer (Crossroads / Bypass / Ring / Ring+radial, from the streets-first note) laid last; the only large curves/rings. Rings sized to the real built extent (rides with city-scale issue #14; only an arc may cross frame).

### The load-bearing invariant: lines-first

> **Roads are continuous lines. Intersections and blocks are emergent faces of their overlay. No isolated intersection is ever placed.**

This is *why* the model cannot **cross-hatch** (the scattered, non-connecting "+" pieces of past failed experiments — see CONTEXT.md `Cross-hatch`). A grid is two families of continuous lines; diagonals and highways are more lines laid over it; every crossing is a real intersection by construction. The failed approach was *intersection-first* (place crosses, hope stubs meet); this is its opposite.

### Patchwork via a center-anchored orientation field

Chosen over a single shared grid (the workflow's safer pick) for higher realism, made safe by two constraints:

- **Center-anchored orientation field.** One base angle θ₀ at the city center; orientation drifts smoothly outward, **sampled once per district** at its centroid. Neighbours therefore differ only slightly (the field is smooth) → seams are inherently low-angle. Drift magnitude is a **tunable knob** (default ≈ ±20°). Effectively a simple radial orientation field — the tensor-field coherence idea kept dead simple. The coherent core is where wedge anomalies (below) live; the periphery loosens.
- **Continuous seam streets.** Voronoi cell boundaries become real seam streets (~12–16 m); each district's local streets **dead-end (T-junction) into** the seam — they never line-match the neighbour's grid. Borrowed from the workflow's candidate-A guarantee: neither grid depends on the other, so the seam cannot cross-hatch regardless of the angle it absorbs. Small-district clamp: districts under ~4 cells keep their boundary cells.

### Districts + Voronoi metric

Reuse the existing Voronoi `DistrictField` (`lib/seed/district.ts`). Switch the metric from squared-Euclidean (L2) to **Chebyshev L∞ evaluated in the core frame θ₀** → rectilinear, map-like seams aligned to the downtown grid (peripheral rotated grids T into them). L1 (45° seams) is the alternative; both are a one-line swap at the distance test, easy to A/B on `/plan`. See [[voronoi-diagrams]] and [[taxicab-geometry]]. (L∞ chosen because its bisectors tend axis-aligned; note L1/L∞ can create equidistant "plateau" ties needing a seeded tie-break.)

### Arterials

The starburst is **deleted**. Arterials are now the **heavy lines of the grid** — every Nth grid line (downtown ≈ every 3rd, residential ≈ every 5th; N tunable) — **plus** the heaviest promoted **seam runs** (finally fulfilling `district.ts:8`'s unkept promise that Voronoi edges are where arterials are laid). All lattice-aligned, so continuity holds.

### Zones (land-use grain)

A per-block **zone field anchored to the road hierarchy**: commercial hugs arterials + center, industrial hugs highways + map edges, residential fills block interiors, mixed-use transitions between. Contiguous (a field, not per-block noise). **Per-district gradient + a mild city-wide center boost** so each district has internal structure and downtown still reads as the global peak. Zone drives fill style, height cap, and archetype mix (zone palette + height matrix from the streets-first note).

### Building fill — zone-driven hybrid

Per block, fill style depends on zone:
- **Commercial / downtown** — perimeter **street-wall** (boxes lining the block edge) + interior towers.
- **Residential** — lot rows (boxes along frontage).
- **Industrial** — 1–3 big parcels.

Buildings sit at a small **per-zone sidewalk setback** (~2–8 m, wider in dense cores) forming a street wall — replacing the 15–30 m ragged standoff. This is the structural fix for "flush to the street / blocks read as filled."

### Building geometry

The PRD §5 "no new mesh per variant" rule is **relaxed** to its real intent: *a handful of shared instanced shapes, each mass-produced* (forbidden = a unique mesh per building). All fill styles are **arrangements of the existing box archetypes**; podium-tower = a stacked wide-box + narrow-box pair. One simple new shape is admitted: the **flatiron / wedge** — a four-sided trapezoidal box (one short end face, fewer window columns) filling triangular lots where a diagonal/steep seam cuts the grid — **downtown only**; outer slivers stay open (plaza/park). See CONTEXT.md `Flatiron / wedge building`.

## Decision record: A vs B

The grid-technique workflow (10 agents) recommended **candidate A** (one shared city-wide lattice — cross-hatch *structurally* impossible) over **B** (true per-district rotated patchwork — higher realism, but its line-snap seam was "the exact operation that historically produced the cross-hatch"). We chose **B** for realism, but **adopted A's continuous-seam guarantee inside it** and added the **center-anchored drift** to keep adjacent angles small. So: B's look, A's safety. If orbit playtest still reads flat, the fallback is to lean further toward A (shared lattice as skeleton) without re-importing B's snap.

Rejected: candidate C (recursive subdivision — heaviest, 100–300 ms) and D (tensor-band blend — most code).

## Browser-executability

All generation stays a **one-time, deterministic** pass at seed load (no per-frame cost); output remains `InstancedMesh` archetypes + the `(windowSeed, uTime)` shader contract (untouched). The L∞ metric is cheaper than the current squared-L2; the lattice claim loop is single-digit ms. The new lattice/orientation field **must be a pure function of the master seed** living in one module (proposed `lib/seed/lattice.ts`) because generation is recomputed independently by 9+ components (InstancedCity, Arterials, Roads, DistrictShells, Streetlights, PlanView, DistrictsPanel, Beacons) — any divergence desyncs the city.

## Verification

- Extend `scripts/gate1.ts` (OBB/SAT overlap, corridor clearance, district count, in-bounds, full-CityData determinism) — and consider extending the determinism check to streetlights/arterials in isolation.
- `/plan` 16–20-seed grid as the **A/B regression harness**: land the rework behind a flag, compare old vs new before flipping.
- Capture orbit + `/plan` screenshots per the visual-verification feedback rule before claiming done.

## Biggest risks (carried from the workflow)

1. **Aesthetic flatness** if drift is too low — mitigated by the tunable drift + the A-fallback.
2. **Fragmented-generation desync** — mitigated by a single pure `lattice.ts` + determinism gate.
3. **L∞ thin/plateau cells** — may need re-tuning `placeSeeds` min-distance + merge (tuned for L2).
4. **Seam reservation over-thinning small districts** — the <4-cell clamp is mandatory.
5. **#7 road-facing snap** interaction with the now-straight arterials must be re-validated against gate1.

## References

- [[voronoi-diagrams]], [[taxicab-geometry]] — the partition + metric math.
- [[city-planning-references]] — multi-grid / diagonal / seam patterns in real cities.
- [[decision-streets-first-city-generation]] — grammar still in force; road mechanism superseded here.
- Chen et al. 2008, *Interactive Procedural Street Modeling* (tensor fields); Parish & Müller 2001, *Procedural Modeling of Cities* (subdivision) — surveyed, informed the candidate set.
