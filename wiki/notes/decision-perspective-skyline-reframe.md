---
tags:
  - domain/3d
  - status/adopted
  - scope/m3-plus
---

# Decision: Perspective Skyline Reframes by Moving the Coupled Rig

**Date:** 2026-07-02 · **Status:** Adopted (Starry Night Cam v2)

## Context

"Skyline Mode" is the v2 camera aimed within 2° of flat — the city seen edge-on, like an
architectural elevation. In **ortho** it already worked: the reframe (pushing the empty foreground
ground off the bottom of the frame) is a frustum / focal-offset shift, and because ortho ignores the
eye's along-view position, that shift reads as a pure frame move without appearing to move the camera.

Bringing the same feel to **perspective** was the hard part, and it churned through several rejected
attempts. The root cause is geometric: in an orbit rig at a flat aim, `eye.y == target.y` — the
camera height and the focal height are **coupled**. You cannot lower the camera without lowering the
focal, and keeping the focal pinned to the ground during a pin-fixed rotation requires either
re-centring the view or an automatic descent.

## Options considered

- **Auto-descent** — lower the camera automatically as the tilt approaches flat. Rejected: it
  revived the old "low-angle ground pull" — the camera drifting on its own read as the view sliding
  around under the cursor.
- **Google-Earth ground-anchored orbit** (re-centre on the pinned point). Rejected: LMB relocated /
  centred the pin, which is not how the ortho rotate behaves (there the pin stays put on screen).
- **Pure lens shift** for the reframe (`setViewOffset` / off-center frustum) — a real "camera never
  moves" frame slide, the true perspective analogue of ortho's frustum shift. Sound, and it was the
  proposed path, but **superseded** by the spec below: the user chose to embrace the coupling and
  physically move the rig rather than fake it with the lens.

## Decision

Perspective Skyline splits cleanly into rotate (LMB) and translate (RMB), and the reframe is a
**physical move of the coupled eye + focal**, not a lens trick:

- **LMB = rotate / tilt around a fixed pin.** Both eye and target rotate about the grabbed point, so
  its screen position holds (no re-centre). At a flat aim the ground pick is degenerate, so the pivot
  is synthesised at the mid-map point under the cursor. Drag up flattens + lowers toward the ground;
  the eye is floored at ~1 m (`MIN_EYE_Y`, dropped 5 → 1). Tilt is clamped `≥ 0` (never looks up).
- **RMB = pure translation of the coupled rig.** Up / down pedestals eye **and** focal together (an
  altitude move, floored at 1 m); left / right trucks laterally. No tilt change, no lens shift — the
  camera and focal move as one. This is the user's "reframing the camera".
- **Ortho keeps its focal-offset lens-shift reframe** (the eye is invisible there, so a lens move and
  a camera move read identically, and it retains the full range). The per-frame focal offset is now
  gated to full ortho so a mid-morph frame never pedestals a still-perspective view.

## Why

The coupling is not a bug to fight — every attempt to hide it (auto-descent, re-centre, lens fake)
felt like drift. Moving the coupled rig is the honest, predictable reframe: what you grab stays put,
and up / down changes altitude while the framing follows. Lives in the v2 model
([[decision-camera-model-registry]]). Feel is judged live, not by synthetic drag
([[feedback_interaction-feel-verification]]).
