---
tags:
  - domain/3d
  - status/adopted
  - scope/m3-plus
---

# Decision: Inspect Building Focus / Selection (#87)

**Date:** shipped 2026-07-06 (`cf2c0ef`, tag v2026.07.06). Related: [[decision-camera-transition-tween]], [[decision-perspective-skyline-reframe]], [[decision-facade-display-space-color]], [[decision-network-aligned-districts]].

Builds the click-to-inspect panel (see [[2026-07-05]]) into a full focus/selection system. Iterated live with Taylor.

## Select vs focus (two tiers)

- **Select** (single click): info panel + selection markers. `selectedBuildingId`.
- **Focus** (double-click / panel pin button): camera glides to frame + orbit the building; district-coloured roof pin; orbit-lock. `focusedBuildingId` + `focusPivot`, kept distinct from selection so a plain click never moves the camera. The pin button **toggles** focus (unfocus keeps the selection, drops only pin + lock). Selecting a different building drops the prior focus.

## Focus glide = shortest route (no rotation)

`moveTo(centre)` + `dollyTo(fit)` **preserve the current azimuth/polar** (a pan + dolly, zero rotation). `setLookAt` recomputed azimuth from the drag-accumulated (unbounded) theta down to atan2's principal value, which read as the camera revolving the long way round the city — the same failure the `R`-reset already solved with `moveTo` / `rotateTo(nearTheta)` / `dollyTo`.

## Framing: bounding sphere; ortho fills half height

Distance fits the building's bounding **sphere** (`r = ½ · space diagonal`) to the narrower of the live vertical/horizontal FOV, so the whole building is framed at any orbit angle and aspect. Ortho apparent size is `orthoSize`, not distance, so a separate ramp eases `orthoSize` to `2r / framingFactor` (sphere ≈ half the viewport height). That ramp is a **slow-start smoothstep** over ~0.6 s on the **same `useFrame` clock** as camera-controls' pan/dolly — a free-running `requestAnimationFrame` desynced from the pan and read as jerky. Position runs a snappier `smoothTime` so it settles before the zoom trails in. Tunables: `FOCUS_SMOOTH_TIME`, `ORTHO_FOCUS_DURATION`, `ORTHO_FOCUS_EASE`.

## District colour ties the markers together

The inverted-hull highlight (`uSelectColor`, fed in display space per [[decision-facade-display-space-color]]), the x-ray wireframe (drawn `depthTest:false` so it shows through occluding buildings), the roof pin, and the district-perimeter outline all take the building's `CHARACTER_COLOR`; the panel's district name spans its own row in that colour.

## Two latent picking bugs fixed (three.js / R3F)

- **Stale InstancedMesh bounding sphere.** `InstancedMesh.raycast` early-outs on a cached `boundingSphere` computed once over the current `count`; #55 per-frame tile compaction changes which instances sit in `[0, count)`, so the first-computed sphere goes stale and silently drops picks for buildings outside it. Fix: `computeBoundingSphere()` at build over the full set — buildings never move, so it always encloses any visible subset.
- **Faked-ortho raycasting.** Projection is faked on a `PerspectiveCamera` (ProjectionBlender; see [[decision-perspective-skyline-reframe]]), so `Raycaster.setFromCamera` builds diverging perspective rays even in ortho → off-centre mis-picks. `OrthoPickingFix` overrides it to build **parallel** rays when the live projection matrix reads orthographic (`elements[11] ≈ 0`).
