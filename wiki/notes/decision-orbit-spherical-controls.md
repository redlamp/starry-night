---
tags:
  - domain/scene
  - status/adopted
  - scope/m1
---

# Decision: Spherical Orbit + Drag / Pinch Controls

**Date:** 2026-05-25
**Status:** Adopted

## Context

The original orbit configuration used `{ cameraY, startAngleDeg, radius }` — camera height was a free-floating Y value, independent of orbit radius. There was no way to express "camera directly above the city" without driving `cameraY` to a fake-looking value while leaving `radius` unchanged (the camera would still be on a horizontal ring at altitude).

Pre-mobile testing also surfaced two interaction bugs:

- Adjusting the "period" slider caused a visible angle jump because `orbitStart` wasn't rebased, so the time-based sweep restarted from a discontinuous offset
- There was no way to spin / tilt / zoom the camera with a mouse or finger — the only inputs were sliders

## Decision

Replace the orbit model with spherical coordinates:

- `radius` — 3D distance from city centre (the orbit sphere radius)
- `azimuthDeg` — current yaw around the city axis
- `elevationDeg` — angle above the horizon, clamped 0..90° (never below horizon, never flips over)

Camera position derived per frame:

```
horizR = radius * cos(elevation)
height = radius * sin(elevation)
x = centerX + sin(azimuth) * horizR
y = height
z = centerZ + cos(azimuth) * horizR
```

In orbit mode the camera also responds to user input on the WebGL canvas:

- **Drag yaw** — horizontal pointer/touch movement adjusts `azimuthDeg`
- **Drag pitch** — vertical movement adjusts `elevationDeg`, clamped 0..90°
- **Pinch zoom** — two-finger pinch adjusts `radius` (50..5000 m)
- **Wheel zoom** — desktop wheel does the same

Drag pauses auto-revolution. On release, `azimuthDeg` is rebased to the current angle and `orbitStart` is reset to `performance.now()` so the auto-sweep resumes from exactly where the user let go.

The "period (s)" slider is relabelled "orbit speed" and changes follow the same rebase pattern — adjusting it no longer jumps the camera or the follow-cam moon.

## Why this matters

- The spherical model lets the user reach "directly above the city" with the existing elevation slider; there is no separate top-down preset to maintain
- Clamping elevation at 0 and 90° removes the upside-down failure mode without forcing a min-pitch hack
- Drag controls make the scene approachable on mobile, where the slider-only UI was unusable
- Rebasing `azimuthDeg + orbitStart` on every interruption (drag, period change) gives a single invariant: the camera is always at exactly `azimuthDeg + sweepSinceStart`, no discontinuities

## Tuning constants

- Yaw / pitch sensitivity: 0.25° / pixel
- Wheel sensitivity: 0.5 m / wheel-delta tick
- Radius clamp: 50..5000 m
