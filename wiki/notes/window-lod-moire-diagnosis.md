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

| Probe | Overall | Top / Mid / Bottom | Verdict |
| --- | --- | --- | --- |
| Baseline (lodNear 0.4) | 429.9 | 454 / 480 / 390 | artifact |
| P1: lodNear 0.12 | 265.7 | 231 / 209 / 312 | fixes far/mid but washes skyline flat |
| P2: curtainW 1.0 | 427.7 | 453 / 479 / 387 | null — mullions not the driver |
| P3: edge AA 2.2 | 375.8 | 402 / 457 / 315 | minor — edge AA can't fix cell-state noise |
| **Fix** (lodNear 0.2 + jitter fade) | **369.0** | 390 / 358 / 378 | texture kept, crunch gone |

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
