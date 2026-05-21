---
tags:
  - domain/3d
  - domain/stack
  - status/adopted
  - scope/foundation
---

# Decision: 1 world unit = 1 meter

**Date**: 2026-05-21

## Context

Three.js / R3F has no enforced unit. Convention in the three.js docs and most physics integrations (cannon, rapier) is 1 unit = 1 meter. We adopt that for this project.

## What this fixes

Without an agreed-upon scale, every authored value drifts: cameras placed by visual feel, buildings sized by what "looks right" relative to the camera, window proportions tuned in isolation. Internal ratios stop making sense — e.g., a 26-unit-tall residential tower with 30 floors = 0.86 units per floor, which is impossible at any real scale.

Picking meters means:
- Buildings can be authored to real architectural dimensions
- Cell sizes in the window shader correspond to realistic per-floor heights
- Camera positions translate to intuitive eye-level / drone-altitude values
- Future physics, vehicles, characters drop in without rescaling

## Reference scales

| Thing | Real range | What we use |
|---|---|---|
| Floor-to-floor (residential) | 2.7-3.2 m | ~3.0 m |
| Floor-to-floor (office) | 3.5-4.5 m | ~3.5 m |
| Window width (residential) | 0.9-1.5 m | ~0.9 m |
| Window height (residential) | 1.2-1.6 m | ~1.5 m |
| Window-to-window spacing | 3-4 m | ~3.5 m |
| Low-rise building height | 6-12 m | 2-3 floors |
| Mid-rise | 12-25 m | 4-7 floors |
| High-rise residential | 24-45 m | 8-14 floors |
| Office tower | 35-70 m | 10-20 floors |
| Spire | 60-120 m | 18-35 floors |
| Urban block dimension | 60-120 m | future work |
| Street width | 12-30 m | future work |
| Adjacent building gap (dense) | 0-3 m | dense urban |
| Eye level (standing human) | 1.6-1.8 m | future ground cam |

## How to apply

- Author all geometry in meters from now on
- Floor counts derive from height: `floors ≈ height / 3.0` (residential) or `height / 3.5` (office)
- Column counts derive from width: `cols ≈ width / 3.5`
- Camera positions named in meters (5 = 5m / waist-ish, 30 = 30m / 10th floor, etc.)
- See [[building-sizes-real-world-references]] for the v1 archetype dimensions
