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
   "skyline view" - Taylor's concept; the playtest only surfaced how hard the
   pose was to reach)
5. [ ] Ortho: same band, same reframe (Screen-Y lens shift), same hysteresis

## 2. Pan anywhere (ortho dead zones)

1. [x] Ortho: LMB drag engages from every part of the screen - sky above the
   towers included (was: unclickable regions)
2. [ ] Perspective: same - drags starting on sky pixels pan the city
3. [ ] Known edge: when the focal point is pinned at the city-disc rim,
   panning further outward stops by design (the "snow globe" edge)

## 3. Compass 3D tilt

1. [x] Outside skyline mode, the compass rose lies on the city's ground plane -
   it foreshortens with your look-down angle (clamped so it stays legible)
   and the red needle still points at true north within that plane
2. [x] In top-down it reads face-on (flat), as before
3. [x] In skyline mode it stays flat (no tilt), per spec
4. [x] Off/Auto/On setting still behaves (Settings - Orbit)
5. [x] No snap while tilting: the rose's 3D tilt EASES (~200ms) through the
   skyline flip and everywhere else; the heading itself stays frame-locked
6. [x] Position: parked left of the drift/settings buttons at top-right; when
   the settings drawer opens it slides to the drawer's left edge
7. [x] The ring border tilts with the needle as one disc - the foreshortened
   ellipse is what sells the plane orientation

## 4. Evening round (shipped with the day's final push)

1. [x] Compass north-up press: needle and city arrive TOGETHER (the park
   animates heading as camera roll; the needle now tracks screen-projected
   north - probe: eased -27 to -0.1 deg over ~700ms in lockstep)
2. [x] Opening the directory shows district boundaries; closing hides them;
   manually turning them off sticks (persisted) until manually re-enabled;
   a manual ON survives directory close (probe-verified state machine)
3. [x] Directory district hover: clean own-colour fill at 0.2 alpha - the
   bright white-shifted re-fill (0.8) appears ONLY with the Settings
   planning overlay on (it used to stack ungated on every hover)
4. [x] Ground Haze defaults: bottom 0 / top 120 / strength 1 (Reset or
   re-Save the fog section if a saved config carries old values)
5. [x] Company card employee rows: name + occupation on one line for nearly
   all pairs (occupation a size down, threshold 46); extremes still stack

## Known / Parked

- Reviewed 2026-07-25: sections 1-2 issues (band dead zone at the real
  default pose, mid-drag semantic seams, low-angle pan speed, ortho entry,
  compass flips) root-caused and reworked in
  [[test-plan-2026-07-25-camera-round-2]] - retest there, not here.
- Sky-pixel pan sensitivity scales with the synthesized pick's city-center
  depth - RESOLVED by the 2026-07-25 pan speed cap (round-2 plan, section 2).
- v2 model: still the old LMB/RMB mapping and no skyline hysteresis.
