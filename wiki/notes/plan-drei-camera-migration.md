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
2. **Fly mode → drei `FirstPersonControls`.** (Dropped `FlyControls` — its
   flight-sim roll / no horizon lock felt wrong in `/drei-lab`.) WASD + cursor
   look, no roll. The look-follows-cursor feel differs from the current UE5-style
   drag-to-look; being validated in the lab (fall back to `PointerLockControls` +
   WASD if the feel doesn't land).
3. **Scope = unify both `/` and `/intro`** onto the shared base (the actual
   goal), including the intro stage + CRT screen.

## Feature disposition

| Current feature | Disposition |
|---|---|
| Orbit drag (yaw/pitch) | drei native (`ROTATE`) |
| Pinch / wheel zoom | drei native (`DOLLY`/`ZOOM`) — consistent touch falls out |
| Focal-Y adjust (RMB / two-finger) | map to drei `TRUCK` (vertical) |
| Programmatic tweens (presets, "Default" restore, intro `orbitToMac`) | drei `setLookAt(…, true)` — **deletes the gsap tween layer** |
| WYSIWYG camera intent (save/restore) | drei `saveState`/`reset` + `getPosition/getTarget`, bridged to the store |
| Top-down framing | drei `setLookAt` straight-down + `fitToBox` |
| Top-down north-up roll | thin custom (~10-line roll tween) |
| **Auto-revolution sweep** (the screensaver turn) | thin custom per-frame `rotate()` driver — `camera-controls` has no autoRotate. Non-negotiable to keep |
| Spacebar pause/resume + speed | thin custom (toggles the sweep driver) |
| Perspective ↔ ortho + `orthoSize` + blend | partial — drei drives either camera; the projection *switch* + blend tween stays custom |
| `cameraLive` readout (throttled) | thin — read cam each frame → store |
| Fly mode (WASD + pointer-lock + touch) | drei `FirstPersonControls` (WASD + cursor-look, no roll; `FlyControls` dropped — flight-sim roll felt wrong) |
| Intro stage + CRT screen controls | swap `OrbitControls` → `CameraControls`; resolve the `ScreenRig`/snow-globe handoff |

Net: ~70% collapses into drei (and deletes the gsap tween code), ~25% becomes a
thin layer over it; fly is re-expressed via drei.

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
3. **`/` fly** via drei `FirstPersonControls`, replacing the custom fly layer.
4. **Intro unify** — stage + CRT screen → `<CameraControls>` (the parity
   payoff). Resolve the `ScreenRig`/snow-globe ownership here; fold in the
   touch-to-focus work.
5. **Cleanup** — delete the dead custom controls + gsap tween code; full verify
   (desktop + mobile via `/dev`).

## Risks

- **Auto-revolution must read identically** after the hand-rolled driver — it's
  the screensaver's whole identity.
- **WYSIWYG Save/Restore** (`cameraIntent`) must round-trip through
  `saveState`/`reset`.
- **Fly feel** — `FirstPersonControls` looks by cursor position (Doom-style),
  not pointer-lock drag-to-look; validate in `/drei-lab` and tune `lookSpeed`, or
  fall back to `PointerLockControls` + WASD.
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
