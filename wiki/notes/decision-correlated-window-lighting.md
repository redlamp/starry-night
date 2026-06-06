---
tags:
  - domain/3d
  - domain/visual-language
  - status/adopted
---

# Decision: Correlated Window Lighting (Floors, Segments, Curtain Walls)

**Date**: 2026-06-06
**Status**: adopted — iterated live against Manhattan skyline references, user-verified between rounds.

Extends [[decision-window-proportion-by-archetype]] from window *geometry* to window *behaviour*: which windows light together, and how a lit floor reads.

## Problem

Every window cell rolled lit/unlit independently, so office towers read as uniform speckle. Real skylines (the Manhattan reference photos) show whole floors lit as continuous bands — trading floors, cleaning crews — plus partial-floor segments, and curtain-wall towers whose lit floors read as mullion-free glass ribbons next to punched-window neighbours. A per-building correlation mode (per-window / per-block / whole-floor) existed but was dead: shipped to the GPU as `aMisc.y`, never consumed; the atlas painted every cell independently.

## Decisions

1. **Mode taxonomy, building-level, seeded** (`correlationModeFor` in `lightingGen.ts`): 0 per-window, 1 per-block (runs of 2–6 windows = suites), 2 fractional-floor, 3 whole-floor. Offices (office-block/spire) split 35/25/30/10; warehouses 60/0/40/0 (aisle light banks); everything else per-window. Whole-floor is deliberately **sparing** (10%) — common full slabs read as a gimmick.
2. **Within a correlated building, only some floors band** (~40% whole-floor, ~60% fractional); the rest stay per-window, so towers read mixed-use rather than zebra-striped.
3. **Atlas paints state, shader owns timing.** Band rows roll lit + colour ONCE per row in the atlas. Cell kind is encoded in atlas alpha: 0 unlit, 128 TV, **200 correlated band**, 255 steady. The alpha tag is the CPU↔GPU contract — chosen over duplicating the float hash on both sides, because GLSL highp (f32) and JS (f64) drift on chaotic hash math and would disagree on band membership.
4. **Fractional floors are uneven per face.** Band rows paint edge-to-edge as a colour base; the shader cuts each face to an independently-seeded segment (length skewed toward partial fills, including none). Faces also wake on separate clocks. This is what makes corners look inhabited rather than wallpapered.
5. **Whole-floor bands wrap corners.** Correlated buildings skip the per-face atlas row shift (#25) so a floor samples the same row on all four faces; whole-floor timing zeroes the column term so the band wakes/cycles as one unit.
6. **Switch-bank stagger** (`uStagger`, Windows panel, default 0.5): that share of correlated floors light in 2–4 column banks 0.6–1.6 s apart, sweeping left or right — multiple switches down the hall. Implemented as a wakeTime shift, so the sweep replays on every breathing re-on.
7. **Curtain wall is a share, not a mode** (`uCurtainShare`, default 0.3): among already-correlated office towers, a seeded share pins width to full-bleed + high glass height (slim spandrels). Lives entirely in the shader — eligibility rides on the existing floor-banded atlases, so the slider is live with no atlas rebuild. Fraction 1.0 is made seamless by a phantom-mullion fade: the window-edge smoothstep pair dips to 0.5 exactly on the cell boundary, so the mask fades to 1 above fraction ~0.95.
8. **TV flicker is forced steady on band rows** — a whole floor strobing in sync reads as a glitch, not a television. Per-block keeps TV (one living room spilling across its windows).

## Consequences

- Office + warehouse atlas patterns re-rolled under the same seed (their rng paths changed). Per-window buildings are byte-identical; city layout / gate1 golden untouched (gen inputs unchanged).
- `vCorrelationMode` is no longer a dead varying.
- Glass-fraction sliders now reach 1.0 (was 0.95) in both window modes.

## Why it's reversible-but-notable

Rendering-only (no data migration, no gen change), but it defines the visual language for how the city is *inhabited* — and the alpha-tag contract (200 = band) plus the "shares not modes" curtain-wall pattern constrain how future lighting features (per-floor occupancy schedules, timezone dimming) should be built.
