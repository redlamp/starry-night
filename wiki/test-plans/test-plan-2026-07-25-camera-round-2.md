# Test Plan - 2026-07-25 - Camera Round 2 (Skyline Band Rework + Compass + Reverse Hover)

Branch: `fable`. Response to the 2026-07-25 review of
[[test-plan-2026-07-19-skyline-band]] (items 1.1/1.2/1.*, 2.*/2.**/2.3, 3.*,
4.x, Q1). Origin thread: [[2026-07-18-andy-zawadzki-playtest]]. Camera
vocabulary: [[camera-movement-terminology]].

Probe evidence (scratch/reviewProbe.ts, all PASS): default pose rests at
-1.06 deg (looking UP - the root cause below) and reads standard; band enters
at 0.2/0.3 deg, releases at 1.2 deg, R lands standard; compass bearing spread
across elevations 10 -> 0.2 deg is 0.00 deg (was: needle spins); north-up
lands 0; ortho entry levels -1.06 -> 0.00; a 120px low-angle drag moved 597m
against a ~633m cap; scene hover lit `s-downtown-18` in the directory and
cleared on close. Feel is your gate.

## 1. Skyline band rework (1.1, 1.*, 2.**)

Root cause found: the R pose (DEFAULT_INTENT) does not sit at the 2 deg the
2026-07-19 plan assumed - it rests at ~1.06 deg, looking slightly UP, INSIDE
the old fixed 1.0-1.5 deg hysteresis pair (and crop-follow shrinks it further
on wide city shapes). Any dip under 1 deg latched skyline and the pose could
never release at rest - that was "R makes LMB pedestal". The band is now
derived from the actual default pose at mount/R (enter 55%, exit 80% of the
default elevation, capped at the old 1.0/1.5), R clears the latch outright,
and the latch FREEZES for the duration of any drag so semantics cannot flip
mid-gesture (the truck/pedestal "seams" - a perspective pan can change
elevation silently when the focal pins at the rim and the eye backs out).

1. [x] Load, then R: LMB ground-pans (trucks) both times - no pedestal
   surprise, however you panned/tilted before pressing R
