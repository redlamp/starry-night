---
tags:
  - domain/3d
  - domain/visual-language
  - status/adopted
  - scope/m1
  - origin/external-research
---

# Building Sizes — Real-World References

Working sizes for v1 archetypes, in meters (see [[decision-1-unit-equals-1-meter]]).

## Floor-to-floor heights

| Use | Range | Note |
|---|---|---|
| Residential apartment | 2.7-3.2 m | 3.0 m baseline |
| Older walk-up apartment | 2.8-3.0 m | |
| Office (modern) | 3.5-4.5 m | Plenum + ceiling |
| Office (older) | 3.2-3.8 m | |
| Retail / ground-floor commercial | 4-6 m | Taller than upper floors |
| Industrial / loft | 4-6 m | |

## Window dimensions (single typical sash)

| Use | Width | Height |
|---|---|---|
| Residential bedroom | 0.9-1.2 m | 1.2-1.5 m |
| Residential picture | 1.5-2.5 m | 1.5-1.8 m |
| Office ribbon (per pane) | 1.5-3.0 m | 1.2-1.8 m |
| Storefront | 2-4 m | 2-3 m |

Window-to-window horizontal spacing: typically 3-4 m centerline-to-centerline in residential.

## v1 archetype dimensions

Picked to land inside realistic bands while staying expressive at low-poly. All in meters.

| Archetype | Width (W) | Depth (D) | Height (H) | Floors | Cols/face |
|---|---|---|---|---|---|
| `low-rise` | 10-18 | 8-14 | 6-9 | 2-3 | 3-5 |
| `mid-rise` | 14-22 | 12-18 | 15-25 | 5-8 | 4-6 |
| `residential-tower` | 16-26 | 14-20 | 24-42 | 8-14 | 5-8 |
| `office-block` | 22-40 | 18-30 | 35-65 | 10-19 | 6-11 |
| `spire` | 16-26 | 16-26 | 60-110 | 18-32 | 5-7 |

Per-cell area ≈ 3.0-3.5 m wide × 3.0-3.5 m tall, so shader-painted windows at `(0.3, 0.5)` cell-fill give ~0.9 m × 1.5 m visible windows — apartment-window range.

## Building spacing

| Pattern | Real range | Our use |
|---|---|---|
| Dense urban / row | 0-3 m | default within a row |
| Mid-density | 5-15 m | occasional gap (10% chance) |
| Street / avenue | 12-30 m | future block-layout work |
| City block | 60-120 m per side | future work — currently row-based, not block-based |

## City framing

| Thing | Size |
|---|---|
| City total width (visible skyline) | ~180 m |
| Front layer Z | ~+20 m (closer than origin) |
| Mid layer Z | ~-10 m |
| Back layer Z | ~-50 m |
| Camera position (default still) | y ~12 m, z ~120 m |
| Camera lookAt | y ~25 m, z ~-30 m |
| Camera FOV | 45° |

## What this does NOT yet cover

- Block-based street/avenue layout (parallel rows of buildings separated by streets, with cross-streets — proper city blocks)
- Sidewalks, road dashes, streetlight spacing
- Variation by district (downtown vs residential vs industrial)
- Mixed-use buildings (retail at ground, residential above)

Captured as backlog after still-frame review.
