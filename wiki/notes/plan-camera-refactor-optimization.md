---
tags:
  - domain/3d
  - domain/perf
  - status/open
  - scope/m2
---

# Plan — Camera Refactor & Optimization

**Status 2026-09-05:** partly done. The camera-model registry shipped
2026-06-28 (see the update note below); P0/P1 hygiene + optimization items
are still mostly open.

**Date:** 2026-06-27. Source: a 9-agent audit (5 code-map + 4 research) of the
whole camera subsystem. Companions: [[camera-architecture-and-perf]] (research +
library internals), [[camera-systems-history]] (timeline), [[plan-drei-camera-migration]]
(the migration this continues), [[camera-interaction-models]] (gesture models),
[[camera-lab-to-app-port]] (lab→app log).

This is a **preparation** doc: current-state analysis + a prioritized, effort/
risk-tagged plan. Camera is **runtime state**, so none of this touches the
determinism contract or `gate1` — the risk is in _feel_ and persistence, and feel
changes are gated by the user's live test
([[feedback_interaction-feel-verification]]), never synthetic measurement.

> **Update 2026-06-28:** the first execution step landed as a **pluggable
> camera-model registry** (see [[decision-camera-model-registry]]) — chosen over an
> in-place monolith refactor because it sidesteps the in-flight `DreiSceneControls.tsx`
> and gives a real-scene home to "flesh out 3 Cs models". The existing controller is
> the default "map" model; a new ambient "drift" model is the proof. The audit's P2
> `InputArbiter` can now ship as a model and be proven alongside `map` before
> promotion. P0/P1 perf items below are still open.

## Part 1 — Current state (as actually built)

### 1.1 Three camera systems coexist — the migration is stalled at Phase 2

[[plan-drei-camera-migration]] had 5 phases; only 1–2 shipped. Today:

1. **`DreiSceneControls.tsx`** (1758 lines) — drei `<CameraControls>` bridge, the
   **default for orbit**. Owns every shipped orbit gesture.
2. **`CameraControls.tsx`** (737 lines) — the bespoke legacy controller. Its
   **orbit branch is dead** in production (only under `?controls=legacy`), but its
   **fly + still + tween code is LIVE** (`Scene.tsx` mounts it whenever
   `cameraMode !== 'orbit'`). Frozen since 2026-06-07.
3. **`/intro`** — its own separate drei `<OrbitControls>` turntable.

The migration's _whole point_ was to unify these and delete code. Phases 3 (fly →
custom drag-look), 4 (intro unify), 5 (delete legacy + gsap) were never done. **This
is the headline structural debt.**

### 1.2 Faked-ortho is the architectural keystone — a _decided_ trade-off

Ortho is **not** a real `OrthographicCamera`; it's one `PerspectiveCamera` whose
`projectionMatrix` is overridden each frame (receding-virtual-eye morph,
`ProjectionBlender.tsx`), `projectionBlend` 0→1. This was **deliberately chosen**
([[plan-drei-camera-migration]] "approach A") to keep the smooth morph, and the
research **strongly validates it** (camera-controls can't DOLLY a real ortho cam;
one perspective camera keeps distance/zoom/project/unproject consistent at every
blend). **Do not rip it out.**

Its tax: because `camera.project`/`setFromCamera` take the perspective branch even
at blend 1, every screen↔world helper (`groundHit`, `focalScreenPos`) carries a
hand-built parallel-ray branch gated on `projectionBlend >= 0.9999`, plus an
ortho clip-safety "park radius" subsystem (`orthoMinRadius`). The **scoped fix**
(already noted in [[camera-lab-to-app-port]]) removes the tax without losing the
morph: adopt the lab's **two-point unproject `groundHit`** (unproject NDC at
z=−1 and z=+1, ray = far−near) — correct for persp, ortho, and any blend with
**no special case**.

### 1.3 The `DreiSceneControls` monolith

- **Gesture arbitration is smeared across ~6 independent pointer-listener
  effects** that each re-test `e.buttons`/modifiers/`pinScreenHit` and self-cancel
  when another gesture's signature appears, coordinating through shared refs
  (`panning`/`dragging`/`focalScrubbing`) and duplicated `0b11` button tests. No
  central arbiter → any new binding must thread through every effect's bail logic.
  **Highest-severity fragility.**
- **Module-level mutable globals** (`_groundMaxPolar`, `_lookingUp`, `_corrNow`/
  `_corrFrozen`, `_flDir`, `_rotAccX/Y`, `_screenYNow`) couple the frame loop to
  the event handlers (the two-phase vertical seam works by `useFrame` publishing
  `_groundMaxPolar`/`_lookingUp` and `dragRotate` reading them). Non-reentrant; the
  component is a de-facto singleton.
