---
tags:
  - domain/city-gen
  - status/adopted
  - scope/m3-plus
  - origin/external-research
---

# Decision: District Count + Absolute-Distance Character Bands (#49)

**Date:** 2026-06-03 · shipped to `main` (`15ae20e`).

## Context

After the #14 generate-at-max migration (MAX = Metro, 16× the City area), the district
system was extent-blind:

- **Count:** the sliver-merge floor was a *fraction* of the map
  (`NET_MIN_AREA_FRACTION 0.045`) → ~1.6 km² at Metro → collapsed the city to ~10
  giant districts.
- **Character:** rank-based (`subTarget = 1 + ⌊n/5⌋` innermost = high-rise) → the
  high-rise core grew with the city. Measured: the default crop (R ≤ 1500) read
  **84–98% high-rise**; the gradient to residential lived entirely in the
  cropped-away ring.

User feedback: "more districts, gradiate to lower density sooner, ultra high-rise too
abundant."

## Decision

1. **Count scales with the city:** merge floor is now an ABSOLUTE min district area
   (`TARGET_MIN_DISTRICT_AREA ≈ 0.36 km²`, clamped) → district *size* roughly constant
   across extents, *count* grows (~10 → ~45 at Metro). Cap raised 24 → 48 (gate1 band
   → [6, 48]).
2. **Character by ABSOLUTE distance bands** (Clark 1951 — built density declines
   ~exponentially from the CBD; real downtowns stay ~1–2 km even in huge metros):
   - downtown core pinned at `R_DOWNTOWN ≈ 650 m` (does NOT grow with the city),
   - subcentres in 650–1150 m, **capped at ~2** (largest-area in band),
   - mixed-use belt to ~1900 m, **residential = the bulk** beyond, industrial fringe
     at the rim.

   Downtown stays fixed-size; residential grows with the city.

## Result (measured, 10 seeds — `scripts/analyzeDistricts.ts`)

high-rise footprint at the crop edge **84% → 30%**; residential **4 → 28** districts;
subcentre **2.8 → 1.7**; districts **10.5 → 44.9**.

## Consequences

- One-time seed shift (accepted); golden reblessed; gate1 PASS, cross-crop PASS.
- Bands are absolute world metres → robust under any crop or future per-device extent
  tier (#53).
- **#49 partially addressed** — density gradient + count are done; "curvilinear
  suburbs" + "undeveloped fringe" curves remain open.

Refs: `lib/seed/district.ts`, `scripts/analyzeDistricts.ts` + `scripts/renderPlanPng.ts`
(browser-free viz), #49. Builds on [[decision-network-aligned-districts]].
