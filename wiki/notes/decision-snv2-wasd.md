---
tags:
  - domain/stack
  - status/adopted
---

# Decision: SNCv2 WASD Fly-Through + Hotkey Remap

**Date:** 2026-07-06. Related: [[decision-camera-model-registry]], [[decision-inspect-focus-selection]], [[plan-drei-camera-migration]].

WASD/QE ground-relative movement for the StarryNightV2 orbit rig, plus a global hotkey cleanup.

## Movement

- **WASD** translates the rig (eye + target together) along the HORIZONTAL heading; **Q/E** move down/up on world-Y. Google-Earth read: you glide *over* the city, pitch is ignored, so W never flies you into the ground.
- **Speed scales with the view** so the on-screen glide feels constant at any zoom: perspective uses altitude (`max(eye.y, floor) x k`), faked-ortho uses `orthoSize x framing x k`. A `moveSpeed` slider (Settings -> Camera) multiplies on top.
- Keys tracked by `e.code` (not `e.key` - Shift flips the case), cleared on window blur; integrated in `useFrame` via `setLookAt(..., false)`; clamped to the city disc and floored at ground.

## Can / should we use drei's WASD? - No

camera-controls (SNCv2's base) has **no** keyboard movement. drei's `<FlyControls>` / `<FirstPersonControls>` are full-takeover controllers that (a) don't compose with camera-controls, (b) move along the LOOK vector (W flies into the ground when tilted), and (c) use a fixed `movementSpeed` that knows nothing about our faked-ortho projection. `<KeyboardControls>` is only a key-state provider. So a ~40-line custom integration on the existing rig is the right fit - the same pattern the `/drei-lab` fly rig already uses.

## Hotkey remap

`F` = wireframe, `I` = inspect (global, via `ViewHotkeys`; SNCv2-first, may override other models). Removed the stale bindings this collided with: `I -> Show Pin` (DreiSceneControls, map model) and `F -> Fly` (CameraControls, legacy) - Fly is selector-only now (Settings -> Camera). Dropped the dead `toggleFly` helper. The controls card documents WASDQE/R as key rows and Wireframe/Inspect as toggles.