- **The persp↔ortho focal-plane half-height bridge** `Hb = perspK + (oeff−perspK)·blend`
  is **re-derived in 5+ places** (ProjectionBlender + `applyScreenFocus` +
  `panHalfHeight` + ground clamp + readout, and again in 3 spots as
  `focalScrubScale`/`panHalfHeight`/`wppY`). They _must_ agree or render/pin/pan/
  clamp/HUD silently diverge.

### 1.4 State & render-loop performance

- **`cameraLive` + `moonLive` are derived-from-camera snapshots STORED in Zustand**
  and rewritten ~10×/s with fresh objects — a **two-tier-state violation** and the
  engine of a re-render storm. **`CameraPanel` subscribes to the WHOLE store with
  no selector** (line 325), so whenever it's open and the camera moves, the entire
  ~2980-line panel re-renders 10×/s (worse during GSAP transitions). The correct
  pattern already exists next door: the out-of-store `cameraReadout` singleton.
- **Render loop:** `StarPass` takes over rendering (priority-1 `useFrame`) and
  issues **3 `gl.render()` calls/frame**; `frameloop` is implicit `'always'`;
  `invalidate()` is never called. Correct for an ambient scene, but ~15 `useFrame`
  callbacks + the 3 passes run every frame even at rest.
- **Per-frame waste at idle:** `applyScreenFocus` trig + ground-clamp `acos` +
  `getWorldDirection` every frame; `ProjectionBlender` rebuilds the projection
  matrix (and inverts a 4×4 when blended) every frame; the priority-−1 focal-marker
  loop calls `updateMatrixWorld()` on 2 groups every frame **even while hidden**.
- **Adaptive DPR ships default-OFF** — the only fill-rate safety net for the
  Retina/high-DPR stall is behind `?adaptive`.

### 1.5 Docs lag the code; dead/throwaway code ships

- The `DreiSceneControls` **header comment is wrong** (claims flag-gated +
  inverted LMB-pan/RMB-rotate; reality is default-for-orbit, LMB-rotate/RMB-pan).
- [[camera-lab-to-app-port]] + [[camera-lab-test-plan]] list the near-horizon pan
  limit as "pending" — **already shipped** (`panWithLimit`, "ported 2026-06-21").
- [[camera-systems-history]] documents the lever-arm rotate — **replaced** by
  direct-horizontal azimuth (2026-06-24); the current uncommitted change is the
  **two-phase vertical seam** (2026-06-25).
- Shipping throwaway: `?projection/fov/orthoSize/radius/elev/pinPlane` URL
  overrides + `window.__cam` exposure (both marked "remove once dialed in",
  2026-06-14); `PinPlaneMarker`/`FogBoundsMarkers` allocate GPU resources every
  session; **`/camera-lab` control math has diverged behind production** (hysteresis
  `snapFocalY`, lever-arm azimuth) and may be publicly shipped on GH Pages.
- Hotkey guard inconsistency: orbit's Space/I/Z/U use a local regex that treats a
  focused range-slider as "typing", so those keys go **dead after a slider drag**
  while T/P/D/H still work.

## Part 2 — Settled / validated (don't re-litigate)

- Keep the **receding-eye morph** + **single perspective camera** (research-endorsed).
- Keep **`frameloop='always'`** + the **custom ground-anchored / `orthoSize` zoom**
  (don't adopt camera-controls' native ortho zoom / `dollyToCursor`).
- Don't reintroduce camera-controls `controlstart/controlend` (NONE actions →
  they never fire); keep the ref-based "controlling" flag.

## Part 3 — Prioritized plan

Effort: **S** ≲½ day · **M** ~1–2 days · **L** multi-day. Feel-affecting items
need the user's live test before "done".

### P0 — Hygiene & correctness (S, low risk, do first)

1. **Doc reconciliation** (doc-only): fix the `DreiSceneControls` header; update
   [[camera-interaction-models]] (DragControls _now_ auto-disables; `@use-gesture`
   installed), [[camera-lab-to-app-port]] (pan limit shipped), [[camera-systems-history]]
   (rotate model). Cheap, removes active misinformation.
2. **Fix the hotkey guard** — switch Space/I/Z/U to the shared `isTypingTarget`
   (one-line; fixes the dead-key-after-slider bug).
3. **Remove/guard the throwaway blocks** — delete or `import.meta.env.DEV`-gate the
   URL overrides + `window.__cam` (first grep e2e tooling for `__cam` usage).
4. **Name the projection-blend epsilons** (0.0001/0.5/0.999/0.9999) as shared
   constants — they currently disagree in narrow morph windows.

### P1 — Optimization (mostly S/M, independent of the big refactor — bankable now)

