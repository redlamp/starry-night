# Test Plan - 2026-07-26 - Touch Input Flip

Branch: `feat/touch-flip` (off fable), uncommitted pending your phone test.
User ask: mirror the mouse mapping on mobile.

New mapping (Cam v3), revised same-session per Taylor's Google Earth
comparison + "mitigate too much overlap of inputs":

- 1 finger = Move (the mouse LMB ground pan; synthesized picks + speed cap).
- A 2-finger gesture LATCHES to exactly ONE mode - the first motion past its
  threshold owns the whole gesture, the rest are ignored until fingers lift:
  - swipe left-right = Orbit (yaw around the midpoint's ground point)
  - swipe up-down = Tilt
  - twist = Rotate, city turns with the fingers, pivot between them
    (RETIRED 2026-07-27 - see the Known / Parked note)
  - pinch = Zoom toward the pinch centre
- Double-taps mirror the mouse's double-clicks (2026-07-27): 1-finger = PAN TO
  the tapped ground point, 2-finger = the ZOOM-IN glide at the midpoint.
- Two fingers never select (new multi-touch gate): touch fires a pointer pair
  per finger, so a 2-finger tap used to select the road/building under a
  fingertip and its card's framing fought the camera gesture.
- Mouse and touch share the same orbit code (clamps, tilt floor, skyline
  entry decoupling - all of it).

Thresholds (the latch): 18px of midpoint travel (swipe), 24px of spread
change (pinch), ~10 deg of twist. Probe (scratch/touchFlipProbe.ts, all
PASS): pan holds azimuth; swipe-LR moves azimuth with elevation held;
swipe-UD moves elevation with azimuth held; clockwise twist turns the city
clockwise (north bearing +40 over a 48-deg twist - the threshold eats the
start); pinch zooms with azimuth AND elevation held.

1. [ ] 1-finger drag moves the city under your finger (both projections; sky
   pixels included)
2. [ ] Each 2-finger gesture does ONE thing: swipe LR orbits, swipe UD
   tilts, pinch zooms - and never bleeds into another (twist retired)
3. [ ] The latch thresholds feel right (not too eager, not laggy) - flag
   which gesture misclassifies if any
4. [x] ~~Twist rotation pivots between your fingers and follows them~~ -
   twist removed 2026-07-27
5. [ ] Lift one finger of two: the remaining finger moves (no jump)
6. [ ] 1-finger double-tap PANS TO the tapped point (distance unchanged);
   2-finger double-tap ZOOMS IN on the midpoint, in inspect mode too
6b. [ ] A 2-finger tap selects nothing (no card opens, no camera re-framing)
6c. [ ] A 1-finger tap still selects a building / street in inspect mode
6d. [ ] Skyline entry via 2-finger tilt-up
7. [ ] Controls guide (touch tab): Move / Orbit / Tilt / Zoom rows, and a
   latched 2-finger swipe lights ONLY its row (Orbit or Tilt, not both)

## Known / Parked

- Twist-rotate REMOVED 2026-07-27 (user): a twist always begins as a small
  swipe, so it stole orbit/tilt gestures for too little gain. Two fingers now
  latch to orbit / tilt / zoom only. Orbit and Tilt also mark DIFFERENT
  activity actions ("rotate" / "tilt") so the guide highlights one row instead
  of both. Probe scratch/touchNoTwistProbe.ts: 4/4 PASS (60-degree twist moves
  nothing; LR marks rotate; UD marks tilt; pinch still zooms).
- Double-taps remapped 2026-07-27 to mirror the mouse: 1-finger = pan to,
  2-finger = zoom in. The 1-finger one keeps the inspect-mode stand-down (there
  a double-tap is the building-focus gesture); the 2-finger one has no such
  conflict and works in both modes. Probe scratch/touchDoubleTapProbe.ts: 6/6
  PASS (pan-to moves the focus 463m at held radius; 2-finger x2 zooms 2765 ->
  1660; single taps of either kind do nothing; inspect-mode zoom leaves the
  column stack alone; a 1-finger tap still picks a building).
- v2 model keeps its old native touch mapping (fallback only).
- Round-2 mobile item (2-finger pan speed cap) is now the 1-finger pan cap -
  same code path; verify while you're on the phone.
