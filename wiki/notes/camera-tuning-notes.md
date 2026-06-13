---
tags:
  - domain/3d
  - status/open
---

# Camera Tuning Notes (drei migration)

Running list of open tuning issues / proposals for the drei camera bridge
(`components/scene/DreiSceneControls.tsx`, behind `?controls=drei`). Companion to
[[plan-drei-camera-migration]] and [[camera-controls-feature-matrix]]. On branch
`feat/drei-camera-tuning`.

## Open decisions awaiting feedback (2026-06-13)

Research + recommendations in [[camera-interaction-models]] (Taylor to review). The fork
that gates the rest: **is Focal Y the right model**, or should "looking up" be a bounded
tilt gesture with Focal Y demoted to a slider? Downstream of that: build pin-drag-to-set-
Focal-Y (desktop-only; drei won't auto-disable `<CameraControls>` so needs manual
camera-freeze), remove the LMB+RMB free-look chord, and clamp upward pitch for stars
framing. **Proceeded independently this session:** Shift+LMB rotate fallback + issue #80
(see Done below).

## Open issues

### 1. Focal Y should be the focal HEIGHT above the ground (next up)

**Now:** the Focal Y slider writes `orbit.lookAtY`, and the slider→camera sync
applies it via `applyOrbit` — but the focal **indicator** and the **orbit pivot**
(RMB / dbl-click / two-finger tilt → `setOrbitPoint`, and the derived-focal
raycast) are all hardcoded to a fixed height, `GROUND_CLEARANCE = 20`. So they
ignore `lookAtY`: an RMB-orbit snaps the focal back to 20, the pin always sits at
20, and the slider's effect is transient. Focal Y is half-wired + conflicting.

**Want:** **Focal Y = the focal point's height above the ground.** Replace the
hardcoded `GROUND_CLEARANCE` with `orbit.lookAtY` everywhere the focal height is
used:
- the derived-focal raycast plane (`groundHit(..., lookAtY, _focal)` each frame),
- the RMB-orbit / dbl-click / tilt `setOrbitPoint` height,
- the map-pin height (it already tracks `_focal`, so this follows).

Result: the focal point is the orbit/rotate foundation (unchanged), the **map pin
reflects Focal Y**, raising Focal Y **lets the camera look up** (orbiting at low
elevation around a higher focal aims toward the horizon/sky), and the **plumbline
still drops to the ground (y=0) with the dot** at the end. The ground ring stays
on the ground.

**Diagnosis (2026-06-08):** beyond the indicator/pivot ignoring `lookAtY`, the
slider→camera path (`applyOrbit`) also **couples camera Y to `lookAtY`**:
`cameraY = lookAtY + radius·cos(polar)`. So dragging Focal Y lifts the whole rig
(the camera translates up) while the elevation stays put — instead of re-aiming.
Two ways to fix, decide next session:
- **A (camera-controls-friendly):** on a Focal-Y-only change, keep the camera
  position and just re-aim — `setLookAt(camPos, centerX, lookAtY, centerZ)`. The
  view tilts up toward the higher focal; camera Y stays. Side effect: radius +
  elevation re-derive (orbit re-fits around the new focal), so those readouts move.
- **B (old model, decoupled):** orbit around the focal's XZ **ground axis** (camera
  height = `radius·sin(el)`, independent of `lookAtY`) and *look at* `(centerX,
  lookAtY, centerZ)`. Then Focal Y changes only the aim — camera Y *and* elevation
  both unaffected. Truest to the old controller, but camera-controls ties its orbit
  pivot to the look point, so this needs a custom layer (or `setFocalOffset`).

### 2. Orthographic mode — make it feel good (plan, 2026-06-13)

**How faked ortho works (verified in ProjectionBlender):** at blend = 1 it writes
`makeOrthographic(±aspect·orthoSize, ±orthoSize, near, far)` using the REAL camera's `near`
(0.5) / `far` (12000·CITY_SCALE = 24000) at its REAL position — the camera never moves for the
morph. So apparent zoom = `orthoSize`; the orbit **radius (camera distance) is decoupled from
zoom**, but still sets where the camera sits in view-depth.

**Clipping (root cause):** the ortho frustum uses the real camera's near/far at the real radius,
so a SMALL radius + LARGE orthoSize parks the camera *among* the city — the near half of the
scene falls behind the near plane / behind the camera and clips. (In perspective a small radius
just reads as "zoomed in"; in ortho orthoSize zooms independently, so you can be wide-but-close.)
→ **Fix:** in ortho keep radius ≥ (tier half-extent + apron + a tall-building margin) so the
whole scene sits in front of the camera. Radius doesn't change ortho apparent size, so expand it
freely and make it **non-user-facing in ortho** (auto-park, ~1.5–2× the tier half-extent). This
is the "expand the distance" idea; it stops being "hard to navigate" because the user never
touches distance in ortho — they zoom via orthoSize and rotate / tilt / pan.

