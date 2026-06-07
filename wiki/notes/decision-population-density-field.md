---
tags:
  - domain/city-gen
  - status/adopted
  - scope/m3-plus
---

# Population Density Field + Traffic Coupling

2026-06-07 · user request: "arterials and streets business should reflect the
area they're in… apply some sense of population based on building sizes and
number of buildings. That population density can have an impact on the road
business for that area."

## The model

`lib/seed/population.ts` — a people-equivalent estimate derived **entirely
from the generated buildings**, no rng:

- per building: `floor area × floors × occupancy(archetype) × use(class)`.
  Occupancy is people/m² (residential-tower 0.03 → warehouse 0.002); the
  4-way lighting class layers zone use on top (residential 1.15 →
  industrial 0.35).
- binned to an 80 m grid over the tier extent, two box-blur passes
  (≈160 m Gaussian) → neighbourhood scale.
- normalised against **p99, not max** — one supertall cell must not crush
  the ramp.
- memoised with `generateCity`'s exact cache key (tier/sketch/deviation
  included). Pure derivation → determinism is free; gate1 PASS.

## Consumers

1. **Heat map** (`components/scene/PopulationHeatmap.tsx`): one plane,
   CanvasTexture through an inferno-style ramp (alpha ≈ 0 over the fringe),
   same GIS-layer treatment as [[decision-network-aligned-districts]]'s
   shells (depthTest off, renderOrder 1001, toneMapped off). Toggled from
   Population → Density; `cityPlanning.showPopulationHeat`, persisted.
2. **Traffic** (`lib/seed/traffic.ts`): per macro-segment multiplier
   `busyness(pop) = 0.12 + 0.88·min(1, (pop/0.45)^0.7)`, blended by
   `traffic.popCoupling` (0–1 slider, default 1). **Saturates at pop 0.45**
   so downtown keeps its established stream — the coupling only removes
   cars from quiet bands. **Highways exempt** (through-traffic; same logic
   as the streetlight mains-exempt rule in
   [[decision-density-gradient-model]]).

Verified numerically at tier 4 / plan-0 (cars per km², coupling 0 → 1):
arterials core 224→202, suburban 180→99, rural 77→31; minor 55→52 /
27→16 / 17→8; highway identical. Core:rural arterial contrast 2.9:1 → 6.5:1.

## Why a separate field from the #49 density bands

The band field ([[decision-density-gradient-model]]) is a *pre-district
planning* input — it gates roads before buildings exist. The population
field is the *post-hoc census* of what actually got built (dropout, shrink,
archetype mix all included), so the heat map and traffic read the city as
realised, and the two stay decoupled: tuning band thresholds never silently
re-tunes traffic ratios.

The estimate also surfaces in the panel (`est. population`) — ~277 k for a
4 km City tier, plausible for the look.
