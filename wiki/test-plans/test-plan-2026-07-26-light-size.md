# Test Plan - 2026-07-26 - Light Apparent Size (#99)

Branch: `feat/light-size` (off fable), uncommitted pending feel pass.
Research: [[light-size-vs-distance]] (external) + [[light-sprite-sizing-survey]]
(codebase map). Issue: #99.

What changed: all five point-light families (cars, streetlights, flights,
helicopters, beacons) now size through ONE shared helper
(lib/shaders/lightSize.ts). Size = worldDiameter x P[1][1] x viewH / (2w) -
derived from the live projection matrix, so it is exact in perspective, in
faked ortho, and through the whole morph. Glare gamma 0.8 softens the far
shrink; per-family pixel floors keep far spotting (the old streetlight
collapse lesson); per-family glow diameters calibrated to match the previous
look at the default framing. #52 brightness LOD + culling unchanged; the old
LOD size ramp, the traffic ortho zoom blend, and the hand-tuned 3600/180
numerators are all subsumed.

Probe evidence (scratch/lightSizeShot.ts): renders clean in both projections
at near/default/far, no shader errors. Feel is the gate - sizes are
calibrated, not yet taste-tested.

## 1. Perspective

1. [ ] Street level: car lights + streetlights read as generous glows, not
   fixed dots
2. [ ] Wheel out to whole-city: lights shrink smoothly with distance to a
   small-but-visible floor - no band where they pop or balloon
3. [ ] Planes/helicopters: bigger when they pass near; distant corridor
   traffic still spottable (4px floor)
4. [ ] Beacons: red glow shrinks 28 -> 10px over roughly 150-900m instead of
   the old constant dot

## 2. Ortho

1. [ ] Zooming in/out scales light sizes WITH the city (all families - only
   traffic used to do this)
2. [ ] Projection morph (P key): light sizes stay continuous through the
   tween - no jump at either end

## 3. Settings > Lights panel (added same session)

Live tuning, persisted (Save/Share configs carry it):

- **Glow** - global multiplier on every family's glow diameter (0.25-3, 1 =
  calibrated default).
- **Drop-off curve** - draggable cubic bezier (two amber handles) mapping
  geometric size (left = far, right = close) to displayed size; the dashed
  diagonal is pure geometry; the default bow approximates the glare feel.
  Sampled into a 16-entry shader lookup shared by all five families.
- **Floor / Ceiling** - scale each family's min/max pixel bounds (Floor 0
  lets far lights shrink away entirely).
- **Bright follow** (0-1) - brightness follows the size drop-off, so far
  lights dim as they shrink instead of sitting at full brightness on their
  pixel floor.

Probe-verified the knobs bite (screenshots: glow 3 blooms the city; floor 0
+ follow 1 fades far lights out). The curve editor's drag feel is untested -
that one needs hands.

1. [ ] Panel present (Settings > Lights, bulb icon); search finds "glow",
   "curve", "falloff"
2. [ ] Every knob changes the scene live; values survive reload (persisted)
3. [ ] Curve handles drag smoothly and the scene follows
4. [ ] Defaults reproduce the calibrated look (Glow 1 / Floor 1 / Ceiling 1 /
   Follow 0)
5. [ ] Section header's Reset (undo icon) restores just the Lights values -
   nothing else in Settings moves

## 4. Per-family constants (info)

- Glow diameters: 1.2m x aSize/uSizeScale (cars), 1.2m x uBaseSize
  (streetlights), 1.6m x size attr (flights/helis), 0.25m x uBaseSize
  (beacons = 2m). Pixel floors/ceilings unchanged per family; the panel's
  Floor/Ceiling scale them globally.
- The Performance panel's LOD "Size floor" no longer affects size (superseded);
  brightness floor + cull still live.

## Known / Parked

- Extreme zoom-out reads dimmer than before (every light at its floor is
  small AND additive coverage drops) - flag if the far city loses too much
  sparkle; the floor values are the knob.
- Stars/moon/shooting stars deliberately untouched (sky pass, not city
  lights).
