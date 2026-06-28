---
tags:
  - domain/3d
  - status/open
  - scope/m2
---

# Plan — Unify the Camera Selector (one dropdown)

**Date:** 2026-06-28. Companions: [[decision-camera-model-registry]] (the registry this
extends), [[plan-drei-camera-migration]] (the migration this finishes), [[camera-systems-history]],
[[plan-camera-refactor-optimization]].

## Problem

There are **two overlapping selection axes**, which is confusing:

- `cameraMode` (`still | fly | orbit`) — the header **Fly / Orbit / Top-down** tabs.
- `cameraModel` (`map | drift | turntable`) — a **separate** selector, shown only in Orbit.

"Orbit" is really just the umbrella for the three orbit models; **Top-down** is an
orbit *framing* (north-up, aspect-fit) not a distinct controller; **Fly** is a
separate (legacy) controller; **Still** is legacy/capture-only. So picking "Drift"
takes two controls (Orbit tab → Drift), the two axes can disagree, and "Orbit" +
"Still" are leaky concepts.

## Target

**One shadcn `<Select>` dropdown — "Camera" — listing every camera as a peer**, backed
by a single id. "Orbit" and "Still" disappear from the user-facing surface (orbit = its
models; still = capture-only/internal):

```
Camera ▾
  ── Orbit ──
  Map         hands-on: grab, orbit, zoom
  Drift       hands-off ambient wander
  Turntable   showcase spin
  ───────────
  Top-down    north-up overhead
  Fly         free flight (desktop)
```

(`components/ui/select.tsx` already exists; `Select` supports grouped items + labels.)

## Two-stage rollout

### Stage A — unified dropdown over the *existing* axes (low-risk, ship first)

Pure presentation: replace the mode Tabs **and** the Map/Drift/Turntable selector with
one Select. Each option maps to today's state via the existing `cameraView` helpers — no
internal refactor:

- **Map / Drift / Turntable** → `enterOrbit()` (if needed) + `setCameraModel(x)`
- **Top-down** → the existing enter-top-down (orbit + north-up fit)
- **Fly** → `enterFly()`

The active option is *derived* from `(cameraMode, orbitRestore, cameraModel)`:
fly → "fly"; orbit+orbitRestore≠null → "topdown"; else → `cameraModel`. This delivers
the UX immediately and is reversible.

### Stage B — collapse to one id + finish the migration (the real cleanup)

- Introduce **`CameraId = map | drift | turntable | topdown | fly`** as the single source
  of truth; derive/retire `cameraMode` + `cameraModel`.
- Fold the last two into the camera-model registry:
  - **Top-down** → the orbit rig entered with the top-down framing (a thin model, or a
    Map entry-flag) — surfaced as its own dropdown entry.
  - **Fly** → a `FlyModel` (port the legacy drag-look fly per
    [[plan-drei-camera-migration]] Phase 3 — small custom drag-look, desktop; touch falls
    back to an orbit camera).
- Retire `components/scene/CameraControls.tsx` (migration Phase 5) + the `?controls=legacy`
  path + the superseded gsap mode-tween code. **Payoff: one registry, one selector, one
  mounting path** — and the stalled migration is finally done.

## Decisions to settle (recommendation first)

- **Top-down: model or preset?** → *Rec:* an entry-framing of the orbit rig, surfaced as
  its own dropdown entry (not a wholly separate controller).
- **Still in the UI?** → *Rec:* drop it from the selector; keep `still` for capture only.
- **Fly on touch?** → *Rec:* keep desktop-only (migration already decided mobile uses
  orbit); on touch, hide Fly or fall back.
- **Keybinds:** today F/G/T switch mode. Keep per-camera keys (or a cycle) in the unified
  world? → *Rec:* keep F (fly) + T (top-down) + maybe a key to cycle orbit models.
- **Grouping/labels** in the Select (Orbit group vs flat list).

## Risk / verification

Camera is **runtime state** → no `gate1` impact. The risks are **feel** (Fly/Top-down must
read identically after the port — gated by the user's live test, not synthetic) and
**persistence** (the unified id must round-trip through Save/Reset/Revert). Stage A touches
only the header selector + a mapping (safe alongside the in-flight `DreiSceneControls.tsx`);
Stage B is the deeper refactor, scheduled as its own effort once Stage A is settled.
