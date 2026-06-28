---
tags:
  - domain/3d
  - domain/perf
  - status/open
  - origin/external-research
---

# Camera Architecture & Performance — External Research

**Date:** 2026-06-27 (9-agent audit: 5 code-map + 4 research). Companion to
[[camera-interaction-models]] (gesture *models*); this note is the *architecture
+ performance + library-internals* lens that feeds [[plan-camera-refactor-optimization]].

All four library facts below were verified against the **installed** versions
(drei 10.7.7, camera-controls 3.1.2, @use-gesture/react 10.3.1) — not just docs.

## 1. camera-controls (yomotsu) + drei `<CameraControls>` internals

- **`update(delta)` returns `true` only when a re-render is needed** (it damps
  toward goals, returns `false` once settled). drei calls it at `useFrame`
  priority **−1** and **discards the boolean**. At rest it still runs ~6
  delta/approxZero checks — negligible CPU, but real.
- **Events:** `controlstart`/`control`/`controlend` (drag, *not* wheel),
  `transitionstart`, `update`, and the motion lifecycle `wake`/`rest`/`sleep`.
  Use **`rest`** (fires at `restThreshold`) for "camera settled", not `sleep`
  (lags seconds behind due to damping).
- **Damping is Unity SmoothDamp** in v2/v3: `smoothTime` (0.25) and
  `draggingSmoothTime` (0.125). `dampingFactor`/`draggingDampingFactor` are
  **deprecated no-ops** — don't set them. SmoothDamp is delta-driven, so
  `update(0)` must only ever be an *instantaneous flush*, never the main tick.
