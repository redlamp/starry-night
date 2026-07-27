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
  - pinch = Zoom toward the pinch centre
- Double-tap zoom unchanged. Guide touch rows list all five.
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
   tilts, twist rotates, pinch zooms - and never bleeds into another
3. [ ] The latch thresholds feel right (not too eager, not laggy) - flag
   which gesture misclassifies if any
4. [ ] Twist rotation pivots between your fingers and follows them
5. [ ] Lift one finger of two: the remaining finger moves (no jump)
6. [ ] Double-tap zoom-in unchanged; skyline entry via 2-finger tilt-up
7. [ ] Controls guide (touch tab): Move / Orbit / Tilt / Rotate(twist) /
   Zoom rows

## Known / Parked

- v2 model keeps its old native touch mapping (fallback only).
- Round-2 mobile item (2-finger pan speed cap) is now the 1-finger pan cap -
  same code path; verify while you're on the phone.
