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
7. **Curtain wall is a share, not a mode — and a FLOOR treatment, not a building skin** (`uCurtainShare` default 0.3, `uCurtainWidth` default 0.99): on a seeded share of already-correlated office towers, the correlated **band floors** render as curtain glass; the tower's other floors keep punched windows, so a curtain tower reads as a normal facade carrying occasional glass ribbons. Lives entirely in the shader — eligibility rides on the existing floor-banded atlases, so both sliders are live with no atlas rebuild. *Iterated same day:* (a) all-building glass at width 1.0 read as a neon tube → width knob with the seam fade narrowed to the last ~1% (0.991 → 0.999), so 0.99 keeps hairline mullions and "whole floor = one window" applies **only at exactly 1.0**; (b) rng rolls never land on a range endpoint, so occasional true curtains are manufactured: **1 in 5 curtain towers rolls full** and **any rolled fraction ≥ 0.98 snaps to 1.0** — the snap runs BEFORE the curtain override so the crt-width knob (0.99) keeps hairline panes; the spire width ceiling defaults to 0.99, making ~4% of spires organic seamless towers; (c) corners: **corner piers** (outermost column per face capped at 0.78) terminate each face's ribbon at visible structure, and curtain floors take the **per-face wake clock** (like fractional bands), so a wrapped lit floor lights face-by-face rather than snapping on as a ring; (d) visibility: scoping curtain to band floors made it compound away — band-share × lit-ratio × ⅔ duty × segment cuts × sub-pixel mullions ≈ invisible even at share 1.0 (verified by capture). Curtain floors therefore **skip the fractional segment cut** (a ribbon spans its face; unevenness survives via the clocks), **hold light 4× longer** (trading floors, not apartment lamps), and take **+15% pane brightness**. Lesson: a treatment gated behind a chain of probabilistic filters needs its own visibility budget — check the joint probability, not the per-stage knobs. Band cells additionally get static ±18% per-pane luminance jitter so ribbons read as panes over one interior.
8. **TV flicker is forced steady on band rows** — a whole floor strobing in sync reads as a glitch, not a television. Per-block keeps TV (one living room spilling across its windows).

## Consequences

- Office + warehouse atlas patterns re-rolled under the same seed (their rng paths changed). Per-window buildings are byte-identical; city layout / gate1 golden untouched (gen inputs unchanged).
- `vCorrelationMode` is no longer a dead varying.
- Glass-fraction sliders now reach 1.0 (was 0.95) in both window modes.

## Why it's reversible-but-notable

Rendering-only (no data migration, no gen change), but it defines the visual language for how the city is *inhabited* — and the alpha-tag contract (200 = band) plus the "shares not modes" curtain-wall pattern constrain how future lighting features (per-floor occupancy schedules, timezone dimming) should be built.
