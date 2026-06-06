---
tags:
  - domain/city-gen
  - status/adopted
---

# Road Reveal Choreography — Phases and Language

The shared vocabulary for the city-load animation, so feedback like "the tips
streak too long" maps to one knob. Decision history in
[[decision-road-reveal-cascade]]; spec in
`docs/specs/2026-06-05-road-reveal-cascade.md`. **Interactive companion:**
`docs/prototypes/road-reveal-choreography.html` — open directly in a browser;
animates every phase on a synthetic network with live sliders for all the
knobs below, the phase bar, and glossary highlighting.

Everything below is driven by **one clock**: *master progress* (0→1), the
`sharedRoadRevealProgress` singleton, advanced by `RoadRevealTicker` over the
**duration slider**'s seconds (Roads panel, tier-scaled ×0.7 town / ×1
city / ×1.4 metro). `0` on the slider, or `prefers-reduced-motion`, skips the
whole performance.

## Phases (cold cache — a city being generated)

| # | Phase | Master progress | What you see | Code home |
|---|-------|-----------------|--------------|-----------|
| 0 | **Blueprint trace** | held at 0 (worker still generating) | Dim slate/blue lines *draw on* as the tracer accepts each streamline — the city sketching its own plan | `GenTrace.tsx`, `lib/shaders/genTrace.ts` |
| 1 | **Scout glint** | 0 → 0.15 (`SCOUT_PHASE`) | A bright point races the highway path on the dark ground — announces the spine before anything is built. Rings run two glints opposite ways. Other tiers hidden | `roadReveal.ts` fragment, scout branch; span computed in `Roads.tsx` |
| 2 | **Cascade** | 0.15 → 1 (remapped to *t* = 0→1) | Highways grow from their centre-nearest point; arterials *sprout* from highway junctions; streets *snap in* behind. The blueprint trace fades beneath it (`uFade = 1 − master`) | `lib/scene/roadReveal.ts` schedule + `roadReveal.ts` cascade branch |
| 3 | **Intro gate** | master ≥ 0.35 (`REVEAL_GATE`) | Building wake-up (windows) starts — *roads lead, buildings follow*. Streetlights + traffic ride the intro timeline, so they inherit the gate | `IntroTicker.tsx` |
| 4 | **Settled** | 1 | Flat tier colours, tips retired, trace disposed. The screensaver proper | — |

Warm cache (seed flip, tier switch): phase 0 never happens — scout glint starts
immediately, everything else identical.

## Glossary

| Term | Meaning | Knob / where |
|------|---------|--------------|
| **Master progress** | The one 0→1 clock all phases read | `sharedRoadRevealProgress` (sharedIntro.ts); duration slider |
| **Scout glint** | The pre-build point of light racing the highway path | `SCOUT_PHASE` (Roads.tsx); band = 2×`uTipWidth`; trail colour `uColor*0.2` in the shader |
| **Scout span** | How much of the highway's reveal range the glint sweeps (computed per city) | `hwScoutSpan` in Roads.tsx's useMemo |
| **Cascade** | The centre-out network draw — the main act | `buildRevealSchedule` |
| **Wavefront** | The growing edge of any drawing line | `aReveal` vs remapped *t* in the fragment shader |
| **Construction tip** (just "tip") | White highlight hugging the wavefront | length `uTipWidth` (0.015), intensity `0.85` mix, both in Roads.tsx / shader |
| **Tip retirement** | Tips fade out by ~92% of the cascade window so late lines draw quietly | `smoothstep(0.80, 0.92, t)` in the fragment shader |
| **Stagger window** | Wall-clock spread between the first and last line *starting* | `RADIAL_SPEED` (roadReveal.ts) — higher = tighter |
| **Zip** | How fast one line draws once started | `SPEED` per tier (roadReveal.ts) — only the ratio vs `RADIAL_SPEED` matters after normalization |
| **Attach / junction** | The point a child line sprouts from on its parent (street→arterial, arterial→highway) | `ATTACH_EPS` 60 m; `LAG` 0.15 s beat before sprouting |
| **Radial orphan** | A line with no parent in range — joins a radial wavefront from the centre instead of popping | fallback branch in `buildRevealSchedule` |
| **Straggler tail** | The late, sparse end of the schedule (far orphans). Untamed it reads as ground-level shooting stars | `TAIL_EASE` 0.7 (t^k remap; lower = tighter bunching) |
| **Blueprint trace** | The dim mid-generation overlay (#59) — a sketch, not the show | palettes + `DRAW_DUR` 0.4 s in GenTrace.tsx |
| **Draw-on** | A trace line stroking in over time rather than popping | `aBirth`/`aFrac` attributes + `uDrawDur` |
| **Trace fade** | Blueprint dimming to nothing beneath the cascade | `uFade = 1 − master` in GenTrace's useFrame |
| **Intro gate** | The hold on the building wake-up until the wave leads | `REVEAL_GATE` 0.35 (IntroTicker.tsx) |

## Tuning quick-reference

- "Whole thing too slow/fast" → duration slider (Roads panel)
- "Glint phase too long/short" → `SCOUT_PHASE`
- "Lines start too spread out" → `RADIAL_SPEED` ↑
- "Lines draw too slowly once started" → `SPEED` ↑ (keep ratio vs `RADIAL_SPEED` in mind — renormalization couples them)
- "White streaks at the end" → `TAIL_EASE` ↓ and/or earlier tip retirement
- "Tips too long/bright" → `uTipWidth` / the `0.85` mix
- "Buildings come too early/late" → `REVEAL_GATE`
