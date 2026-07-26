# Test Plan - 2026-07-26 - Skyline Entry (Option A Seam Ironing)

Branch: `feat/skyline-entry` (off fable, post round-3 push). Decision context:
staying on Option A of [[skyline-seam-handling]] for now and ironing its
seams. Threshold reference table lives in the 2026-07-26 review conversation
and [[test-plan-2026-07-26-camera-round-3]]; band numbers unchanged (enter
0.58 deg / exit 0.84 deg at the default city).

Probe evidence (scratch/skylineEntryProbe.ts, PASS): from a camera 2.5m off
the ground with a close pivot - the exact stall case - a sustained RMB
tilt-up drag reaches level within ~60px, the eye rides the 1m floor (never
below), and skyline latches on release. Feel is your gate.

## 1. Entry from anywhere (the "some areas are hard" fix)

Root cause: RMB tilt rotates the rig about the clicked ground pivot, and the
ground guard REJECTED any step whose arc would sink the eye below the 1m
floor - so with a near/low pivot the drag stalled a fraction of a degree
above the band. The guard now decouples: when the arc bottoms out, the eye
holds at the floor and the same pitch applies to the AIM in place, so the
drag keeps tilting at the same rate - it just stops descending.

1. [ ] Zoom in low over the city, RMB on ground right under you, drag up
   hard: the view keeps tilting to level (no stall), enters skyline on
   release
2. [ ] Same low pose: tilt DOWN still orbits normally around the pivot
   (the guard only changes the bottomed-out direction)
3. [ ] High vantage entry unchanged: drag up, pitch pins at level, release
   -> skyline
4. [ ] The floor-riding moment feels like "standing at street level looking
   up", not like the camera fighting you

## 2. 3-degree band trial (Taylor, same session)

Band widened to a fixed enter <= 3.0 deg / exit > 3.5 deg (was the dynamic
0.58/0.84). The default pose (~1.06 deg) now rests INSIDE skyline mode - R
and page load land in skyline, vertical LMB pedestals there. Probe: rest in
skyline; 5 deg standard; 2.9 enters; 3.3 holds; 4 exits.

1. [ ] Load / R: skyline mode (chip + diagram say so); vertical LMB
   pedestals, horizontal trucks
2. [ ] Tilt to ~5 deg: standard mode, normal ground pan
3. [ ] The band is now big enough to work in without instruments
4. [ ] Does default-lands-in-skyline feel right, or should the default pose
   tilt to ~4-5 deg so it lands standard?

## 3. Aerial rename + quiet chip + controls + settings (same session)

- "Standard View" is now "Aerial View"; aerial takes the sky-blue color
  (chip + diagram label), skyline stays amber.
- Chip is quiet on load (4s grace - the default pose rests in the band, so
  boot always "changes" into skyline) and while the HUD is idle-faded.
  Answer to the drift question: YES, drift can cross the band (its elevation
  floor is 3 deg minus up to 2.5 deg of bob), so the idle tie matters.
- Controls guide: in skyline the Move rows read "Move / Pedestal" with a
  vertical = raise/lower sub, live while the panel is open.
- Drift is its own settings section (icon: helicopter) with the transport
  switch in its header; idle drift + delay show for Cam v3, Elev mean only
  for the Drift model. Orbit no longer contains drift anything.
- RMB pivot pin: faint (0.2) on press, solid on real drag - double-clicks no
  longer pop a full pin.

1. [ ] Load: no chip; first manual regime change shows it (blue Aerial /
   amber Skyline)
2. [ ] Idle drift crossing the band: no chip while the HUD is faded
3. [ ] Controls guide rows flip with the regime
4. [ ] Settings: Drift section present, Orbit clean; search finds "wander"
   under Drift
5. [ ] RMB click: pin barely visible; drag: solid

## 4. What was deliberately NOT added (info)

- No entry detent/assist: with the stall fixed, the tilt floor already IS
  the assist - dragging up hard pins the pitch at 0 deg (inside the band)
  from anywhere, so extra magic would just add un-asked-for motion.
- Remaining knob if R still feels too close to the band: drop the exit
  threshold from 80% to 70% of the default pose (0.84 -> 0.74 deg; default
  sits 0.32 deg clear instead of 0.21). Say the word.

## Known / Parked

- The in-place pitch means a bottomed-out tilt-up no longer keeps the pivot
  pinned under the cursor (the eye stops following the arc) - inherent to
  the decoupling; flag if it reads wrong.
- Option B (explicit Skyline mode) remains the documented alternative on #98
  if Option A's ironing still doesn't feel right.
