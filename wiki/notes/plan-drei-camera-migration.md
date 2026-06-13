---
tags:
  - domain/3d
  - status/open
---

# Plan: Migrate Camera Controls to drei (unify `/` + `/intro`)

**Date:** 2026-06-08 · **Status:** planned, not started

## Why

`/` and `/intro` use two different control systems, and the seam shows — most
visibly the mobile touch gap on the CRT screen (see the touch-to-focus work,
shipped to `/dev`). `/` runs a bespoke 736-line `components/scene/CameraControls.tsx`;
`/intro` uses drei `<OrbitControls>`. Unifying on one base makes behaviour
(especially touch) identical everywhere and deletes a pile of custom code.

The camera is **runtime state**, not seed-derived, so none of this touches the
determinism contract or `gate1`. The risk is in *feel* and the WYSIWYG-save
persistence (`cameraIntent`), not in generation.

## Decisions (2026-06-08)

1. **Base = drei `<CameraControls>`** (wraps the `camera-controls` lib), not
   `<OrbitControls>`. It natively hosts smooth orbit/dolly/truck/zoom,
   transition-aware `setLookAt`/`fitToBox`/`zoomTo`, `saveState`/`reset`, ortho
   support, and configurable mouse+touch maps. Costs: a new `camera-controls`
   peer dep, and it has **no `autoRotate`** and **no fly mode** (handled below).
   - **Orbit adopts drei's model wholesale** (confirmed 2026-06-08 after feeling
     it in `/drei-lab`): drop the bespoke orbit entirely, including the
     focal-Y-only right-drag idiom — right-drag becomes drei's native `TRUCK`
     (pans the target in the screen plane). No custom orbit code survives.
