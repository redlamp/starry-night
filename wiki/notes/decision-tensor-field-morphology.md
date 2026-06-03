---
tags:
  - domain/city-gen
  - status/adopted
  - scope/m3-plus
---

# Decision: Tensor Field Morphology Menu (#51)

**Date:** 2026-06-03 · shipped to `main` (`7ebadc9`).

## Context

The tensor field had one vocabulary: an N×N grid of grid-basis fields (all reading
the near-uniform lattice orientation) ± a single radial basis on ~35% of seeds.
Rendering the field across 12 seeds (browser-free, `scripts/renderFields.ts`) made
the user's complaint concrete — most cities = near-uniform parallel lines ("dull
linear"); the radial fired as a stark, map-wide **bullseye**, too weird + too common.

## Options

1. Tune amplitudes of the existing grid+radial — adds no new *kinds* of variety.
2. Add new basis math (heightfield/contour) — no terrain to drive it.
3. **A morphology menu** — each seed draws ONE field family, all realised as the
   same grid-basis layout with a per-position orientation. ← chosen.

## Decision

Per-seed weighted morphology, all expressed through the existing grid-basis sum (so
the RK4 streamline tracer, determinism, and gate1 are unchanged — only how each
basis's θ is computed differs):

- **warp 34%** — θ rides a low-frequency sine across the field → organic S-curving
  streets, no rings.
- **shear 30%** — two grids at a 28–54° offset meeting at a smooth seam (smoothstep
  over a boundary band).
- **grid 22%** — calm, but a mandatory gentle warp so it's never dead-straight.
- **radial 14%** (was 35%) — compact off-centre roundabout, tighter decay → one plaza
  district, not a city-wide bullseye.

Plus a per-seed `deviation` (0.7–1.6) for spread *within* a family — the hook for a
future runtime "deviation range" slider.

## Why

Variety comes from large-scale *structure* per seed (warp/shear), not from jittering a
uniform grid. Keeping every family as a grid-basis layout means zero change to the
streamline tracer, the golden contract, or gate1. Radial demoted + tamed kills the
"every city has a bullseye" read.

## Consequences

- One-time seed shift (accepted — see [[decision-additive-growth-citygen]]); golden
  reblessed. Still gen-deterministic; gate1 PASS, cross-crop PASS.
- Future: expose `deviation` as a runtime slider; the zen-garden "draw on the field"
  idea (#40) layers on top.

Refs: `lib/seed/tensorField.ts`, `scripts/renderFields.ts`, #51. Builds on
[[decision-tensor-field-roads]].
