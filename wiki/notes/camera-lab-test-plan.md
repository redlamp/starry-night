---
tags:
  - domain/3d
  - status/open
---

# Camera Lab - Test Plan

**Date:** 2026-06-17 (updated 2026-06-20) · The `/camera-lab` route is a grey-box "zoo"
for finding which camera control scheme fits best, on desktop and mobile, without
touching the real scene. Companion to [[camera-systems-history]] and
[[camera-controls-feature-matrix]].

## What it is

- A **grey-box environment** (`components/camera-lab/GreyBoxCity.tsx`): a city-scale
  field of neutral instanced blocks + a grid, under bright ambient + key light, with
  four coloured **landmarks** (amber tower NE, teal slab NW, red cube SE, violet spire
  SW) as framing targets. Deliberately not the night city.
- A **method picker** with seven schemes, each labelled by its real-world parallel.
- **Live tuning** sliders/toggles per method, **persisted** between sessions.
- A **survey** (ratings + notes) that persists and exports as JSON for review.
- A **perspective <-> orthographic morph** (the receding-eye matrix blend): toggle by `P`,
  the sidebar `orthographic` switch, or tapping the projection label on the diagram
  (the mobile path). It tweens, holding the focal-plane size constant.
- A **side-view diagram** (`CameraDiagram.tsx`): a live elevation cross-section showing
  the camera, view cone (persp) vs slab (ortho), elevation angle, focal point + plumb,
  ground line, and the camera's clearance above ground. Painted from a ref at display
  rate, so it tracks the scene smoothly (decoupled from React state).
- An **FPS badge** (current + recent-low; skips the backgrounded-tab window) for
  spotting drops.
- A **shadcn sidebar** with collapsible sections (survey / method / settings / tuning /
  test plan), matching the other labs + the main app.

## The seven methods (and their parallels)

1. **App orbit - lever-arm** - your current scheme (Google Earth globe-drag, refined): rotate speed scales with how far you grab from the focus; decoupled/regulated tilt; low-angle + far-zoom taper; tilt-vs-rotate axis gate. Full input set: LMB rotate+tilt, **LMB-on-pin = Focal Y**, RMB/Shift+LMB ground pan, Ctrl/Cmd+LMB or LMB+RMB free-look, wheel zoom, dbl-click reset. Touch: 1-finger rotate · **1-finger-on-pin = Focal Y** · 2-finger pan/pinch · 3-finger free-look · double-tap reset.
2. **Stock drei CameraControls** - the `camera-controls` lib defaults / model viewers: LMB orbit, RMB truck, wheel dolly, native damping. The baseline.
3. **Google Maps** - LMB pans the ground, RMB rotates+tilts, wheel zooms to cursor; 2-finger pinch+twist.
4. **Drei MapControls** - three.js `OrbitControls` rebound for maps (a different library from the camera-controls methods), LMB/RMB flipped to orbit-first: LMB orbit, RMB pan, drag the pin = Focal Y, wheel/pinch zoom. 1-finger pans.
5. **Blender / Maya turntable** - MMB orbit, Shift+MMB pan, wheel dolly (DCC viewports).
6. **Fixed-rate orbit** - uniform degrees-per-pixel rotate+tilt, no lever-arm, snappy (classic OrbitControls). The honest control for "does the lever-arm scaling help?"
7. **FPS fly** - WASD + hold-drag look, wheel = speed (UE5 / Unity flythrough). Desktop-centric.

The camera-controls methods (1, 2, 3, 5, 6) share one `<CameraControls>` driven by
`ProjectionRig` (projection morph + ground clamp + readout) and, for 1 + 6, the custom
`CustomOrbitControls` input layer. Drei MapControls (4) and FPS fly (7) mount their own
camera and are perspective-only.

## Test tasks (run the same set per method)

1. **Frame** the amber tower (NE) so it fills the view.
2. **Orbit** a full turn around the centre, smoothly.
3. **Look up**: drop to street level and tilt up at a tall tower.
4. **Pan** across to the violet spire (SW) without spinning.
5. **Zoom** from the whole field down to one block, then back out.
6. **Recover** to a clean default with Reset.
7. **Mobile**: repeat with 1-finger rotate + 2-finger pan/pinch (and 3-finger / pinch where the method has them).