- **drei wires `invalidate()`** on controlstart/control/transitionstart/update —
  the only thing that makes it work under `frameloop='demand'`. Known bug
  ([drei #2005](https://github.com/pmndrs/drei/issues/2005)): the first
  programmatic transition after idle skips opening frames under demand. Only
  bites a future capture/demand path; our interactive `always` path is immune.
- **Ortho ≠ perspective in the lib:** wheel defaults to **ZOOM** (`camera.zoom`)
  for ortho and "can't set DOLLY"; `focalOffset.z` is a no-op in ortho;
  `dollyToCursor` has open zoom-out glitches
  ([#239](https://github.com/yomotsu/camera-controls/issues/239)). **This
  validates our faked-ortho-on-a-perspective-camera choice** — one perspective
  camera keeps `distance`, `dollyToCursor`, the pin lever-arm, and
  project/unproject one consistent meaning at *every* blend.
- **`enabled=false`** cuts user input but leaves all methods working — the clean
  mid-gesture kill-switch (we already set every ACTION to NONE, so this is
  secondary).

**Verdict:** keep the custom input layer; keep `frameloop='always'`; keep the
custom ground-anchored + `orthoSize` zoom. Do **not** reintroduce
controlstart/controlend (they never fire for our NONE-action custom gestures).

## 2. R3F + three.js render-loop performance (for a continuously-animated scene)

- **`frameloop='always'` is correct for us.** R3F docs: on-demand is for scenes
  that *come to rest*. Our motion is shader-clocked (`sharedTime += delta`, a
  uniform R3F can't "see"), so `demand` would freeze the city. Reframe idle cost
  as **"reduce per-frame JS + throttle the always-loop"**, not "skip renders".
- **The biggest GPU lever we already own:** `StarPass` is a priority-1 `useFrame`
  that *takes over rendering* and issues **3 `gl.render()` calls/frame**
  (stars + haze + main). Add a **delta-accumulator FPS throttle there** → cap
  ambient frames to ~30 fps, bypass to full-rate while the camera is active.
  Delta-driven motion means **throttling does not change motion speed**, only
  temporal smoothness — must be judged on a real high-refresh panel (per
  [[feedback_interaction-feel-verification]]).
- **`updateProjectionMatrix()` runs every frame** in ProjectionBlender (+ a full
  4×4 invert when blended) and StarPass, even when nothing changed → gate on a
  dirty check of {fov, aspect, blend, orthoSize, radius}.
- **Static-city matrix traversal:** the city never moves (determinism contract),
  yet three.js recomposes world matrices every frame. Set `matrixAutoUpdate=false`
  (or a `matrixWorldAutoUpdate=false` wrapper) on InstancedCity/Roads/Ground/
  Streetlights/Beacons. Cited cases show ~50% CPU / 30→55 fps mobile gains.
  Instance matrices are a separate buffer, so this targets the wrapper hierarchy.
- **Adaptive DPR is the single biggest fill-rate lever and ships default-OFF.**
  `AdaptiveQuality.tsx` already implements the drei `<PerformanceMonitor>`
  hysteresis pattern; the Retina/high-DPR stall (DPR 2 → 15-30 fps) is currently
  unmitigated. Turn it on by default (or auto on high-DPR + low fps).
- **`performance.regress()` on `markCameraActivity`** = idiomatic "drop quality
  while moving, restore at rest". We already emit the trigger.
- **Leave `logarithmicDepthBuffer` OFF** — it disables early-Z (bad for a dense
  skyline) and breaks MSAA. Fix any z-fighting by raising `near` (now 0.5).
- **Debounce the Canvas resizer** (`resize={{debounce:200}}`) — R3F's
  ResizeObserver fires a `setSize`+`updateProjectionMatrix` storm on window drags.

## 3. Orthographic ↔ perspective morphing

- **Element-wise projection-matrix lerp fails** (three.js
  [#5197](https://github.com/mrdoob/three.js/issues/5197), closed unresolved):
  foreshortening is the **ratio in the clip-w row**, not a linear blend, so the
  image reads fully-perspective until blend ≈ 0.99 then snaps. Our code's
  comments already diagnose this correctly.
- **The robust method is the receding-virtual-eye / dolly-zoom** ("ortho ==
  perspective with the eye at infinity"): recede `E = d/(1−blend)` while holding
  the focal-plane half-height `H = d·tan(fov/2)` constant. **This is exactly what
  `ProjectionBlender` (app) and `ProjectionRig` (lab) already do.** No rewrite of
  the morph is warranted.
- **Depth-precision pitfall handled correctly:** instead of literally dollying
  the real camera to `E` (which blows the near/far range → z-fighting),
  ProjectionBlender bakes `dz=E−d` into the matrix and shifts `nearV`/`farV`
  *together*, preserving the range. Keep this.
- **Single perspective camera is the right architecture** specifically because
  camera-controls can't DOLLY an OrthographicCamera (ZOOM only) — a real-ortho
  swap would fork the meaning of distance/zoom and break the live-matrix
  project/unproject the pin + ground-pan depend on.
- **DCC convention** (Maya/Blender): the toggle is an *instant* swap, and persp
  "focal length" vs ortho "width" are **decoupled knobs** — matching our
  "sovereign" `fov` vs `orthoSize` design and the framing-bridge that interpolates
  them. Our animated morph is a deliberate nicety beyond DCC.
- Minor: give the lab's `ProjectionRig` the same exact-ortho snap at the endpoint
  that `ProjectionBlender` has (vs clamping `k` to `K_MIN`).

## 4. 2024-2026 interaction / mobile deltas (updates to [[camera-interaction-models]])

- **STALE caveat corrected:** drei **`DragControls` now auto-disables** the
  default control during a drag (drei 10.7.7, `DragControls.js:41/100` toggles
  `state.controls.enabled` when mounted `makeDefault`). Our note still says it
  doesn't (drei #2408) — that's now true only for **`PivotControls`**.
- **`@use-gesture/react` (10.3.1) is already installed** (it's drei's drag
  engine): `onDrag`/`onPinch` with built-in `filterTaps`, thresholds, velocity,
  angle. **Biggest code-simplification lever** — could replace the hand-rolled
  pointer math + `_rotAccX/_rotAccY` axis-gate + pinch geometry.
- **camera-controls 3.1.2 can express our two-finger model declaratively**
  (`touches.two = TOUCH_DOLLY_ROTATE`/`TOUCH_ZOOM_ROTATE`, `TOUCH_SCREEN_PAN`),
  added `lerp(stateA,stateB,t)` (v3.1.0) and a `stop()` (v2.9.0), and fixed the
  pinch-zoom bug (v3.1.2). Adoption, not upgrade, is the question.
- **Tilt-vs-rotate disambiguation:** the field (Google patents, deck.gl) either
  **hard-locks to one intent** past a velocity/distance threshold (and suppresses
  tilt emerging from a pinch) or **moves vertical tilt to a 3-finger swipe**
  (deck.gl). Either beats our continuous angle-ratio blend. CameraLab A/B candidate.
- **Accessibility maps onto the "continuous motion" nuance:** the **auto-rotate
  sweep** is WCAG 2.2.2 Pause/Stop/Hide (Level A — needs accessible pause, we
  have Space) + should default OFF under `prefers-reduced-motion`; user-driven
  pan/zoom is 2.3.3 (AAA). Twinkle/fog are decorative. **Reduced-motion is a
  cheap, independent win we don't have.** Add arrow/+- /reset **keyboard nav** in
  orbit (WCAG 2.1.1; deck.gl ships `keyboard:true`).
- **Discoverability:** our two non-obvious gestures (RMB/Shift rotate-tilt; the
  cursor-locked pin-scrub) are invisible — a one-time dismissible **coach-mark**
  + persistent "?" is the 2024-26 consensus. Surface the **persp/ortho toggle**
  as a labelled button + keybind and a **dual-purpose compass/reset** affordance
  (Google 3D Maps), not bare keybinds.

## Sources

camera-controls: [class ref](https://yomotsu.github.io/camera-controls/classes/CameraControls.html) · [readme/releases](https://github.com/yomotsu/camera-controls/releases) · [#239 dolly-to-cursor](https://github.com/yomotsu/camera-controls/issues/239) · [rest/sleep example](https://yomotsu.github.io/camera-controls/examples/rest-and-sleep.html).
drei: [CameraControls src](https://github.com/pmndrs/drei/blob/master/src/core/CameraControls.tsx) · [DragControls src](https://github.com/pmndrs/drei/blob/master/src/web/DragControls.tsx) · [#2005 demand transition](https://github.com/pmndrs/drei/issues/2005) · [#2408 Pivot vs controls](https://github.com/pmndrs/drei/issues/2408).
R3F: [scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) · [pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) · [demand discussion #1701](https://github.com/pmndrs/react-three-fiber/discussions/1701) · [fps-cap #1339](https://github.com/pmndrs/react-three-fiber/discussions/1339).
three.js: [#5197 persp↔ortho](https://github.com/mrdoob/three.js/issues/5197) · [matrixWorld perf](https://discourse.threejs.org/t/updatematrixworld-performance/3217) · [#14360 matrixAutoUpdate](https://github.com/mrdoob/three.js/issues/14360) · [log-depth warning](https://discourse.threejs.org/t/beware-of-logarithmic-depth-buffer-it-can-degrade-scene-performance/88495) · [dolly-zoom morph thread](https://discourse.threejs.org/t/9470).
Morph math: [Lomarco dolly-zoom](https://medium.com/@gianluca.lomarco/from-perspective-to-orthographic-camera-in-three-js-with-dolly-zoom-vertigo-effect-96de89c3a07b) · [nickyvanurk gist](https://gist.github.com/nickyvanurk/9ac33a6aff7dd7bd5cd5b8a20d4db0dc) · [LearnOpenGL coords](https://learnopengl.com/Getting-started/Coordinate-Systems).
@use-gesture: [gestures](https://use-gesture.netlify.app/docs/gestures/). deck.gl: [Controller](https://deck.gl/docs/api-reference/core/controller). Mapbox: [gestures](https://docs.mapbox.com/mapbox-gl-js/guides/user-interactions/gestures/). Google tilt patent: [US9354709B2](https://patents.google.com/patent/US9354709B2/en). a11y: [WCAG 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) · [2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html). Discoverability: [NN/g coach marks](https://www.nngroup.com/articles/mobile-instructional-overlay/).