5. **Ambient FPS throttle in `StarPass`** — accumulate delta, cap the 3 render
   passes to ~30 fps when idle, bypass to full-rate while the camera is active
   (`markCameraActivity`/`dragging`). Single biggest GPU/CPU win; delta-driven
   motion means speed is unchanged. **[VERIFY feel on a real high-refresh panel.]**
6. **Dirty-flag the per-frame projection work** — skip `updateProjectionMatrix()`
   - matrix rebuild/invert in `ProjectionBlender` & `StarPass` when {fov, aspect,
     blend, orthoSize, radius, main-cam transform} are unchanged.
7. **Gate `applyScreenFocus` + ground-clamp** on a "settling" flag / dirty check so
   the trig is skipped when the camera is idle (sweep paused, no gesture).
8. **Demote `cameraLive`/`moonLive` to out-of-store singletons** (the `cameraReadout`
   pattern) **and give `CameraPanel` field-scoped selectors.** Fixes the two-tier
   violation + the re-render storm at once; `InstancedCity` gains an un-lagged
   camera position. Highest-leverage perf+correctness win.
9. **Mark the static city subtree `matrixAutoUpdate=false`** (InstancedCity/Roads/
   Ground/Streetlights/Beacons) — verify on a low-end device.
10. **Adaptive DPR on by default** (or auto on high-DPR + sustained low fps); keep
    `[1,dprMax]` as the floor. Optionally wire `performance.regress()` to
    `markCameraActivity`.
11. **One `lib/scene/focalPlane.ts` helper** for the half-height bridge + the three
    scrub/pan/look scale derivations — single source of truth.

### P2 — Structural refactor (L; the big one; enables the rest)

12. **Extract an `InputArbiter` / gesture state machine** — one set of pointer
    listeners → dispatch to gesture handlers; retire the ~6 overlapping effects +
    duplicated bail logic; move module-globals into instance refs. **Strongly
    consider building it on `@use-gesture/react`** (already installed; gives taps/
    thresholds/velocity/pinch for free). Biggest fragility reduction + the enabler
    for safe future binding changes.
13. **Adopt two-point-unproject `groundHit`** → delete the faked-ortho special-case
    ray branches (pairs with #12).
14. **Finish the drei migration** (Phases 3–5): port fly/still to a small custom
    drag-look controller, unify `/intro`, then remove the legacy orbit code +
    duplicated ortho constants + gsap. Removes a whole parallel implementation.

### P3 — UX / accessibility (M; can interleave; #15 shippable standalone)

15. **`prefers-reduced-motion`** — default auto-rotate off, make preset/intro tweens
    instant/≤200ms, optionally damp big motion (WCAG 2.2.2/2.3.3).
16. **Orbit keyboard nav** — arrows = yaw/tilt, +/− = zoom, a reset/north-up key
    (WCAG 2.1.1).
17. **Discoverability** — visible persp/ortho toggle + a dual-purpose compass/reset
    affordance; one-time coach-mark for the non-obvious gestures (rotate-tilt,
    pin-scrub).
18. **Touch tilt-vs-rotate** — CameraLab A/B a hard intent-lock vs moving tilt to a
    3-finger swipe (deck.gl model), replacing the continuous angle-ratio gate.

### P4 — Lab & cleanup (S/M)

19. **Reconcile or retire `/camera-lab` control math** (now behind production);
    harvest the genuinely reusable assets (`GreyBoxCity`, `FpsMeter`, ref-HUD) to
    shared dev tooling; confirm the route isn't exposed on the public GH-Pages build.
20. **Hoist `snapFocalY`** to `lib/scene/` (already two diverged consumers) using the
    production continuous-deadband version.

**Suggested sequence:** P0 → the independent P1 wins (#5, #6, #8 first) → decide P2
appetite → P3 interleaved. P2 is the high-reward/high-risk core; given the reverted
Era-H foray and the "feel is the gate" history, scope it as its own deliberate
effort, not a drive-by.

## Part 4 — Open product decisions (recommendation first)

- **Refactor appetite (P2)?** _Rec:_ bank P0+P1 now (safe, high-value); schedule the
  `InputArbiter` + migration-finish as a separate, feel-gated effort. The system
  works and is heavily tuned — don't risk feel for tidiness on the same pass as the
  perf wins.
- **`/camera-lab` fate?** _Rec:_ harvest reusable assets, then retire the diverged
  control math (or demote it to "baseline-comparison only, see DreiSceneControls").
  Confirm it isn't shipping publicly first.
- **Deterministic camera replay a goal?** If yes, the legacy fly/still
  `performance.now()` sweep timing must move to a deterministic clock; if no, it's
  fine as runtime-only. _Rec:_ not a goal now — note and move on.
- **Reduced-motion default for auto-rotate?** _Rec:_ yes (off under reduced-motion);
  it's the accessibility-correct default and independent of everything else.
