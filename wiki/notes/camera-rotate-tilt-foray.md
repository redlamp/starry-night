---
tags:
  - domain/3d
  - status/superseded
---

# Camera Rotate/Tilt Foray — Grab-to-Rotate + Tilt-Gate (reverted)

**Date:** 2026-06-21. A multi-attempt foray to fix two orbit gripes; **every attempt was reverted** to the committed baseline (`c330fe8`: lever-arm azimuth + tilt/rotate axis-gate). Recorded as a dead-end so we don't walk it again. Companion to [[camera-systems-history]], [[camera-tuning-notes]], [[camera-interaction-models]].

## What prompted it

Two gripes about the baseline orbit (`dragRotate` in `DreiSceneControls.tsx`):

1. **Inverted-feeling rotate at low elevation** — "grab left of the pin, drag right, the city turns the opposite way." The lever-arm `(v × drag)/|v|²` is a turntable: a straight drag's direction depends on which side of the pin you grabbed.
2. **Oval orbit tilts the camera** — circling the pin to rotate also pitched the view up/down (jarring). Cause: the axis-gate suppresses *azimuth* on vertical drags, so the vertical sides of a circle get no rotation and leak into tilt.

Goal stated by user: circle the pin → rotate (no tilt); clear up/down → tilt.

## What we tried, and why each failed

### 1. Grab-to-rotate (raycast a world handle, servo azimuth to keep it under the cursor) — **"trash"**

On press, raycast the building/ground under the cursor; each move, rotate azimuth so that world point tracks the cursor's screen-X (Newton step on the re-projected handle). Fell back to the lever-arm over empty sky.

**Why it failed:** tracking a point's **screen-X** can't make continuous rotation from a **circular** gesture — a circle's X goes right→left→right, so the rotation chased it back and forth → **zig-zag**. Also jittery (immediate per-move servo) and unpredictable (sensitivity ∝ 1/slope, blows up near the view axis). *(Initial servo sign was also backwards — caught only by a synthetic drag, not reasoning.)*

**Lesson:** to rotate by circling you must track the **angle around the pin** (monotonic over a circle), not a Cartesian coordinate. A synthetic net-azimuth test *passed* and completely missed the zig-zag.

### 2. Turntable azimuth (no axis-gate) + radial/tangential tilt-gate — **net regression**

Kept the turntable azimuth (smooth circling, no zig-zag), **removed the azimuth axis-gate** (so it rotates through a circle's vertical parts), and **added a tilt-gate**: split the drag at the cursor into radial (toward/away from the pin) vs tangential (around it); tilt only with the radial fraction.

- **Rotate** felt better — smooth circling, oval no longer tilts. ✓
- But **a straight up/down drag now orbits the camera** — a vertical drag *beside* the pin is geometrically tangential (= circling), so removing the gate made it spin. ✗
- The tilt-gate is **position-dependent**: up/down only tilts when dragged roughly *above/below* the pin; off to the side it reads as circling and won't tilt. Lowering thresholds helped at low elevation (pin parked low → drags are above it) but not the side case.

User verdict: **the prior baseline felt better** — clean up/down tilt matters more than the oval not tilting.

## The fundamental tension

**"Circle the pin to rotate" and "drag up/down to tilt" geometrically conflict.** A vertical drag *beside* the pin is the *same screen motion* as the side of a circle around it. No instantaneous gate cleanly separates them — every choice just moves the failure:

| Model | Up/down tilt | Oval orbit |
|---|---|---|
| **Axis-gate** (suppress azimuth on vertical) — *baseline* | clean ✓ | tilts ✗ |
| **Turntable** (no gate) + tilt-gate | orbits ✗ (at the side) | clean ✓ |

Robust separators need a *window* (radius-constant = circling vs radius-changing = straight; or path curvature), which trade responsiveness for robustness and were not landed.

## Lessons

- **Synthetic / CDP drag tests validate geometry, not feel.** They gave false confidence twice (the zig-zag passed a net-azimuth check; the tilt-gate passed arc/radial checks). For interaction feel the **user's live test is the only gate** — build it, let them feel it, don't claim "verified."
- **Coordinate-tracking ("grab-follow") is wrong for rotational gestures.** Angle-about-the-pivot is the right primitive.
- **Don't swap a working-but-imperfect feel for an elaborate model** without the user feeling it incrementally. The baseline's gripes were milder than the experiments' new failures.

## Resolution

**Reverted to `c330fe8`** — the lever-arm azimuth + axis-gate `dragRotate`, alongside the [[camera-tuning-notes|low-angle framing / focal-Y scrub / ortho ground-clamp]] work that had already shipped in that commit. The two original gripes remain, **accepted for now**.

## If revisited

Options not fully explored:
- **A modifier or dedicated gesture for tilt** (a key, or a different button) — unambiguous, always catches, at the cost of a mode.
- **A user-facing rotate ↔ tilt balance slider** — hand the dial to the user instead of guessing one global threshold.
- **Path-curvature detection** — tell a curved oval from a straight vertical drag over a short window (position-independent, but slow circles risk mis-reading; needs a tuned memory window).
