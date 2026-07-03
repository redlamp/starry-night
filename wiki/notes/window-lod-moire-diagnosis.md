---
tags:
  - domain/stack
  - status/verified
---

# Window LOD Moiré Diagnosis (2026-07-02)

**Symptom** — "distressed" salt-and-pepper stipple inside lit windows, worst on
band/curtain floors ("all blue lights for the floor... should be solid consistent
colors"). Static while the camera is still, slides with camera motion. Seen on
NVIDIA (RTX 3080 Ti, ANGLE D3D11); a friend's AMD browser looked clean.

**Mechanism** — two stacked causes, both sampling-theory, neither z-fighting
(gate1's zero-overlap assert + near/far math ruled that out):

1. Binary per-cell atlas state (lit/unlit/brightness per window) aliases when
   windows span ~2.5-8 px. The shader's own distance wash
   (`cityInstanced` LOD block) was DESIGNED for this at `uLodNear ≈ 0.12`
   cells/px, but the store default drifted 0.12 → 0.2 (cd899a0) → **0.4**
   (8e79a2f, 2026-07-01 "window LOD tuning") — leaving the moiré band with no
   mitigation. The regression shipped one day before the complaint.
2. Band floors carry a deliberate ±18% per-pane brightness jitter ("glass
   panels over one interior"). Great at close range; pure noise once panes drop
   under ~4 px — this is the "distressed solid floor" component.

The NVIDIA/AMD difference is (mostly) a red herring: severity varies with
resolution/DPR and vendor rasterization, but the artifact is
renderer-agnostic undersampling — it reproduced in headless capture on the
same NVIDIA stack.

**Probes** (deterministic seed `moire-hunt-1`, default pose, 1920x1080;
`scripts/cdpShot.ts` + `scripts/moireMetric.ts`, metric = median-deviation
speckle per 1000 lit px):

| Probe                               | Overall   | Top / Mid / Bottom | Verdict                                    |
| ----------------------------------- | --------- | ------------------ | ------------------------------------------ |
| Baseline (lodNear 0.4)              | 429.9     | 454 / 480 / 390    | artifact                                   |
| P1: lodNear 0.12                    | 265.7     | 231 / 209 / 312    | fixes far/mid but washes skyline flat      |
| P2: curtainW 1.0                    | 427.7     | 453 / 479 / 387    | null — mullions not the driver             |
| P3: edge AA 2.2                     | 375.8     | 402 / 457 / 315    | minor — edge AA can't fix cell-state noise |
| **Fix** (lodNear 0.2 + jitter fade) | **369.0** | 390 / 358 / 378    | texture kept, crunch gone                  |

**Fix** (`ee9e79f`):

- `cityInstanced`: fade the band-pane brightness jitter toward its mean over
  `relSpan` 0.15→0.35 cells/px (fixed constants, independent of LOD sliders so
  detail knobs can't reintroduce the noise). `relSpan` hoisted next to
  `cellLocal` for reuse.
- `sceneStore`: `lodNear` default restored 0.4 → 0.2 (wash starts at ~5 px
  windows; 0.12 verified too aggressive at skyline range).

**Rerun the loop**: `bun scripts/cdpShot.ts "<url>?capture=1&intro=instant&seed=moire-hunt-1" out.png`
then `bun scripts/moireMetric.ts out.png`.

**Round 2 (same day)** — user still saw artifacts at a **telephoto** pose
(2.77 km, fov 24.6): windows there span 1–3 px, which is inherent binary
cell-state aliasing the wash only partially covers. Reproduced exactly via
saved-config injection (`SHOT_SETUP_FILE`). Ruled out with data: placement
overlaps (scanCoplanar: 0 pairs at mm tolerance), z-fighting (13× depth-
precision change via dynamic-near prototype → pattern unchanged), DPR
resampling alone (persists at native DPR 2). Remaining work tracked in
[#82](https://github.com/redlamp/starry-night/issues/82) — preferred fix is
analytic cell supersampling in the transition band; the dynamic-near patch is
preserved there for the separate grazing-facade precision ceiling.

**Round 3 (same day, from screen recordings)** — two videos analysed by frame
extraction + native-res crops (ffmpeg → per-region zooms). New signatures:
vertical stripe combs inside band/curtain floors and window groups on
near-upright facades; diagonal per-pixel churn inside large windows on
hard-grazing faces; ragged fringes at band top/bottom edges (partly H.264
ringing stacked on the real comb). All one mechanism: **anisotropic footprint
aliasing**. `relSpan = min(fwidth(cell.x), fwidth(cell.y))` gates the LOD wash,
by design ("max would wash whole panels at grazing" — the comment documents the
trade-off). At grazing incidence the resolved axis wins the `min`, so the wash
never engages at ANY `uLodNear`, and the sub-pixel axis renders raw per-cell
state noise — organized into vertical streaks (Y resolved) or diagonal flow
(rotated grid). Explains perspective-only, pose/machine dependence
(pixel-grid phase, DPR, vendor derivative rounding), and why lodNear tuning
never fully fixed it. Fix spec updated on #82: **per-axis** treatment —
analytically average the mask along the sub-resolved axis
(`mix(wMaskX, fracW, lodX)`; the cell-mean of the mask is just the fraction)
and footprint-average the binary state along the compressed axis; keep
distantGlow for the both-axes case. Chrome config ruled out via chrome://gpu
report (hardware WebGL, ANGLE D3D11, no relevant workarounds).

**Fix (round 3, `feat/window-supersample`)** — `36a3b70`, with a permanent
harness first (`scripts/moireGym.ts`, `60fbc5e`: four named poses driven
post-boot through `__sceneStore` — capture boot resets the camera, so
savedConfig injection can't work — captured via cdpShot, scored by
moireMetric; `GYM_INTENT` env for ad-hoc pose probes):

1. Per-cell window state extracted into `windowCellState()` (single source:
   atlas classification, TV/band brightness, wake + duty cycle, fractional-band
   gating); the lit path averages 4 taps along the dominant screen axis once it
   goes sub-resolved (fixed ramp 0.3→0.9 cells/px). Resolved axis keeps detail.
2. **Feature-size mask mean** — the real barcode driver: the mask's thinnest
   feature (lit run or mullion gap) in px, not the cell size. A 1% curtain
   mullion is sub-pixel even on a 40px cell. Under ~2px the mask converges to
   its analytic cell-mean (`mix(wMaskX, fracW, …)`).

Gym scores (before → after, lodNear 0.4): telephoto 366 → **122**,
street-graze 177 → **83**, band-close 423 → **107**, near-guard bottom third
49 → 40 with pixel-crisp before/after crops (no detail washed). gate1
determinism PASS. Live look + fps judgement pending (the telephoto range now
reads as calm banded facades instead of shimmering pseudo-detail; the fixed
ramp constants are the tuning knob).

**Round 4 (2026-07-03, `feat/window-hybrid`)** — the [[window-lab]] Atlas+SDF
finding ported to production as a **hybrid render mode** (classic|hybrid
toggle, Settings → Buildings → Windows; classic byte-preserved for A/B):

1. **Box-filtered coverage mask** (`paneCoverage()`): the exact integral of the
   pane/mullion square wave over the pixel footprint, in closed form
   (`F(x) = floor(x)·paneW + clamp(fract(x) − lo, 0, paneW)`). Replaces the
   smoothstep pair + feature guard whose 0.5–1.1 px mullion band half-rendered
   and beat against the pixel grid — THE zoomed-in "distressed" stipple
   (mullions on 3–7 px cells, i.e. most mid-range facades at telephoto). Sharp
   when magnified, dither-free minified, converges to `fracW` naturally — no
   phantom-mullion fade, no guard.
2. **Far-field mean-lit**: per-building on-weighted mean colour + on-fraction
   (`aMeanLit`, computed from the atlas at build time — the 16th and LAST
   vertex attribute; no headroom left) replaces per-cell confetti past the LOD
   gate; deep-graze tap statistics converge to the same mean. Ortho/Skyline
   bypasses all of it (`(1 − uOrthoBlend)` gate).
3. **Metric bias lesson**: moireMetric scored the fix WORSE (76 → 95) because
   median-deviation counts sharp correct mullions as speckle. Adjudicated with
   **supersampled ground truth** (3200×2000 capture, lanczos downsample, MSE
   vs reference — headless DSF 2 black-screens WebGL, use a big window at
   DSF 1): hybrid won every pose, −23 % to −39 % error. Speckle metrics reward
   blur; keep them for triage, never for verdicts.

**Round 5 (2026-07-03, same branch)** — with round 4 in, a "major dithering"
report at a NEW far pose exposed a third, unrelated family:
**varying-interpolation ulp noise**, three organs, one disease (full write-up:
[[decision-shader-varying-precision]]):

1. `hash11(vBuildingHash · k + c)` in the fragment shader — rasterizers
   reconstruct even a constant varying with per-pixel ulp wobble (~2e-4 at
   magnitude 1e3), and the hash amplifies input error ~×480 → window-size
   rolls flipped between discrete values pixel-by-pixel. Every gradient
   speckled; flats stayed clean (saturation hides it). Affected BOTH modes,
   always had — far + telephoto just makes the wobble visible.
2. The same ulps through **binary on/off thresholds** (duty-cycle seeds) —
   knife-edge cells flip at full contrast.
3. `mod(cellId, vGrid)` sits ON a discontinuity when a face-shifted column
   index is an exact multiple of cols (guaranteed for cols ≤ 21 on faces 1–3):
   ±ulp in vGrid flips the atlas sample between column 0 and cols−1 —
   whole panes filled with two-tone static.

Fixes: per-building rolls hashed in the **vertex stage** from the exact
attribute (also moves ~2M/frame fragment hash evals to ~150k vertex ones);
timing seeds quantised to an integer lattice vertex-side and snapped
fragment-side; `vGrid`/`vFaceId` snapped before discontinuous consumption.
30,716 → 634 strong deviants at the reported pose; pane layout pixel-identical
(no re-roll); shipped `v2026.07.03`, user-confirmed live.

**Probe kit that cracked round 5** (all scratchpad, CDP + paused clock):
coordinate-integrity stripes (`fract(cell·8)` — proved the UV clean), derived-
value stripes (`fract(halfW·64)` — showed the roll flipping), 3×3-median
deviant counter with (x%2, y%2) parity tally (rules derivative quads in/out),
instance-identity fingerprint (two interleaved populations = depth fight — but
see the pitfall: `fract(attr·53)` near a byte-rounding edge dithers ONE
surface into two populations; confirm geometrically before believing it).
A fresh-context research agent quantitatively rejected rasterizer-precision
theories and contributed the depth-LSB math (`d²·LSB/near` ≈ 0.076 m at
d = 800, near = 0.5): an angle-tolerant scan found only 2 near-coincident wall
pairs city-wide (both far south, gaps 0.03/0.14 m) — parked as a possible
`city-gen` backlog item, not the reported artifact.