2. **Fly mode → small CUSTOM drag-to-look controller** (~50 lines: WASD/QEC move +
   hold-drag yaw/pitch, horizon-locked, no roll; wheel adjusts speed). No stock
   drei controller fits — `FlyControls` rolls, `FirstPersonControls` steers
   continuously from cursor position (re-aims when you reach for the settings),
   `PointerLockControls` needs a click + hides the cursor. This is ≈ `/`'s
   existing UE5 fly, drag-gated instead of pointer-locked. Validated in `/drei-lab`.
   - **Fly is desktop-only; mobile uses orbit** (confirmed 2026-06-08). Verified
     in three-stdlib that *none* of drei's fly controllers move on touch —
     locomotion is keyboard-only (`FlyControls` drag-looks but can't move,
     `FirstPersonControls`/`PointerLockControls` are mouse/pointer-lock only).
     **Pinch-to-fly is dropped** (was `/`'s only touch-locomotion hack). Mobile
     gets full drei touch parity through orbit; fly is the desktop "explore" mode.
3. **Scope = unify both `/` and `/intro`** onto the shared base (the actual
   goal), including the intro stage + CRT screen.

## Feature disposition

Moved to its own living reference: **[[camera-controls-feature-matrix]]** — a
behavior-by-behavior table of old `/` custom vs drei out-of-the-box vs our thin
layer. Keep that page current (single source of truth); update a row there when a
decision changes or implementation reveals a gap.

Net: ~70% collapses into drei (and deletes the gsap tween code), ~25% becomes a
thin layer over it; fly is re-expressed via a small custom drag-look controller.
One thing still TODO in the plan, not the matrix: the intro stage + CRT screen
swap (`OrbitControls` → `CameraControls`) and the `ScreenRig`/snow-globe handoff
(phase 4).

## Phased rollout

Everything stays behind the existing **Zustand store API** — panels, Save/Reset,
and the seed/gen path don't change; only the controls *implementation* swaps.
Each phase is independently shippable (to `/dev` first).

0. **Spike** — add `camera-controls`; drop a `<CameraControls>` into a throwaway
   route (`/tensor` or scratch); validate orbit/zoom/transition/ortho feel +
   imperative API. Throwaway, ~½ day.
1. **`/` orbit + still + transitions + save/restore** on `<CameraControls>`,
   store-bridged; hand-roll the auto-revolution driver + spacebar pause. Old fly
   path coexists for now.
2. **`/` projection** (perspective↔ortho + blend) on the new base.
3. **`/` fly** via the custom drag-to-look controller (port the lab's `DragLookFly`),
   replacing the old pointer-lock fly layer.
4. **Intro unify** — stage + CRT screen → `<CameraControls>` (the parity
   payoff). Resolve the `ScreenRig`/snow-globe ownership here; fold in the
   touch-to-focus work.
5. **Cleanup** — delete the dead custom controls + gsap tween code; full verify
   (desktop + mobile via `/dev`).

## Phase 1 — build sequence (in progress, 2026-06-08)

The crux is a **data-flow inversion**. Today the store *is* the source of truth:
`components/scene/CameraControls.tsx` reads `orbit.{azimuthDeg,elevationDeg,radius,
lookAtY,centerX,centerZ}` every frame and *derives* the camera. drei
`<CameraControls>` makes the **camera authoritative** (imperative); the store has
to sync on discrete events instead of driving per-frame.

Coexistence: gated by a `?controls=drei` flag read in `Scene.tsx`. **Default = the
old controller, so `/` is 100% untouched.** The flag swaps in the new
`DreiSceneControls` for opt-in feel-testing. Old controller stays until Phase 5.

Mapping (old orbit ↔ camera-controls spherical), verified against `OrbitConfig`:
- `azimuthAngle = azimuthDeg` (both are `atan2(x, z)`; 0 = +Z)
- `polarAngle = (90° − elevationDeg)` (elevation above horizon → polar from +Y)
- `distance = radius`; `target = (centerX, lookAtY, centerZ)`
- auto-revolution: `rotate(2π/periodSec · dt, 0)` each frame when not paused/dragging

Bidirectional sync (the bug-prone part) uses a `syncing` ref: gestures + auto-rev
are drei-owned; on `controlend` (and on pause/`controlstart`) read spherical →
write `orbit` (suppressing the store→camera effect via the ref); slider/preset
edits to `orbit` push store→camera via `setLookAt`.

Sub-steps (each compiles + feel-tested at `/?controls=drei` before the next):
- **A — orbit core (this step):** mount drei `<CameraControls>` behind the flag;
  store↔camera sync; auto-revolution + `Space` pause; throttled `cameraLive`
  readback. Fly/still/projection NOT ported yet (flip the flag off for those).
- **B — transitions:** presets / Default / top-down via `setLookAt(…, true)`
  (keep gsap only where a multi-axis swing is wanted); north-up roll.
- **C — save/restore:** `cameraIntent` round-trips through `saveState`/`reset` +
  `getPosition`/`getTarget` (the load-bearing WYSIWYG guarantee).
- **D — still mode** + remove the flag once orbit reaches parity; old controller
  keeps fly until Phase 3.

### Decisions from the sub-step-A tuning pass (2026-06-08)

- **Input model** (feel-tested live): desktop **LMB = ground-anchored pan**
  (Google grab-the-earth), **RMB = rotate + tilt** (Google uses Ctrl+LMB),
  **wheel + pinch = zoom toward the cursor / pinch-point** in *both* projections
  (shared `zoomToPoint` pins the ground point; ortho scales `orthoSize`, perspective
  dollies), **double-click = zoom in toward the point**. Touch is **fully custom** (camera-controls touch off,
  so it's ortho-correct and we own the directions): 1-finger ground pan, 2-finger
  pinch-zoom + twist-rotate + parallel-drag tilt — the full Google mobile model.
- **Auto-revolution**: pause only once a press becomes a real drag (**>6 px**, so
  clicks/taps don't pause); on release wait **0.4 s** then **ramp 0→full linearly
  over 1 s**; `Space` enable ramps up, disable stops instantly. Speed slider is
  **−60…60 °/s** (signed = direction, 0 = stopped), `periodSec = 360/speed`.
- **Ortho is faked** (see below), so the anchored pan builds a **parallel ortho
  ray by hand** (matching `ProjectionBlender`'s frustum) — `setFromCamera` would
  give a diverging perspective ray on the ortho-matrix'd perspective camera.
- **Projection model (Phase 2) = approach A — KEEP the single `PerspectiveCamera`
  + `ProjectionBlender` morph.** We do *not* swap to a real `OrthographicCamera`.
  Trade-off accepted: a real ortho camera would give native raycast + `camera.zoom`
  (no manual ortho ray / `orthoSize` handling), but it loses the smooth persp↔ortho
  morph, which we want to keep. The manual ortho handling is contained.

## Risks

- **Auto-revolution must read identically** after the hand-rolled driver — it's
  the screensaver's whole identity.
- **WYSIWYG Save/Restore** (`cameraIntent`) must round-trip through
  `saveState`/`reset`.
- **Fly stays custom + desktop-only** — no stock drei controller does
  drag-to-look + horizon lock, and none move on touch, so fly is a small custom
  controller (one of the few bits drei doesn't absorb). Tune `lookSpeed`/speed in
  `/drei-lab`. Touch fly is **resolved, not TBD**: dropped — mobile uses orbit.
- **Intro `ScreenRig`/snow-globe** is the trickiest integration (phase 4).
- **New dep** (`camera-controls`) + bundle size.
- **Mobile** — re-verify on `/dev` each phase.
- `gate1` / generation: **unaffected** (camera isn't seed state).

## Follow-ups / open

- Confirm `camera-controls` version peers cleanly with drei 10 / fiber 9 / three 0.184.
- The intro `ScreenRig` damped-foundation + snow-globe coupling may need to stay
  partly custom even on top of `<CameraControls>` — decide in phase 4.
- Supersedes the original ad-hoc "make the screen controls match `/`" idea; see
  [[decision-orbit-spherical-controls]] for the controls history.