2. [ ] Tilt slider down: skyline engages just under ~0.6 deg (55% of your
   default pose's elevation), releases near ~0.85 deg on the way up
3. [x] Mid-drag: one LMB drag never switches truck <-> pedestal while held;
   release and re-press re-reads the regime
4. [x] Diagram (Settings > Camera > diagram): "skyline view" (amber) /
   "standard view" label under the projection label flips with the regime -
   the readable tell the narrow band needed
5. [ ] You can still settle and work anywhere in the 0-0.5 deg band
   (Taylor's skyline view - misattributed to Andy in earlier plans; corrected
   2026-07-26)

Late-round additions (Taylor's 2026-07-25 pass; the wider band unpack is
issue #98):

- 1.2's "jerk on RMB press": root-caused + fixed. The orbit tilt clamp was
  ABSOLUTE, so the default pose (looking UP 1.06 deg, floor 0) snapped to the
  floor on the FIRST move event of any RMB drag - a ~1 deg pitch jump even on
  a purely horizontal drag. Both the orbit floor and the free-look up-cap now
  clamp incrementally (a pose already past the limit may stay; it just can't
  go further). Probe (scratch/rmbJerkProbe.ts): 1.055 -> 0.000 deg jump.
- 1.5 needs defined test parameters - written into #98.

6. [x] View-mode chip (1.4 follow-up): crossing the band pops a transient
   "Skyline View" / "Standard View" chip top-center for ~2s - no diagram
   needed to notice the switch (boot never flashes it; capture mode hides it)
7. [x] RMB press-and-drag from the default pose: no pitch jerk - a horizontal
   drag stays at the same tilt, and tilting is smooth from the very first
   pixel

## 2. Pan speed at low angles (Q1)

Answer to Q1: the ground grab amplifies cursor motion by ~1/sin(elevation)
(the hit point races to the horizon), so each pan step is now capped at 3.5x
the on-screen scale - the world width a pixel covers at the focal distance -
per pixel of cursor travel. Comfortable-angle pans stay glued to the cursor
(the true delta is far below the cap); only the low-angle runaway is clipped.
Also bounds the sky-pixel pan sensitivity the 2026-07-19 plan had parked.

1. [x] At 2-6 deg tilt, vertical LMB drags move the city fast but bounded -
   no rocketing across the map
2. [x] At normal tilts (20 deg+), pan feel unchanged - grabbed point stays
   under the cursor
3. [ ] Touch 2-finger pan: same cap

## 3. Ortho entry (2.*)

The hero default AIMS ~1 deg UP at the skyline; switching to ortho kept that
upward axis, and a parallel sensor on an upward axis dips under the ground
plane ("looking up under the ground"). Entering ortho now levels the aim
(target brought down to eye height, eye stays put, tweened with the morph) -
gestures already capped ortho tilt at 0, this closes the carried-in pose
hole. The skyline reframe's default rest also dropped 0.5 -> 0.3 (city band
low in frame, sky above, instead of half the frame on under-ground void).

1. [x] From R-default, press P (or the projection toggle): the morph lands
   level - no under-ground view, city band low-ish in frame
2. [x] Ortho boot (saved ortho config + reload): same - no upward pose
3. [x] Ortho skyline vertical drag still reframes through the full range

## 4. Compass stability (3.*)

The needle bearing was a screen-space projection of world-north through the
camera quaternion - both atan2 components shrink with sin(elevation), so at
low tilts pose noise amplified into full needle spins ("north flips without
warning, worst in skyline"). It also double-compressed inside the 3D-tilted
rose at mid elevations. The bearing is now measured in the GROUND plane
(world-north against the camera's right and forward+up horizontals): stable
at every elevation, and it still degrades to the roll-tracking bearing at the
top-down pole, so the north-up park tween is unchanged.

1. [x] Skyline + near-skyline: needle steady while orbiting/panning - no
   flips or spins
2. [x] Mid elevations (rose tilted on the city plane): red needle points at
   the city's actual north at any heading - east/west headings included
3. [x] Top-down park, compass press: needle and city still arrive together
4. [x] Zoomed-out auto-show, Off/Auto/On setting: unchanged

## 5. District reverse hover (4.2/4.3 follow-up)

New: while the directory shows its districts list (All tab, empty search),
pointing at a district IN THE CITY lights it both ways - the map fill (same
hoverDistrictId path the rows use) and the list row's hover tint, scrolling
the row into view. Highlight only - rows never expand. Ground-plane pick +
district raster classify (RoadHover's approach); sky pixels and off-city
ground hover nothing, and the scene never stomps a hover the rows themselves
own (cursor over the panel = scene picking off).

1. [x] Directory open on the districts list: hover districts in the city -
   row lights + scrolls to it; moving between districts tracks
2. [x] Hovering rows in the LIST behaves exactly as before (no scroll yank,
   no flicker)
3. [x] Cursor off the city (sky / beyond the disc): no hover
4. [x] Close the directory: fill + row hover clear

## 6. Answers + notes (info only)

- 2.3 (snow-globe rim): panning outward stops because the FOCAL clamps to the
  city disc while the eye may back out to 2x the radius - that eye-backout is
  also what silently changed your elevation (now masked by the latch freeze,
  item 1.3). Options if it still feels wrong after this round: (a) rigid stop
  at the rim (ortho behavior everywhere - clearest edge, least motion), (b)
  rubber-band overshoot that springs back on release, (c) keep as-is. The
  2026-07-16 rounds rejected (a) as "stuck camera" at zoom-out; recommend
  re-judging after the latch freeze before choosing.
- Backlog sweep (user ask): no low-hanging open non-intro issues - #97
  phase 2 (cross-filtering/scope toggle) and #91 (bus routes) are real
  features, #85 is blocked on sourcing low-spec hardware, #60 is parked on
  the progressive-gen refactor; the rest are intro. The 2026-07-19 parked
  "sky-pixel pan sensitivity" item is resolved by the Section 2 cap.

## Known / Parked

- Skyline band ergonomics unpack -> issue #98 (Taylor 2026-07-25: "still a
  lot to unpack here"): 1.5 test parameters, band entry affordances, the
  angle-regime vs explicit-toggle question, crop-follow band sizing, v2
  parity. Compass (RC2) confirmed "looking much better".
- v2 model: still the old LMB/RMB mapping, fixed 2 deg skyline threshold, no
  hysteresis/freeze (fallback model only, tracked in #98).
- On very wide crop-follow shapes the derived band can get small (enter
  floors at 0.1 deg) - the diagram label is the tell; flag if entering
  skyline feels too fiddly there (tracked in #98).
- Scene district hover picks the ground THROUGH buildings (same as street
  hover) - the district under the tower you point at, not the tower's roof.
