---
tags:
  - domain/city-gen
  - status/adopted
  - scope/m3-plus
---

# Decision: Density Gradient Model (#49)

**Date:** 2026-06-07 · on `feature/suburbs-v2`.

## Context

#49 rebuild of the parked Stage-0 spike (`feat/suburbs-density`), per the
review feedback in [[plan-metro-suburbs-highways]]. The spike normalised
density by the extent and thinned per LOT — both rejected.

## Model

**Absolute-distance falloff, two layers, four bands** (`lib/seed/density.ts`):

- **Radial layer** — Clark's-law exponential `exp(-r/1675 m)` on ABSOLUTE
  distance from the city centre, warped by 3 seeded angular harmonics (k=2/3/5,
  ±≤20% band-edge wobble) so the city is an organic blob, not a bullseye.
  Absolute metres (like district.ts's character bands), NOT normalised by tier
  extent: growing the tier **adds** outer bands instead of stretching the same
  gradient — Town (3 km) is core+suburbs; rural/fringe only open up at the big
  tiers. No district dependency, so ROAD generation consumes it (districts
  derive from arterials — a per-district field would be circular there).
- **Per-district layer** — radial base at the centroid ± 0.12 jitter, with hard
  per-character floors (downtown 0.82, subcentre 0.66 ≥ core threshold —
  "subcentre stays lit like core"; residential 0.08/industrial 0 so the rim
  fades freely). Building/lamp/window consumers read this one: the fade lands
  on district seams.
- **Bands:** core ≥ 0.62 · suburban ≥ 0.30 · rural ≥ 0.12 · fringe below.

## Consumers (all gate1-clean, verified by counts + captures)

1. **Buildings** — block-coherent dropout via ~150 m hash-seeded development
   cells (`buildDevelopmentMask`): a cell either develops (fabric stays FILLED)
   or doesn't (whole-parcel gap) — never the spike's per-lot missing teeth.
   Plus archetype tilt (low-rise dominated) + 0.72× size shrink for
   residential/mixed as density falls; interior fill fades to yards.
   Measured at City tier: ~870/km² core (avg 58 m) → ~640 suburban (8 m) →
   ~190 rural → ~15 fringe.
2. **Streetlights** — sparseness is SPACING, never brightness: local-street
   lamp spacing stretches ×(1+1.5·suburb) and switches to one-sided staggered
   (zig-zag) past suburbAmount 0.35; never zero. Highway/arterial lamps exempt.
3. **Road network** (`tensorStreets.ts`) — the night gradient is decided here:
   arterial SEED gate (new arterials stop being born as density falls) +
   arterial SEPARATION ramp (converging through-lines terminate at band edges;
   survivors = the radial spokes, ~1 per suburb district) + street-sep ramp
   (tight through suburbs so subdivision reads, opening to country lanes in
   rural). Sketch cities (#40) bypass all gates.

4. **Suburban street character** (increment 5) — the review's "different
   mechanism, not more waviness": post-trace **domain warp** on minor streets
   (seeded plane-wave displacement scaled by suburbAmount, endpoint-tapered so
   junctions stay anchored; parallels sample the same warp → spacing holds;
   arterials stay straight) + **cul-de-sac stubs** grown off suburban minors
   into block interiors (separation-checked against the final warped geometry,
   real dead-end terminals) + **block-size jitter** (low-freq noise on the
   street-sep ramp). Both passes run on their own seeded streams after
   tracing; the boot blueprint streams unwarped lines (≤14 m transient
   mismatch under the road reveal — accepted).

## Remaining (#49)

Residential warm-sparse window signature; per-seed suburb variety (warp
amplitude + stub chance are seeded but the spread is narrow); rural cluster
bias toward the spokes (development cells are uniform-random).

Relates: [[plan-metro-suburbs-highways]], [[decision-additive-growth-citygen]],
[[decision-tensor-field-roads]].
