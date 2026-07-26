# Test Plan - 2026-07-26 - Camera Round 3 (Live Regime Display + Ortho Framing + Compass HUD)

Branch: `fable`. Response to Taylor's 2026-07-26 review of
[[test-plan-2026-07-25-camera-round-2]] (items 1.*, 1.4/1.6, 3.*/3.**,
4.*/4.**). The big 1.* ask - a researched proposal for the standard/skyline
seam itself - is [[skyline-seam-handling]] (recommendation: an explicit
Skyline mode; decision lands on issue #98).

Probe evidence (scratch/round3Probe.ts, scratch/diagramShot.ts, all PASS):
holding an RMB tilt through the band flips the published regime MID-DRAG
(sky=false -> true while the button is still down) while gesture semantics
stay frozen; entering ortho skyline now has 0.0m frame drift (the old preset
lens tween auto-dropped the frame); diagram screenshots confirm the
under-ground slab draws ghost-faint. Feel is your gate.

## 1. Live regime display (1.4 / 1.6)

The gesture semantics still freeze for the duration of a drag (that fix
stays), but the DISPLAY no longer waits for release: a second, never-frozen
preview latch drives cameraCommand.liveSkyline, so the chip and the diagram
label flip at the moment the aim crosses the band - mid-drag included. On
release the preview and the real latch re-sync.

1. [x] RMB-tilt down through the band while HOLDING: the chip pops and the
   diagram label flips as you cross - before you release
2. [x] Same drag back up: label/chip return to standard mid-drag
3. [x] The DRAG SEMANTICS still don't change until release + re-press
   (unchanged from round 2 item 1.3)

## 2. Ortho skyline framing (3.**)

Adopt-on-entry: entering the ortho skyline regime seeds the Screen-Y from
wherever the frame already sits, so entry is MOTIONLESS - no auto-drop toward
a preset. Your vertical drag (the lens-shift pedestal) is the only thing that
moves the frame inside skyline. Leaving skyline still releases the shift back
to a centred frame, but gently (~1s ease instead of the old fast lurch).

1. [x] Ortho, tilt down into skyline: NO vertical frame motion at the flip
2. [x] Vertical drag inside ortho skyline: full-range reframe, in your control
3. [x] Tilt back out: the frame settles back gently - flag if even this
   release should stay put instead

## 3. Side-view diagram in ortho (3.*)

The frustum now clips at the ground line: the part of the sensor aimed below
the ground plane draws ghost-faint and dashed (it sees only void). A
near-level ortho slab used to render as a giant solid box punching under the
city. The "skyline view / standard view" label from round 2 remains.

1. [x] Ortho near-level: the under-ground half of the slab reads as absence
   (faint + dashed), not a solid box
2. [x] Perspective: cone unchanged above ground; only a below-ground wedge
   fades
3. [x] ~~Known: lens shift skews the derived elevation~~ FIXED same session
   (Taylor: "this bothers me"): the readout now derives elevation from the
   camera's TRUE view direction (live rotation), not the eye-to-target
   segment. In ortho skyline the diagram reads 0 deg with a LEVEL slab, the
   ground clip shows the real below-ground sensor fraction, and pedestal
   drags draw as the frame RISING on a level axis (probe: cam height 170 ->
   373 at 0 deg, slab riding up, focal pinned at its ground point)

4. [ ] Re-test 3.3: ortho skyline + pedestal drag - the side view holds a
   level (0 deg) axis and the frame/slab rides up and down with your drag;
   the below-ground portion reads true

## 4. Compass as a HUD button (4.* / 4.**, revised same-session)

The rose is now a size-11 button sitting BETWEEN the drift and settings
buttons in the top-right row (same chrome, same idle fade); drawer open parks
it at the drawer's left edge. The Off/Auto/On setting is BACK with new
semantics (revised per Taylor mid-round): On = always visible, Auto = tied to
the HUD chrome (shows with the buttons, fades with them on idle), Off =
hidden (the row closes up). Tilt legibility: the rose's 3D tilt is
proportional up to 40 deg of look-flatness, then 40-90 compresses into 40-58,
so low elevations keep the disc readable instead of edge-on.

Numbers for your mapping value (4.**): perspective's minimum tilt is your
"Min tilt" setting (default 0 deg = level); at level the rose used to hit its
old 68 deg cap, now 58 (TILT_MAX in TopDownCompassRose.tsx; linear-to point
TILT_LINEAR_TO = 40). Give me the max-tilt number that reads right and I'll
set it.

1. [x] Row order [drift] [compass] [settings], all one size
   (screenshot-verified); Off removes the compass and the row closes up
2. [x] Auto: appears/fades exactly with its neighbours; On: stays through
   idle; setting lives in Settings > Orbit again
3. [x] At low (non-skyline) angles the rose stays legible while still
   suggesting the city plane
4. [x] Top-down + skyline behaviours unchanged (flat, needle correct);
   drawer open still parks it left of the drawer

## 5. Seam proposal (1.*, info only)

[[skyline-seam-handling]] - survey (Google Earth ground view, Cesium input
mapping, Mapbox pitch caps, MSFS/Blender/City-builder explicit modes, mode-
error UX principles) + five candidate designs. Recommendation: an EXPLICIT
Skyline mode (button/hotkey glides in, semantics swap only then, generous
tilt-up or button to leave; picking degeneracy stays automatic plumbing).
Decision is yours - lands on #98. If adopted, the band/latch machinery and
the fractions-of-a-degree test items retire.

## 6. Bottom-left HUD stack (added same session)

Performance moved from top-left to the bottom-left stack. Order bottom -> top:
Seed, side-view diagram, Performance (fps badge and/or the stats overlay -
both perf modes stack). A flex column owns the positions: any hidden element's
slot collapses and the rest slide down (screenshot-verified: hiding the
diagram drops the perf displays onto the seed).

1. [x] Stack order reads Seed / diagram / performance from the bottom up
2. [x] Toggling the diagram (Settings > Camera > diagram) or either perf
   display re-flows the stack with no gaps or overlap
3. [x] Seed hover-expand, diagram projection tap-target, and the perf
   displays all still work in place

## Known / Parked

- Attribution corrected in both earlier plans: the skyline view concept is
  Taylor's, not from the playtest (1.5).
- New issue #99: light-source apparent size should scale with camera distance
  (cars, streetlights, planes, helicopters) - filed from Taylor's question
  this session; no prior issue covered it (#52 was attenuation/culling only).
- Touch 2-finger pan cap (round 2 item 2.3) still awaiting a mobile session.
- EntityColumns (the drill cards) also dock bottom-left; with the taller HUD
  stack they could crowd each other when columns are open - flag if seen.