While testing, ask: did rotate go the speed/direction you expected? Did a tilt drag
stay a tilt (no accidental spin)? Could you stop precisely where you wanted? Did zoom
land where you aimed? Any fight between gestures, or motion sickness?

## Rating dimensions (1-5, per method)

Rotate feel · Tilt feel · Zoom · Pan · Precision · Learnability · Comfort (no
fight/nausea) · Overall — plus free-text notes per method and an overall-notes field
for a ranking / cross-cutting thoughts.

## Feedback persistence + review

- Everything is saved to **localStorage** automatically, so it survives reloads and
  sessions (keys: `camera-lab.feedback`, `camera-lab.tuning`, `camera-lab.method`,
  `camera-lab.projection`, `camera-lab.sect.*` for section collapse state).
- **Copy JSON** copies the full survey (ratings + notes + current tuning) to the
  clipboard - paste it to Claude from any device (incl. a phone over `/rc`).
- **Download** writes `camera-lab-feedback.json` to your Downloads folder, which
  Claude can read directly for review.
- No server route (the GH-Pages static export forbids API routes), so the export is
  client-side only.

## How we use it

Run the tasks across methods, rate + note as you go, then export. Claude imports the
JSON, reads the ratings + notes, and we converge on the scheme (and tuning) to ship -
folding the winner back into the real `DreiSceneControls`.

## Lab internals worth porting into `DreiSceneControls` (for the refactor)

The lab proved a few mechanics the real controller doesn't have yet, or has differently:

> **Port status (2026-06-21):** the Focal-Y = 0 sticky detent, the touch 1-finger-on-pin Focal Y, the
> side-view diagram (Orbit → "side-view diagram"), and default Focal Y = 0 are now IN THE APP, plus a
> new in-app controls cheat-sheet (the "?" panel). The **near-horizon pan limit is still the open
> gap** (the app keeps the grazing "jump"). Full auditable record: [[camera-lab-to-app-port]].

- **Receding-eye projection morph on ONE camera** (`ProjectionRig.tsx`): a naive
  element-wise persp/ortho matrix lerp *snaps* at the end (clip-w stays perspective-
  dominated until t~=0.999 for large world depths). The receding-eye build (keep the
  camera put, recede a virtual eye to infinity, `w = -z + C`) morphs smoothly. The app's
  `ProjectionBlender` already uses receding-eye - keep it, avoid matrix-lerp.
- **Ortho horizon floor + eye-above-ground clamp** (`labProjection.clampPolarToGround`):
  ortho must floor at the horizon (maxPolar <= pi/2), not just keep the eye above ground
  - the focal offset lets the orbit point dip while the eye stays up, so elevation can go
  negative and the ortho frustum shows beneath the world. The app has the floor; the lab
  confirmed the eye-clamp alone is insufficient.
- **Near-horizon pan limit** (`CustomOrbitControls.doPan`): a grazing ground-anchored pan
  explodes (a near-parallel pick ray maps 1px to a huge / sign-flipped ground hit) - the
  "jump to the other side of the map" seen in the app. Cap the per-event step to a few x
  the screen-plane pan + taper toward the horizon, and skip when the ray points above it.
  **Not yet in the app - port candidate.**
- **Ground-anchored pan via a matrix-driven `groundHit`** (two-point unproject) works in
  perspective, ortho, and every morph blend - no special-case ortho ray needed.
- **Focal-Y ground detent** (`labProjection.snapFocalY`): sticky snap to Focal Y = 0
  (ground), thresholds scaled by distance. Port candidate for the real pin-scrub.
- **Ref-backed HUD** (`LabHud`): the readout/diagram repaint from a ref at display rate
  (not throttled React state), matching the scene fps without a re-render storm.

Tomorrow: wrap up the lab + refactor the real controller, pulling these in.
