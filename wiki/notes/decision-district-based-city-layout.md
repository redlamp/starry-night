---
tags:
  - domain/3d
  - domain/visual-language
  - status/superseded
  - scope/m1
---

# Decision: District-Based City Layout

**Date**: 2026-05-21
**Status**: Superseded 2026-05-26 by [[decision-streets-first-city-generation]] — that note inverts the generative axis (streets-first, network drives district placement) rather than districts-with-hardcoded-bboxes.

## Context

Camera orbit is on the M2/M3 roadmap. The 3-row stripe layout and the later single-grid layout both look fine from the canonical front-facing camera but fall apart from oblique angles — visible seams of identical orientation, no diagonal energy, no sense of city history. Real cities don't look like that.

See [[city-planning-references]] for the survey of real planning patterns.

## Decision

City composes from **3–6 districts**. Each district has:

- World position and footprint (axis-aligned bounding box for v1; polygons later)
- A **grid rotation angle** (its local axes are rotated around Y from world axes)
- Its own block size and street width ranges
- A **character** (downtown / residential / industrial / oldtown) that biases archetype and lighting profiles
- A **regularity** value: rigid grid, jittered grid, or organic cells

City also has **0–2 diagonal arterials**: wide streets at 25–45° to a base axis, cutting across districts, leaving boundary-facing buildings along their sides.

District placement, rotation, sizes, and arterial paths are all derived from sub-seeds of the master seed. Determinism intact.

## What changes in code

- `Building` gains a `rotationY` field (radians around Y) so each building can face its stripe direction
- `cityGen` rewritten:
  - Generate district set first
  - For each district: generate blocks in local rotated frame, transform centers to world, fill with stripes
  - Building stripe orientation derives from district rotation
- `Building.tsx` mesh applies `rotation-y={data.rotationY}` so geometry rotates with the stripe
- New layer assignment: keep `front/mid/back` based on world z relative to camera-facing axis, plus an additional `district` field for future biasing

## What this preserves

- Shader-based windows (the load-bearing rendering decision) — works identically on rotated buildings, since the shader uses face normals to detect side facades
- Deterministic generation — districts derived from `masterSeed`
- Real-world units in meters — block sizes still in meters per district

## What this does NOT yet do

- Voronoi / organic cells for old quarter (start with jittered grid for all districts; add organic later)
- Diagonal arterials (planned, not built in this first cut)
- Geographic distortion (rivers, hills) — deferred with terrain
- Real GIS feed — deferred to M2+ as an optional alternative generator

## Plan for first cut

5 axis-aligned districts at varied rotations:

| District | Center (x, z) | Size (W × D) | Rotation | Character |
|---|---|---|---|---|
| `downtown` | (0, -120) | 240 × 200 | 0° | downtown — small blocks, tall |
| `oldtown` | (-200, -60) | 160 × 140 | +22° | organic — small irregular blocks, low-rise |
| `residential-west` | (-260, 70) | 200 × 200 | +10° | residential — medium blocks |
| `residential-east` | (260, 30) | 220 × 220 | -8° | residential — medium blocks |
| `industrial-south` | (40, -400) | 400 × 160 | +3° | industrial — large blocks, warehouses |

District angles chosen to keep clear visual contrast between neighbours.

## Related

- [[city-planning-references]] — the references this is based on
- [[decision-streets-of-rage-direction]] — visual style anchor
- [[building-sizes-real-world-references]] — meters reference for block + building dims
