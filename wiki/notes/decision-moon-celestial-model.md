---
tags:
  - domain/scene
  - status/adopted
  - scope/m1
---

# Decision: Moon as a Celestial Body (azimuth / elevation / distance)

**Date:** 2026-05-25
**Status:** Adopted

## Context

The moon's original parametrisation used cylinder coordinates: `horizontalRadius` (XZ distance from city axis), `height` (Y), and `angleDeg` (yaw). The `moonOppositeCamera` debug toggle replaced `angleDeg` with `cameraAzimuth + π` to keep the moon opposite the camera.

That model had two problems:

1. It mixed orbital radius with raw Y, so different `(horizontalRadius, height)` combinations that produced the same visible sky direction were treated as distinct configurations.
2. From low cameras (`cameraY = 2`), high `height` values made the moon visually drift toward "above the city" even though the math correctly preserved its horizontal radius from city centre. The debug toggle made the drift worse because the user could not tell whether the moon was actually opposite the camera or hovering above the centre.

The conceptual model the user wanted was a real celestial body: a fixed direction in the sky at a (large) distance, like the actual moon. Parallax against the city should be tiny — the moon should appear locked to the sky dome.

## Decision

Re-parametrise the moon as:

- `azimuthDeg` — compass yaw around the city axis (0 = +z, 90 = +x)
- `elevationDeg` — angle above the horizon (0 = horizon, 90 = zenith, allows negative values for cinematic dip)
- `distance` — radial distance from city centre, defaulting to `stars.radius` so the moon sits on the celestial sphere

Position is derived:

```
hr = distance * cos(elevation)
x  = centerX + sin(azimuth) * hr
y  = distance * sin(elevation)
z  = centerZ + cos(azimuth) * hr
```

Defaults preserve the previous visible position (≈ `az 200° / el 32° / dist 4500`), which corresponds to the legacy `horizontalRadius 3742 / height 2321 / angle 200`.

The `moonOppositeCamera` flag is renamed `moonFollowCamera` and overrides only the azimuth (`cameraAzimuth + π`); elevation and distance stay locked to the user's slider values. The toggle defaults to off so the moon behaves like a real celestial body unless the user explicitly opts into the follow-cam debug mode.

## Why this matters

- The user repeatedly confirmed the mental model is "fixed point in the sky". The cylinder-coord model couldn't represent that — the new spherical model does.
- Distance defaulting to `stars.radius` removes parallax against the star dome — camera motion no longer slides the moon relative to the stars.
- The follow-cam toggle now does exactly one thing: re-yaws the moon to be opposite the camera. Elevation + distance are decoupled, so the moon never "drifts to centre" when the user toggles it.

## Implementation

- `lib/state/sceneStore.ts` — `moon` field reshaped, `moonLive` matches, `setMoonFollowCamera` action
- `components/scene/Moon.tsx` — spherical-to-cartesian in `useFrame`
- `components/ui/CameraPanel.tsx` — debug sliders relabelled `az° / el° / dist`, live readout matches
