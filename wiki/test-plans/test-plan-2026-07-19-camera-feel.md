# Test Plan - 2026-07-19 - Camera Feel (Playtest Round 1)

Branch: `feat/camera-feel` (off fable, not merged). From
[[2026-07-18-andy-zawadzki-playtest]] Tier 1 items 1-2 plus the user's
shift+double-click variant of item 3. Cam v3 only - v2 keeps the old mapping
(its guide still matches). Functional mapping probe-verified
(scratch/cameraProbe.ts: pan/rotate/focus-pan/zoom all assert against the
orbit store); FEEL is your gate.

1. [ ] LMB drag = Move (pan); RMB drag = Rotate & Tilt; Shift+LMB still
   rotates (keyboard mirror)
2. [ ] Ctrl/Cmd+LMB free-look and the LMB+RMB chord unchanged
3. [ ] Orbit pivot pin appears the moment RMB is pressed (before any
   movement); disappears on release
4. [ ] Plain click / double-click never flashes the pan hand glyph (it's
   deferred to a real drag, like the old pin deferral)
5. [ ] Double-click = zoom in toward the point (unchanged)
6. [ ] Shift+double-click = camera keeps its orientation and distance and
   tweens over so the clicked point becomes the focus
7. [ ] Controls guide (bottom overlay) reads correctly: LMB Move, RMB
   Rotate & Tilt ("or Shift + LMB"), new "Pan To - Shift + double-click" row
8. [ ] Touch unchanged: 1-finger rotate, 2-finger pan/pinch, double-tap zoom
9. [ ] Inspect mode: double-click still focuses buildings (no zoom fight);
   cone/inspect orbit pivot behavior unchanged

## Known / Parked

- v2 model keeps LMB-rotate; swap it there too if v3 feels right.
- `?probe=1` now exposes `__sceneStore` on the interactive page (capture mode
  parks the camera, so gesture probes couldn't use it) - verification-only
  affordance.
- Remaining playtest tiers (issues to file) still under discussion - see
  [[2026-07-18-andy-zawadzki-playtest]].
