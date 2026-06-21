---
tags:
  - domain/3d
  - status/active
---

# Camera Lab → App Port Log

**Started 2026-06-21.** The `/camera-lab` grey-box ([[camera-lab-test-plan]]) is where camera
mechanics get proven before touching the real scene. This logs what has actually moved into the
production controller (`components/scene/DreiSceneControls.tsx` + `components/scene/*` + `lib/scene/*`)
so the port is auditable and the remaining gap is explicit. Companion to [[camera-systems-history]].

## Ported (done)

| Lab mechanic | Lab source | App destination | Verified |
|---|---|---|---|
| Side-view diagram | `camera-lab/CameraDiagram` | moved to `components/scene/CameraDiagram`; mounted via `components/scene/CameraSideView` + per-frame ref write `lib/scene/cameraReadout` in `DreiSceneControls`; Orbit → "side-view diagram" toggle (`showSideView`, persist:false) | headless cdpShot: toggle on, diagram renders bottom-left, ortho slab + clamp + constant scale |
| 1-finger-on-pin Focal Y (touch) | `CustomOrbitControls` touch scrub | `DreiSceneControls` touch handler (`scrub` branch); `pinScreenHit` gained a touch pad (+14px) | tsc/lint; mirrors the mouse pin-scrub; gated on the focal pin being shown |
| Sticky Focal-Y = 0 detent | `labProjection.snapFocalY` | inlined `snapFocalY` in `DreiSceneControls`, applied in BOTH mouse + touch scrub (raw accumulator + `*Snapped` hysteresis) | tsc/lint |
| Default Focal Y = 0 | lab HOME | `DEFAULT_ORBIT.lookAtY` 120 → 0 | tsc/lint — note this changes the default framing (aims at ground, not mid-skyline) |
| Ref-backed HUD pattern | `LabHud` | `CameraSideView` rAF snapshot (repaints on visible change only) | ~display-rate repaint, no scene/panel re-render storm |

Plus a NEW in-app piece (not a lab port): the **controls cheat-sheet** (`components/ui/ControlsGuide`)
— non-modal bottom-right card, shadcn Tabs (Mouse/Touch, auto-switching on the last input type),
**live amber highlight of the active gesture** (via `lib/scene/cameraActivity`, `markCameraActivity()`
called per-gesture in `DreiSceneControls`), editable SVG glyphs in `public/controls/*.svg`. Mounted in
both the app and the lab. Stays up while testing (Esc / ✕ / "?" dismiss only — no scrim, no
click-outside close).

## Already in the app before this port (kept, NOT re-ported)

- **Receding-eye projection morph** — `components/scene/ProjectionBlender.tsx` (gsap blend + a radius
  co-tween between the perspective distance and the ortho park; the lab's `ProjectionRig` is the
  simpler per-frame damp-eased twin with no radius move). Keep it; do NOT regress to a matrix lerp.
- **Ortho horizon floor + eye-above-ground clamp** — `DreiSceneControls` per-frame `maxPolarAngle`.

## Pending (NOT yet ported)

- **Near-horizon pan limit** — the clearest remaining gap. The app's ground-anchored pan
  (`DreiSceneControls` mouse-pan `onMove` + the 2-finger pan branch, both via `panRig`) still has NO
  per-event cap, so a grazing, near-parallel pan maps 1px to a huge / sign-flipped ground hit — the
  "jump to the other side of the map." The lab caps it in `CustomOrbitControls.doPan`: clamp the
  per-event ground delta to ~`PAN_CAP_MULT`(6)× the screen-plane pan, taper toward the horizon
  (`PAN_TAPER_DEG` 12°, floor `PAN_TAPER_FLOOR` 0.2), and skip when the pick ray points above the
  horizon. Port target: the two pan move sites in `DreiSceneControls` (or fold the cap into `panRig`,
  but NOT `panRig`'s zoom re-pin call).
- **Matrix-driven `groundHit` (two-point unproject)** — optional. The app special-cases the
  faked-ortho ray (a parallel-ray branch in `groundHit`); the lab's two-point unproject (unproject ndc
  at z=-1 and z=+1, ray = far-near) works for perspective, ortho, and any morph blend with no special
  case. Adopt if the ortho ray branch ever drifts; not urgent.

## Notes

- `snapFocalY` is intentionally DUPLICATED (lab `labProjection.ts` + app `DreiSceneControls.tsx`)
  rather than shared, to avoid the app importing from the throwaway lab. If a third consumer appears,
  hoist it to `lib/scene/`.
- `cameraActivity` and `cameraReadout` are display-only singletons (per-frame writes / `performance.now`),
  NOT scene-state input — they don't touch the determinism contract (same basis as the FPS meter).
- Control glyphs are real SVG files in `public/controls/` (loaded via `<img>` + `asset()` for basePath)
  precisely so they can be edited/replaced in Figma without code changes.