**Underview / ground-slice:** cameraY = focalY + radius·cos(polar); the existing
`maxPolarAngle = acos(−focalY/radius)` already keeps cameraY ≥ 0, which at a healthy ortho radius
means elevation ≳ 0 (no looking up from under). For a nicer default add a small **minimum
elevation floor** (≈ 8–15°) so the ground always fills the lower frame instead of going edge-on.
The intentional underview (later) = a flag that lifts the floor / polar clamp on purpose.

**Distance vs zoom UX:** in ortho "Distance" (radius) is NOT the zoom — orthoSize is. Hide /
auto-manage the Distance slider in ortho and expose a "Zoom" / "Size" control bound to orthoSize
(the wheel already does this), so the two aren't conflated.

**Fog coupling (flag):** FogTicker derives fog from camera→city distance (radius). With radius
parked in ortho, zooming (orthoSize) won't change the fog — atmosphere stops responding to zoom.
Decide: key ortho fog off `orthoSize` instead of radius.

**Gesture parity (the old `// ortho: solved later` tags):** port RMB orbit-pivot, two-finger
tilt pivot, and pinch zoom+truck anchoring to ortho (groundHit already builds the ortho-correct
parallel ray). Extend the Focal-Y pin-scrub to ortho by hit-testing the pin with the faked-ortho
parallel projection instead of `camera.project` (which takes the perspective branch → wrong spot
in faked ortho). Screen Y + its guide already work in ortho (applyScreenFocus uses orthoSize).

**Near/far:** sourced from camera.near/far (0.5 / 24000) — fine as long as radius stays in the
safe band; only widen `far` if we ever park radius very large.

### 3. Two-finger touch refinement

`touches.two` can't be `TOUCH_DOLLY_SCREEN_PAN` (omitted from camera-controls'
`multiTouchAction` type) — we hand-roll the two-finger gestures instead. The
custom touch handler (1-finger pan, 2-finger pinch/twist/tilt with a
dominant-gesture lock) covers it; revisit if the lib types gain the combo.

## Remaining migration phases (from the plan)

- **Sub-step C — Save/Restore:** `cameraIntent` round-trip through
  `saveState`/`reset` + `getPosition`/`getTarget` (the WYSIWYG guarantee). Not
  wired yet.
- **Sub-step D — still mode**, then drop the `?controls=drei` flag once orbit
  reaches parity. Old controller keeps fly until Phase 3.
- **Phase 2 projection:** decided to KEEP approach A (single PerspectiveCamera +
  ProjectionBlender morph; faked ortho). The faked ortho is why pan/zoom need the
  hand-built parallel ray + `orthoSize` handling.
- **Phase 3 fly · Phase 4 intro unify · Phase 5 cleanup** — see the plan.

## Done 2026-06-13 (Option A: pin-scrub for Focal Y)

- **Pin-scrub** — LMB on the focal pin sets Focal Y as a **cursor-locked relative scrub**
  (positional drag is impossible: the pin is parked at the screen-focus %, so it can't also
  follow the cursor). `cursor:none` + pointer-capture + `movementY × distance × K` → Focal Y
  (clamped −200…2000), re-aim from the same camera position so the view tilts, restore cursor +
  writeBack on release. Hover shows `ns-resize`. Lighter than the Pointer Lock API (no "press
  Esc" overlay); switch to Pointer Lock if the bounded range hits a screen edge. Perspective +
  indicator-on only (ortho/touch keep the Focal Y slider). Camera position never moves, so the
  scrub can't push the rig through the ground. **Next:** validate feel, then remove the LMB+RMB
  free-look chord (its job is now covered). Research + rationale: [[camera-interaction-models]].

## Done 2026-06-13 (additive, independent of the Focal-Y fork)

- **Shift+LMB-drag = rotate/tilt** — the modifier twin of RMB rotate, for trackpad /
  one-button users (Google/Mapbox convention). A `keydown`/`keyup` listener swaps
  `mouseButtons.left` between `ROTATE` (Shift held) and `NONE` (custom pan); the pan
  effect bails on `shiftKey` so they never fight. Needs interactive test.
- **Issue #80 — focal markers always-mounted + visibility-toggled** (no more conditional
  render). 3D lines use `visible={showFocal}`; the Html pin/dot use `display`. The
  priority -1 frame keeps them parked on the focal point even while hidden, so revealing
  them is flash-free (kills the drei `<Html>` origin-flash flicker). Needs interactive test.

## Done this session (sub-steps A + B, on `feat/drei-camera-tuning`)

Bridge: Google-Maps input model (LMB pan / RMB orbit+tilt / wheel zoom-to-cursor /
dbl-click zoom / touch pinch+twist+tilt with gesture-lock), auto-revolution
(drag-threshold + 0.4s delay + 1s ramp + Space pause), ortho-correct pan/zoom,
camera-derived focal indicator (map-pin + plumbline + ground dot + radius ring,
drawn over terrain), default FOV 25 + perspective pinned, distance/polar clamps,
**slider→camera sync** (sub-step B). Panel: xyz-column readout w/ icons +
shadcn tooltips, telescope/box projection tabs, fov + camera→focal distance,
signed −60…60 speed slider, wider orbit steppers, rounded readback.
