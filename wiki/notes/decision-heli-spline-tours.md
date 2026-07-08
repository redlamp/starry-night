---
tags:
  - domain/procgen
  - status/adopted
---

# Decision: Helicopter Tours as Closed Catmull-Rom Splines (#89 v3)

2026-07-08, `feat/heli-splines` (worktree, off `fable`). Closes the remaining ask on issue #89: "more realistic flight paths, splines over lines."

## Context

#89 v2 (2026-07-05) gave each stop-to-stop hop a seeded quadratic-bezier bow sampled at 4 chords, plus pad orbits and hover holds. Two residual tells kept it reading as line segments: the 4-chord sampling is visibly polygonal up close, and every hop met its stop at a hard C0 corner (bezier endpoints have no continuity across hops).

## Decision

- **One closed centripetal Catmull-Rom spline per tour** (`THREE.CatmullRomCurve3(controls, true, "centripetal", 0.5)`): control points are the stops plus the v2-style seeded bow midpoints (`ARC_STRAIGHT_PROB` hops contribute none). CR interpolates its controls, so the path still passes exactly through every pad, and curvature is continuous through the stops — a "straight" hop now eases in and out of its neighbours instead of cornering.
- **Sampling 4 → 10 sub-legs per hop** (`SPLINE_SAMPLES_PER_HOP`). Legs stay plain transit legs; the leg schema, shader (`lib/shaders/helicopters.ts`), and dir carry-forward are untouched. Leg counts grew ~2× (27–61 per helicopter); buffers size dynamically from `legs.length`.
- **Per-hop climb profile**: mid-hop altitude bump `4·f·(1−f)·climb`, climb seeded 12–35 m + 4.5% of hop ground length (capped 60 m), replacing the linear roof-to-roof ramp. Endpoints snap to exact stop coordinates so hover legs' `aA === aB` equality holds.
- Orbits and hovers unchanged (C0 at an orbit join is a deliberate manoeuvre, not an artifact).

## Verification

`scripts/heliSplineCheck.ts`: deterministic per seed, legs chain continuously around the closed loop (≤1e-6 m gap), windows tile 0..1 exactly, hover dirs stay unit-length. Typecheck/lint clean; city golden byte-identical (helicopters derive downstream of `generateCity`). Route-overlay capture: `samples/heli-splines.png` — smooth banking sweeps with climb bumps and tight pad orbits.

## Open

- Live motion feel (banking speed vs curve tightness) is a user-gate on merge review.
- If leg growth ever matters at bigger pools, drop `SPLINE_SAMPLES_PER_HOP` adaptively by hop length.
