---
tags:
  - domain/camera
  - status/adopted
---

# Decision — Cam v3: Camera Modes as In-Camera Behaviours (2026-07-15)

## Context

The camera-model registry ([[decision-camera-model-registry]]) treats every camera
personality as a separate mounted controller: Top-Down, Drift, and the interactive
SNCv2 are siblings, and moving between them is a model SWAP (unmount/remount +
`cameraHandoff` / `topDownEntry` plumbing, see [[decision-camera-transition-tween]]).
That kept each model simple, but the seams show in use: `t` tears down the camera you
were flying and hands you a different one; Drift is a place you go, not something the
camera does; and a focus glide can land with commute arcs viewed end-on.

## Decision

Build **Starry Night Cam v3** (`snv3`, new default) as a fork of SNCv2 that folds the
parallel modes in as behaviours of ONE continuous camera — no model swaps, no handoffs:

1. **Top-down is a flight.** `t` glides this camera to a whole-city overhead plan
   framing (same fit math as the Top-Down model). All controls stay live overhead.
   `t` again returns to the exact banked pre-top-down pose — UNLESS the view was
   manually tilted below `TD_STILL_ELEV_DEG` (65°), in which case `t` re-squares to
   overhead and the banked pose waits for the next press. Pan/zoom/WASD keep the
   overhead elevation, so they never count as "leaving". Dispatch: `cameraView.
   toggleTopDown()` first offers the toggle to `cameraCommand.toggleTopDownInModel`
   (registered while v3 drives orbit); non-v3 models fall through to the old swap.
2. **Drift is an idle behaviour.** `snv3.autoDrift` (toggle) + `snv3.idleDelaySec`
   (slider, default 10 s): leave the camera alone and it eases (4 s smoothstep) into
   the Drift model's motion — azimuth revolve, focal wander, elevation bob, dolly
   breathe — anchored at the CURRENT pose (current radius/bearing/focal, elevation
   clamped into a 3–55° band), so it reads as the camera taking off from where you
   left it. Feel knobs are shared with the Drift model's store slice (`drift`). Any
   input cancels instantly and re-arms the timer. Suppressed while top-down is parked
   or an inspection (drill cards / selected building) is open — reading isn't idling.
   Reworked 2026-07-16 (round 8) into TWO switches: **drift MODE** (runtime
   `driftMode`, never persisted — Space / the floating helicopter button / the Drift
   header switch / the Orbit transport) flies until told otherwise, pausing for manual
   adjustments and easing back in ~1.6 s after release on a 5 s ramp; **idle drift**
   (persisted `snv3.idleDrift`, off by default) takes off by itself after
   `idleDelaySec`, and an intervention restarts the full timer. The shared three-way
   transport (`cameraCommand.toggleDrift`) also covers stopping an idle flight without
   flipping the mode on. The floating button's icon mirrors the flight: Rotate3d =
   manual camera, Helicopter = drifting (either path).
3. **Cone-view focus is arc-aware.** `showLocations` (EntityColumns) now computes the
   arcs' dominant ground bearing (length-weighted axial mean in doubled-angle space)
   and sends `viewAzimuthDeg` — the perpendicular heading nearer the live azimuth —
   on the `focusRequest`. v3's focus glide rotates there the short way (nearest
   winding), so arcs present broadside; requests without the field keep the old
   never-rotate rule. While LMB-orbiting a cone pivot, a pin + cone glyph marks the
   arcs' centre point (the revolve centre); RMB pan moves the camera but never the
   pivot.
4. **Touch is hand-rolled.** Native camera-controls touch off; 1-finger orbit + tilt,
   2-finger ground-anchored pan + pinch-zoom toward the midpoint, double-tap zoom-in
   (suppressed in inspect mode, mirroring double-click). Same math/clamps as the
   mouse gestures. Twist-rotate and 3-finger free-look deliberately deferred.

## Why a fork, not a refactor

The registry's contract is self-contained models; v2 stays untouched as the stable
fallback while v3 is evaluated (same play as map→snv2). The ~300 duplicated lines are
the price of not destabilising the default camera mid-stream; if v3 is adopted, v2
can be retired rather than maintained in parallel.

## Notes

- `setPointerCapture`/`releasePointerCapture` are wrapped throw-safe: they raise
  `NotFoundError` for pointers the browser doesn't consider active (synthetic CDP
  events, cancelled-touch races), and an unguarded throw strands the gesture state.
- `TopDownModel.finishExit` now hands off restore poses for `snv3` as well as `snv2`
  (the swap path still runs when v3 isn't driving, e.g. from fly/still).
- Verified headless via `scripts/cdpShot.ts` + store probes (capture mode parks
  `cameraMode: "still"` — set it to `"orbit"` in `SHOT_SETUP` before driving v3).
- Live test plan: [[test-plan-2026-07-15-camera-v3]].
