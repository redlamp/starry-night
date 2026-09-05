---
tags:
  - domain/3d
  - domain/perf
  - status/adopted
---

# Decision: Shader Precision Policy (2026-09-05)

**Context.** `c6f9335` fixed a shipped bug: the moon disc rendered invisible on a
Pixel 6. `moon.ts`'s fragment shader hardcodes `precision mediump float;` (fp16
on mobile GPUs, max finite 65504; desktop ANGLE/GL promote it to fp32, which is
why the bug never showed on desktop). Its ordered-dither helper squared
`gl_FragCoord.xy` — on a tall phone screen (`gl_FragCoord.y` counts from the
viewport BOTTOM) that reached ~2000, and 2000² overflows fp16 → `+Inf` →
`fract()` → `NaN` → `step()` → 0 → an all-black disc. The fix reduces the
coordinate mod 4 before squaring (the dither pattern has period 4), closing the
overflow without changing output.

Today's audit re-scanned every custom fragment/vertex shader in
`lib/shaders/*.ts` for the same class of bug — an intermediate that can exceed
fp16's ±65504 range (products/sums of large constants, world-space distances,
squared screen coordinates) or underflow below ~6e-5 (division by a near-zero
term) — now that `mediump` is hardcoded in five files.

**Hazard scan results.**

| Shader | Precision (before) | Hazard found | Worst case | Action |
|---|---|---|---|---|
| `moon.ts` (fragment) | mediump | none remaining — `bayer4`'s mod-4 reduction (c6f9335) already caps every squared term under 16 | `uColor * uBrightness * lit` ≤ ~1.4 | switched to **highp** (defense-in-depth; see below) |
| `moonHalo.ts` (fragment) | mediump | none — all math is bounded UV-space (`vUv - 0.5`, length ≤ 0.71) distances/dots; the one division (`dir / d`) is already guarded `d > 0.001` | bounded ≤ ~1 | switched to **highp** |
| `shootingStar.ts` (fragment) | mediump | none — only `gl_PointCoord`-bounded math (`r = length(uv)`, `r ≤ 0.5`); all `uTime`/hash math is in the vertex stage (highp by default, per c6f9335's audit) | bounded ≤ ~1.45 | switched to **highp** |
| `groundHaze.ts` (fragment) | mediump | none — `vWorldPos.y` is a linear (unsquared) world-space metre value, bounded by the haze sphere radius (`(CITY_TIERS[tier] + 200) * haze.radius / DEFAULT_HAZE.radius`; ≤ ~4200m at max tier and a generous slider, before the `haze.radius` scale) | ≤ ~4200 (need >65504 to overflow — 15x the practical max) | kept **mediump** |
| `starField.ts` (fragment) | mediump | none — only reads bounded varyings (`vBrightness` ≤ ~2.5, `gl_PointCoord` in [0,1]); all `uTime`/hash/noise math is in the vertex stage (highp by default) | bounded ≤ ~2.5 | kept **mediump** |
| `cityInstanced.ts` | no qualifier (renderer default: highp where available) | not touched — out of scope, no qualifier is exactly the policy below | n/a | no change |

**Decision: no functional hazard existed beyond the already-fixed `moon.ts`
overflow.** The scan is quantitative, not a rubber stamp — every hazard
category from the c6f9335 postmortem (squared coordinates, large uniforms,
hash constants, small divisors) was checked file-by-file (see the daily-note
trail / commit diff for the arithmetic).

**Policy going forward.**

1. **Default to no explicit `precision` qualifier.** Let three.js inject the
   renderer's default (`highp` where available, matching `cityInstanced.ts`
   today). Only add an explicit qualifier with a documented reason.
2. **`mediump` requires a hazard scan, not just "it compiles."** Before
   hardcoding `precision mediump float;`, check every fragment-stage
   intermediate against fp16's range (±65504 finite, ~6e-5 minimum normal):
   products/sums of large constants, world-space distances (especially
   squared), screen coordinates (`gl_FragCoord`, especially squared/hashed),
   and hash constants (`* 43758.5453`-style). Re-run the scan whenever new
   math is added to a `mediump` shader.
3. **`mediump` is worth it only where it covers real screen area.** A
   whole-sky shader that runs on every pixel below/above the horizon
   (`groundHaze`, `starField`) gets a real mobile perf win from `mediump`, so
   keep it there once the scan is clean. A shader with tiny screen coverage
   (`moon`, `moonHalo`, `shootingStar` — a disc, a billboard, a streak) gets an
   unmeasurable perf win from `mediump`, so prefer `highp` even with a clean
   scan — it removes the residual risk that a future edit reintroduces an
   unreduced large term, at zero cost (desktop already runs `highp` by
   promotion).
4. **`uTime` stays out of fragment-stage math where possible.** Every shader
   audited here does its `uTime`/hash/noise work in the vertex stage (highp by
   default) and passes only small, bounded results down as varyings — this is
   why none of the five needed a CPU-side `uTime` wrap or a `fract()`-before-
   multiply rewrite. If a future shader needs `uTime` directly in the fragment
   stage under `mediump`, wrap it on the CPU at a documented period (or
   `fract()` before any multiply) rather than trusting it to stay small
   forever.
5. **Verification is desktop-blind.** `highp` is the desktop default via
   ANGLE/GL promotion, so a `mediump` → `highp` swap is byte-identical on
   desktop by construction and cannot be verified there. Any shader whose
   precision qualifier changes needs a phone check before the next release
   note calls it done.

**This session's changes** (2026-09-05): `moon.ts`, `moonHalo.ts`,
`shootingStar.ts` → `precision highp float;` (defense-in-depth, no visual
change on any platform by construction — the math was already in range).
`groundHaze.ts`, `starField.ts` → comment only, `mediump` kept. `cityInstanced.ts`
untouched. **Needs a phone check**: `moon.ts`, `moonHalo.ts`,
`shootingStar.ts` (confirm the moon disc, halo, and shooting-star streak still
render — highp costs a little more on mobile GPU bandwidth per pixel, though
none of these draw enough pixels for that to be visible).

Related: [[decision-shader-varying-precision]] (2026-07-03) covers a different
mechanism — perspective-interpolated *varying* wobble amplified by hashing —
orthogonal to this note's fp16 *range* concern, but both land in the same
`cityInstanced`/`lib/shaders` neighbourhood.
