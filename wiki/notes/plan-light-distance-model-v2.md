---
tags:
  - domain/lighting
  - status/draft
  - origin/user-feedback
---

# Plan: Light Distance Model V2

2026-07-27. Follow-up to [[light-sprite-sizing-survey]] and the shipped #99 work
(shared `lib/shaders/lightSize.ts` + Settings > Lights panel, v2026.07.26).

User feedback that prompted this: *"The settings as they are do not seem helpful
or inline with what I expect. Close should be on the top and left, far is on the
bottom and right."* Read: the drop-off chart should read like a distance
falloff, with the vertical sliders bounding the chart's vertical axis and the
horizontal axis carrying distance.

## Current state

`lightSizePx()` (`lib/shaders/lightSize.ts:40`) computes exact geometric pixel
size from the live projection matrix, then pushes it through a user-editable
cubic bezier and clamps to per-family bounds:

```glsl
px   = D * uGlowScale * projectionMatrix[1][1] * uViewH / (2 * clipPos.w);
x    = clamp(px / (maxPx * uSizeMaxScale), 0, 1);   // <-- the problem
y    = curve(x);
size = clamp(ceilPx * y, minPx * uSizeMinScale, ceilPx);
```

Per-family bounds today (device px, before the multipliers):

| Family | Floor | Ceiling | World diameter | Call site |
|---|---|---|---|---|
| Traffic | 1 | 16 | `1.2 * aSize * uSizeScale` | `lib/shaders/traffic.ts:118` |
| Streetlights | 2 | 10 | `1.2 * uBaseSize` | `components/scene/Streetlights.tsx:84` |
| Flights | 4 | 10 | `1.6 * aSize` | `lib/shaders/flights.ts:227` |
| Helicopters | 4 | 10 | `1.6 * aLight.z` | `lib/shaders/helicopters.ts:156` |
| Beacons | 10 | 28 | `0.25 * uBaseSize` | `components/scene/Beacons.tsx:33` |

## What is actually wrong

1. **The chart's X axis is not distance.** It is `geometricPx / familyCeiling`.
   Because every family has a different ceiling (16 / 10 / 10 / 10 / 28), the
   same camera distance lands at a different X per family. One curve carries
   five different distance meanings, so no position on the chart describes
   "far away".
2. **Unrelated sliders slide the domain.** Glow and Ceiling both divide into X,
   so dragging either shifts the whole axis under the curve. The curve appears
   to do different things depending on knobs that should not affect it.
3. **Floor and Ceiling are unitless multipliers** over hidden per-family px
   constants. "Floor 1.35" is unreadable, and it means 1.35 px for traffic and
   13.5 px for beacons.
4. **Nothing dims below the size floor.** Once a light clamps at its floor,
   `lightSizeBright` stops changing too (`lightSize.ts:50` reads the same
   curve). The far city becomes an even carpet of equal-brightness dots until
   #52's cull distance removes them. Physically, irradiance keeps falling as
   1/d² long after the source is subpixel.
5. **Lights ignore the atmosphere.** All five materials set `fog: false`, so
   distant lights hold full contrast at 8 km instead of washing into haze.
6. **Two distance systems multiply, in different panels.** #52's LOD brightness
   ramp keys off world camera distance in metres (Performance > LOD: near /
   far / cull, `components/ui/RoadsPanel.tsx:83`), while #99's Bright follow
   keys off normalized size (Settings > Lights). Tuning one partly undoes the
   other.

## Proposed changes

### A. Flip and label the axes

- X = distance: close on the left, far on the right. Log spacing so a wheel
  zoom moves the marker at a steady rate.
- Y = apparent size in pixels: largest at top, floor at bottom.
- Floor and Ceiling render as horizontal lines on the chart, so the vertical
  sliders visibly bound the vertical axis.
- The default curve then reads top-left down to bottom-right, matching the
  expectation.
- Dashed reference = pure geometry (1/d). On log-log axes that is a straight
  diagonal, so "above the line" reads as glare bonus and "below" as shrinking
  faster than physics.
- Migration: this reverses the meaning of persisted curves (`lightSize` is
  `persist: true`, `lib/state/sceneStore.ts:338`). Reflect stored control
  points through (0.5, 0.5): default `[0.35, 0.42, 0.75, 0.82]` becomes
  `[0.25, 0.18, 0.65, 0.58]`. Alternative: bump the persisted key and let old
  values fall back to the new default.

### B. Anchor X to real distance, in both projections

Key the curve domain on the frustum height at the light:

```glsl
H = 2.0 * clipPos.w / projectionMatrix[1][1];
```

That is `2 * d * tan(fov/2)` in perspective and `orthoSize` in ortho,
continuous through the ProjectionBlender morph, no branching. Both terms are
already in the helper. Then:

```glsl
x = clamp(log2(H / uHNear) / log2(uHFar / uHNear), 0.0, 1.0);
```

with `Hnear` around 50 m and `Hfar` around 12 km. One curve, one distance
meaning across all five families, and the chart axis can be labelled in metres.
This is the same unification the research note already identified (see
[[light-size-vs-distance]] section 3), applied to the curve *domain* rather
than only to the size multiplier.

### C. Absolute pixel bounds, per family

Replace the two unitless multipliers with real px floors and ceilings per
family, plus one global Glow. Draw all five families as ghost lines on the same
chart with the selected one highlighted. The fact that a streetlight bottoms out
at 2 px while a beacon holds 10 px is currently invisible in the UI.

### D. Conserve flux below the floor

The biggest realism gap. When the clamp holds a sprite *above* its geometric
size, scale intensity by `(geomPx / drawnPx)²`. Total energy stays constant, so
far lights dim as 1/d² automatically instead of holding flat at the floor. This
is the standard point-splat rule (same physics as the star splatting in
[[light-size-vs-distance]] section 1) and it is self-tuning: it replaces
"Bright follow" with something physical. Keep a 0-1 blend for taste.

Note this is the graceful-exit behaviour [[decision-flights-live-caps]] already
argued for: cap size, fade intensity, so lights leave the frame instead of
popping.

### E. Fold #52's LOD into the same axis

Once D exists, the LOD brightness ramp is redundant. Keep the cull distance,
drop the brightness half, and draw the cull as a vertical marker on the Lights
chart. One distance axis then governs everything instead of two knobs in two
panels.

### F. Put lights in the atmosphere

Apply the scene's haze factor to light alpha so distant lights lose contrast and
shift toward the haze colour. Relates to [[plan-fog-extent-adaptation]]: both
are about the far field keying off the right distance.

### G. Live camera marker

Draw the current camera's position on the chart's X axis with the resulting px
per family. Turns the chart from an abstract easing curve into a readout that
can be tuned against while zooming.

## Suggested order

1. **A + B** — one refactor, fixes the "does not match expectation" complaint
   directly.
2. **D** — biggest visual change to the far field.
3. **G** — cheap, and makes everything after it tunable by eye.
4. **C**, then **F**, then **E**.

## Verification

Same gate as #99: wheel-zoom sweep from street level to whole-city in both
projections and through the morph, no band where dots pop, balloon, or vanish.
The user's live feel test is the gate, not a screenshot probe. Determinism is
untouched throughout: all of this is a render-time function of camera state.
