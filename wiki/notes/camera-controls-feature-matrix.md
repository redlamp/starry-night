---
tags:
  - domain/3d
  - status/open
---

# Camera Controls Feature Matrix

**Date:** 2026-06-08 · **Status:** living reference — keep current as we learn
more, *before* and *during* the [[plan-drei-camera-migration]] implementation.

Behavior-by-behavior inventory of the camera system: what the **old custom `/`
controls** do, what **drei `<CameraControls>`** (the `camera-controls` lib) gives
**out of the box**, and the **thin layer we add** on top. This is the canonical
companion to [[plan-drei-camera-migration]] (it supersedes the looser
feature-disposition table there).

Sources: old behavior read from `components/scene/CameraControls.tsx` (736 lines);
drei/ours validated in `/drei-lab` (`components/drei-lab/DreiLab.tsx`).

**Legend:** ✅ native · ⚙️ thin custom on top · ❌ none · ~~dropped~~ / **changed**
= a decision we made (2026-06-08).

## Orbit

| Behavior | Old `/` (custom) | drei OOTB | Our layer |
|---|---|---|---|
| Drag = yaw + elevation around focal point | manual spherical math (`azimuthDeg`/`elevationDeg`) | ✅ `ROTATE` | — |
| Pinch / wheel zoom | manual radius + ortho-size branches | ✅ `DOLLY`/`ZOOM` (touch falls out) | ⚙️ ortho coupling (see projection) |
| Drag inertia / smoothing | none (direct set) | ✅ native damping (`smoothTime`) — **free upgrade** | ⚙️ tune to taste |
| Distance / elevation clamps + gimbal guard | manual clamps + `camera.up` tipping | ✅ `min/maxDistance`, `min/maxPolarAngle` | ⚙️ configure limits |
| Focal-Y (RMB / two-finger) | custom vertical-only `lookAtY` drag | ✅ `TRUCK` (screen-plane pan) | **changed** — adopt drei's truck; ~~focal-Y-only idiom dropped~~ |
| Auto-revolution sweep | manual `periodSec` accumulation | ❌ no `autoRotate` | ⚙️ per-frame `rotate()` driver (the screensaver turn) |
| Spacebar pause/resume | custom + azimuth settle | ❌ | ⚙️ `Space` toggle (+ azimuth settle in app) |
| Top-down + north-up | `topDownTip` up-vector tween + 90° elev | partial (`setLookAt` straight down) | ⚙️ north-up via azimuth `atan2` trick + dolly-fit (`T`) |

## Fly

| Behavior | Old `/` (custom) | drei OOTB | Our layer |
|---|---|---|---|
| WASD / arrows move | keydown → per-frame | `FlyControls` (but rolls) | ⚙️ `DragLookFly` (`e.code`-tracked) |
| Up / down | Space=up, C=down | ❌ | ⚙️ E/Space up, **Q/C/Shift** down |
| Roll (Q/E) | ✅ rolls | `FlyControls` rolls | **dropped** — horizon-locked, no roll (Q reassigned to down) |
| Sprint | Shift ×2.85 | ❌ | ~~dropped~~ → **wheel = speed** instead |
| Mouse-look | pointer-lock, drag-engaged | `PointerLock` (hides cursor) / `FirstPerson` (re-aims from cursor) | ⚙️ custom drag-to-look (cursor stays, no re-aim) |
| Wheel | speed (moving) / dolly (idle) | ❌ for fly | ⚙️ wheel = fly speed |
| Touch 1-finger look | custom delta look | `FlyControls` drag-looks but **can't move** | ⚙️ drag-look via `clientX/Y` deltas (works on iOS) |
| Touch 2-finger fly fwd/back | custom pinch-dolly | ❌ | ~~dropped~~ — **mobile uses orbit** |

## Framing, projection, state

| Behavior | Old `/` (custom) | drei OOTB | Our layer |
|---|---|---|---|
| Programmatic tweens (presets, Default, intro) | `easeInOutCubic` + gsap | ✅ `setLookAt(…, true)`, `fitToBox` | — (**deletes the gsap tween layer**) |
| WYSIWYG save / restore (`cameraIntent`) | `captureCurrentPoseAsIntent` + still-mode apply | ✅ `saveState`/`reset` + `getPosition`/`getTarget` | ⚙️ bridge to Zustand |
| Perspective ↔ ortho + `orthoSize` + blend | projection state + `ProjectionBlender` | partial (drives either camera) | ⚙️ `ProjectionMorph` (receding-eye matrix morph) |
| `cameraLive` readout (throttled) | `setCameraLive` every 100 ms | ✅ `getPosition`/`getTarget` | ⚙️ thin throttled write → store |
| "Still" / frozen pose | dedicated `still` mode | ✅ (pause / don't drive) | ⚙️ mode flag |

## Mode & input plumbing

| Behavior | Old `/` (custom) | drei OOTB | Our layer |
|---|---|---|---|
| Mode switch (F orbit↔fly, G→orbit) | F/G hotkeys + `enterFly/Orbit` | ❌ | ⚙️ F toggle + two fly→orbit exits (home / from-here) |
| Boot into persisted mode + pose | mount-once fly boot | ✅ camera pos + `setLookAt` | ⚙️ store-driven |
| Typing guard (don't steal input hotkeys) | `isTypingTarget` | n/a | ⚙️ same guard |
| Blur / unmount key reset | `onBlur` clears keys | n/a | ⚙️ cleanup clears keys |
| Context-menu suppress / focal-drag flag | `preventDefault` + `setFocalDragging` | mostly internal | ⚙️ minor |

## Headline

drei absorbs roughly all of orbit + tweens + save/restore + zoom + damping (and
the damping is a free quality bump we never had). Our custom surface shrinks to
the **auto-revolution driver, the projection morph, the drag-look fly controller,
and the mode/store glue** — and the migration *deletes* the gsap tween layer, the
manual spherical math, the pointer-lock fly, and pinch-to-fly.

## Maintenance

This page is the single source of truth for the disposition. Update a row here
(not a copy elsewhere) whenever a decision changes or implementation reveals a
gap. Decisions are dated in [[plan-drei-camera-migration]]; controls history is in
[[decision-orbit-spherical-controls]].
