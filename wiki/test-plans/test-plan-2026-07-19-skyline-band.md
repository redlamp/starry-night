# Test Plan - 2026-07-19 - Skyline Band + Compass Tilt + Pan Anywhere

Branch: `feat/camera-feel` (continues the camera-feel round). From the skyline
plan agreed 2026-07-19, plus two live-testing reports (ortho dead zones,
compass 3D tilt). Origin: [[2026-07-18-andy-zawadzki-playtest]] (camera-feel
thread) - see also [[test-plan-2026-07-19-camera-feel]].

Probe evidence (scratch/skylineProbe.ts, scratch/skyPanDebug.ts): tilt sweeps
land exactly (1.5/1.0/0.5/0 deg in both projections); vertical-drag semantics
flip to the skyline reframe only below 1.0 deg, HOLD at 1.3 deg (hysteresis),
release above 1.5 deg; sky-pixel pans move the center from every tested
position in both projections. Feel is your gate.

## 1. Skyline band (enter 1.0 deg, exit 1.5 deg - below the 2 deg default)

1. [ ] R-reset: the default pose no longer flickers gesture behavior (it used
   to sit exactly ON the old 2 deg threshold)
2. [ ] Tilt down slowly (RMB drag / Tilt slider): skyline reframe engages just
   under 1 deg - vertical LMB drag pedestals the rig instead of ground-panning
3. [ ] Tilt back up: skyline holds until ~1.5 deg then releases - no rapid
   in/out flip when hovering near the boundary
4. [ ] Perspective: you can settle the camera anywhere in 0-1 deg (the
   "skyline view" Andy needed a not-obvious mode for)
5. [ ] Ortho: same band, same reframe (Screen-Y lens shift), same hysteresis

## 2. Pan anywhere (ortho dead zones)

1. [ ] Ortho: LMB drag engages from every part of the screen - sky above the
   towers included (was: unclickable regions)
2. [ ] Perspective: same - drags starting on sky pixels pan the city
3. [ ] Known edge: when the focal point is pinned at the city-disc rim,
   panning further outward stops by design (the "snow globe" edge)

## 3. Compass 3D tilt

1. [ ] Outside skyline mode, the compass rose lies on the city's ground plane -
   it foreshortens with your look-down angle (clamped so it stays legible)
   and the red needle still points at true north within that plane
2. [ ] In top-down it reads face-on (flat), as before
3. [ ] In skyline mode it stays flat (no tilt), per spec
4. [ ] Off/Auto/On setting still behaves (Settings - Orbit)
5. [ ] No snap while tilting: the rose's 3D tilt EASES (~200ms) through the
   skyline flip and everywhere else; the heading itself stays frame-locked
6. [ ] Position: parked left of the drift/settings buttons at top-right; when
   the settings drawer opens it slides to the drawer's left edge
7. [ ] The ring border tilts with the needle as one disc - the foreshortened
   ellipse is what sells the plane orientation

## Known / Parked

- Sky-pixel pan sensitivity scales with the synthesized pick's city-center
  depth - drags high on the screen move farther per pixel. Flag if it feels
  wrong; a screen-Y falloff is an easy follow-up.
- v2 model: still the old LMB/RMB mapping and no skyline hysteresis.
