---
tags:
  - domain/camera
  - status/open
  - origin/external-research
---

# Skyline Seam Handling

How other products handle the transition from overhead map-style navigation to
ground-level / horizon-level viewing, and a concrete proposal for our own seam.
Decision lands on GitHub issue
[#98 - skyline regime ergonomics](https://github.com/redlamp/starry-night/issues/98).
Background: [[test-plan-2026-07-19-skyline-band]],
[[test-plan-2026-07-25-camera-round-2]], [[camera-movement-terminology]].
The skyline-view concept itself is Taylor's (it predates the
[[2026-07-18-andy-zawadzki-playtest]]; that session only stress-tested the controls).

## 1. The Problem

Cam v3 (`components/scene/camera-models/StarryNightV3Model.tsx`) is one
continuous orbit camera over the city disc, perspective or faked-ortho. When
the look-down elevation approaches zero - viewing the city edge-on like an
architectural elevation, "skyline view" - two things change as a REGIME, a
hysteresis-latched boolean derived from camera angle (`isSkylineMode`; enter =
55% and exit = 80% of the default pose elevation, so at the default city enter
is ~0.58 deg and exit ~0.85 deg; the latch freezes for the duration of any drag
via `skylineHold`):

1. **Ground picking degenerates.** A near-parallel ray hits the ground plane
   kilometres away or not at all, so `groundHit` synthesizes picks at the
   city-centre depth under the cursor.
2. **Vertical drag semantics swap.** Normally vertical LMB-drag ground-pans
   (trucks) the city; in skyline view it pedestals the rig (perspective) or
   lens-shifts the frame via a focal offset (ortho `skylineScreenY`), because
   "grab the ground" is meaningless edge-on.

After three rounds of tuning (single 2 deg threshold, then a fixed 1.0/1.5 deg
hysteresis pair, then the pose-derived dynamic band), Taylor's verdict: "The
seam continues to confound me, and never feels quite right." The specific pains:

- The band is hair-trigger and too technical to test - entry and exit differ by
  fractions of a degree; verifying it needs a probe script, not a human.
- An implicit mode that swaps what the same gesture does keeps surprising
  users, even with the live "Skyline View / Standard View" diagram label and
  the transient view-mode chip.
- Mid-drag the regime is frozen (correctly - semantics must not flip under the
  cursor), so changing behaviour requires release + re-press.
- The ortho transition also carries a framing animation (the eased lens shift
  toward `skylineScreenY`), which reads as the camera doing something unasked.

Structurally, the band cannot be widened much: its ceiling is the default pose
elevation itself (~1.06 deg for DEFAULT_INTENT), and crop-follow city shapes
shrink it further (enter floors at 0.1 deg). Option A below inherits that
ceiling.

## 2. How Other Products Handle the Analogous Transition

### Google Earth - explicit ground-level mode

Google Earth treats ground-level viewing as an EXPLICIT mode with a ceremony:
you drag Pegman onto the map (or zoom fully in), a transition animation plays,
the control scheme changes (arrow keys walk/look rather than pan the map), and
a dedicated "Exit ground-level view" button appears in the top-right corner
([Google Earth Help](https://support.google.com/earth/answer/1067429?hl=en),
[Google Earth Blog on GE6's ground-level view](https://www.gearthblog.com/blog/archives/2010/11/thoughts_on_google_earth_6.html)).
The mode boundary is a user action plus an animation plus a persistent exit
affordance - never a silent angle threshold.

Instructive counterpoint: GE's one CONTINUOUS angle behaviour, the auto-tilt
"swoop" while zooming in, annoyed users enough that it ships with a "Do not
automatically tilt while zooming" preference and a `U` key to square the view
back up ([Google Earth Blog](https://www.gearthblog.com/blog/archives/2013/09/google-earth-keep-tilting-view-zoom.html)).
Camera behaviour that changes by itself as a side effect of another gesture is
exactly the part users turn off.

### Cesium - tuned constants, plus one gesture-derived trick

CesiumJS never swaps drag semantics by angle. Instead
[ScreenSpaceCameraController](https://cesium.com/learn/ion-sdk/ref-doc/ScreenSpaceCameraController.html)
keeps the mapping fixed (left = pan, middle = tilt, right/wheel = zoom; see the
[camera tutorial](https://cesium.com/learn/cesiumjs-learn/cesiumjs-camera/)) and
handles the degenerate cases with height-keyed constants: `minimumZoomDistance`
and `enableCollisionDetection` stop the camera reaching the ground at all;
`minimumPickingTerrainHeight` switches the pick model (ellipsoid vs terrain) by
camera height, invisibly - like our synthesized picks; `maximumTiltAngle`
optionally caps tilt short of the horizon. The one place behaviour DOES depend
on where the gesture lands is `minimumTrackBallHeight`: below it, a drag that
originates "on the sky or in space" becomes free-look instead of trackball
rotation - a gesture-derived split (see candidate E), and notably a spot where
Cesium accepts pick-origin ambiguity rather than an angle regime.

### Mapbox GL JS / MapLibre - refuse the regime entirely

Mapbox capped pitch at 60 deg for years and, when
[users asked for more](https://github.com/mapbox/mapbox-gl-js/issues/3731),
raised it only to a configurable 85 deg
([PR #8834](https://github.com/mapbox/mapbox-gl-js/pull/8834)) - never 90. The
reasons are exactly our seam in disguise: at horizon-level pitch the visible
tile set explodes toward infinity
([issue #10253 on shifting the horizon](https://github.com/mapbox/mapbox-gl-js/issues/10253)),
and the native SDK even proposed max pitch varying by zoom because low-altitude
horizon views break the projection's assumptions
([mapbox-gl-native #6908](https://github.com/mapbox/mapbox-gl-native/issues/6908)).
Drag-pan keeps ground-anchored semantics all the way up to 85 deg; the products
simply never let the ray go parallel. Lesson: the degenerate band is a known
tar pit, and the cheapest handling is to keep a floor between the camera and it
unless edge-on viewing is a product goal (for us it is - the skyline IS the
screensaver's money shot).

### Game cameras - explicit modes with distinct affordances

- **Cities: Skylines**: the overhead free camera never morphs into a
  street-level one; ground-level viewing is a separate first-person camera mode
  behind a hotkey toggle, both in the
  [classic First Person Camera mod](https://steamcommunity.com/sharedfiles/filedetails/?id=2764243667)
  (backtick toggle) and the
  [CS2 FirstPersonCamera mod](https://github.com/Cities2Modding/FirstPersonCamera)
  (Ctrl+F toggle).
- **MSFS drone cam**: Insert toggles the drone camera on and off; inside the
  mode, translate and rotate are separately bound control sets
  ([MSFS camera FAQ](https://flightsimulator.zendesk.com/hc/en-us/articles/360016003159-Camera-Video-FAQ),
  [control walkthrough](https://flightsimnavigation.wordpress.com/2021/05/11/39-microsoft-flight-simulator-04-drone-camera-control/)).
- **Blender**: orbit navigation and Walk/Fly are explicitly separate modes
  (Shift+Backtick to enter; Esc/click to exit), with the manual pitching
  Walk/Fly precisely for the case orbiting handles badly - moving through large
  environments at eye level
  ([Blender manual, Fly/Walk Navigation](https://docs.blender.org/manual/en/latest/editors/3dview/navigate/walk_fly.html)).

Across the genre the pattern is uniform: overhead-to-ground transitions are
explicit, toggled, announced, and reversible via the same affordance. None of
these products flips gesture meaning on a derived camera angle.

### Interaction-design principles

- **Modes cause errors.** Raskin's core claim in The Humane Interface: a mode
  error happens when the user misclassifies the current state and the same
  gesture does something unexpected; modes should be eliminated, or made
  glaringly visible ([Raskin Center summary](https://raskincenter.org/jef/humane-interface/),
  [Mode (user interface), Wikipedia](https://en.wikipedia.org/wiki/Mode_(user_interface))).
  Our regime is a textbook implicit mode: the classifier (a fraction of a
  degree of elevation) is invisible and not user-initiated.
- **Quasimodes / spring-loaded modes** - modes held only by continuous physical
  action (Shift, a held pedal) - demonstrably do not produce mode errors,
  because the user's own muscle state carries the mode
  ([same Wikipedia article](https://en.wikipedia.org/wiki/Mode_(user_interface))).
- **Visibility of system status** (Nielsen heuristic #1): users must be able to
  tell what state the system is in from the interface itself, continuously, not
  via a transient toast ([NN/g](https://www.nngroup.com/articles/visibility-system-status/)).
  Our chip is transient and the diagram label is peripheral; a persistent
  in-mode affordance (GE's exit button) is the reference bar.

## 3. Candidate Designs

### A. Keep the angle regime, widen the ergonomics

Bigger band, a glide-in detent near zero, louder affordances.
**Predictability**: unchanged - the same invisible classifier, just softer
edges. **Discoverability**: still accidental. **Testability**: still fractions
of a degree; the band's ceiling is structurally the ~1 deg default-pose
elevation, so "bigger" barely exists. **Cost**: low. **Precedent**: none - no
surveyed product does this. This is the path already walked three times.

### B. Explicit mode: Skyline button / hotkey

A button (and hotkey) GLIDES the camera into the skyline pose and only then
swaps semantics; angle alone never swaps anything. Exit = press again, R, or
tilting up past a GENEROUS threshold (several degrees, not fractions).
**Predictability**: high - the user caused the mode. **Discoverability**: high -
a visible control names the feature (the money shot becomes an advertised
destination instead of an easter egg). **Testability**: excellent - "press K,
drag, observe pedestal; tilt up hard, observe exit chip" - no instruments.
**Cost**: moderate; mostly deletion (see Section 5). **Precedent**: Google
Earth, MSFS, Blender, Cities: Skylines - the entire survey.

### C. Continuous blend - no discrete seam

Vertical drag output = mix(ground-pan, pedestal), weight ramping 0 to 1 as
elevation falls from ~6 deg to ~1 deg; picking already blends (synthesized
fallback). **Analysis**: this dissolves the seam but breaks direct
manipulation's contract - at mid-weights the grabbed ground point no longer
stays under the cursor (part of the drag budget leaks into pedestal), which
reads as slippage, not smoothness. Ground-pan's vertical component near the
band is ALREADY a lie (the PAN_SPEED_MAX cap clips the 1/sin(elevation)
runaway, so the "grabbed" point unsticks anyway), so the blend would be mixing
two approximations. No surveyed product blends gesture SEMANTICS by angle; the
closest analogue, GE's continuous auto-tilt, is the feature users disable.
**Predictability**: mushy in the ramp. **Testability**: worse than today - now
a curve to verify, not a boolean. **Cost**: moderate. Fails the project's own "the user's live test is the
gate" bar almost by construction - a ramp cannot be felt as correct or
incorrect, only measured.

### D. Quasimode: pedestal while a modifier is held

Hold a key (say Alt) and vertical drag pedestals; release and it ground-pans.
Angle never changes semantics. **Predictability**: perfect - Raskin-clean, zero
mode errors. **Discoverability**: poor - hidden chord, and screensaver users
are the casual end of the spectrum. **Fit**: wrong shape for this feature -
skyline view is a place you STAY (it is the ambient money shot, minutes at a
time), and quasimodes suit transient actions, not destinations. Also does
nothing for entry ergonomics (reaching a ~0.6 deg pose by drag stays fiddly).
**Cost**: low. Worth keeping as a POWER-USER accelerator inside option B, not
as the spine.

### E. Gesture-derived: intent from the pick, not the angle

Vertical drags starting on sky pixels pedestal; drags starting on ground pixels
pan. No angle regime. Precedent exists - Cesium's `minimumTrackBallHeight`
free-look for drags originating on sky. **Analysis**: elegant, but it relocates
the seam from angle-space to pixel-space: near the horizon line (exactly where
skyline users operate) a few pixels decide the semantics, and the horizon is
the most cluttered, least legible part of the frame. Overhead there are no sky
pixels, so the rule degenerates gracefully - but in skyline view MOST pixels
are sky, so casual drags flip meaning by start position invisibly.
**Testability**: medium (still needs pixel-precise setups). **Cost**:
moderate - `groundHit` already knows when the true ray misses. A useful
INGREDIENT, not a spine.

## 4. Recommendation

**Option B - explicit Skyline mode - with the picking fallback left continuous,
and D as an optional later accelerator.** Every surveyed product that supports
ground-level viewing gates it behind an explicit, announced, reversible mode;
the products that refuse the mode simply cap pitch and never enter the band.
The key split the current design misses: the PICKING degeneracy is plumbing and
may stay automatic (synthesized picks change no gesture's meaning - Cesium
hides `minimumPickingTerrainHeight` the same way), but the SEMANTICS swap is a
mode and must be user-initiated. Blend (C) sacrifices the grab contract,
quasimode (D) fits transient actions not destinations, and gesture-derivation
(E) moves the ambiguity to the worst part of the frame.

## 5. Migration Sketch (StarryNightV3Model.tsx)

1. **State**: add `skylineView: boolean` to the Zustand runtime store (runtime
   tier - seed-independent, matches the two-tier rule). `isSkylineMode(cam)`
   collapses to reading it; `skylineLatch`, `skylineHold`, the enter/exit sin
   pair, and `setSkylineBandBelowPose` all retire. The per-gesture freeze
   becomes unnecessary - nothing flips mid-drag because nothing flips unasked.
2. **Enter**: a Skyline button next to the helicopter (plus a hotkey, e.g. K)
   sets the flag and glides `setLookAt` to a canonical skyline pose - current
   azimuth and distance, elevation ~0.3 deg, `skylineScreenY` reset to 0.3 -
   reusing the top-down flight's smoothTime pattern (TD_SMOOTH_TIME). The ortho
   lens shift keeps its existing ease but is now gated on the flag, so the
   framing animation only ever plays as part of the ceremony the user invoked.
3. **Exit**: button again, R (already clears to default), or tilting up past a
   generous threshold - single value, ~5 deg, no hysteresis needed since it is
   an exit-only trip wire on a user gesture. Exit eases the focal offset back
   to zero and re-announces via the chip.
4. **In-mode affordances**: the view-mode chip becomes PERSISTENT while the
   flag is set (Nielsen #1; GE's exit button is the model) and doubles as the
   exit control. The pan-v glyph and diagram label stay as-is.
5. **Picking**: `groundHit` swaps its `isSkylineMode` call for the same flag
   OR the existing "true ray missed" fallback - synthesized picks remain
   available continuously at grazing angles even outside the mode, which keeps
   free tilting near the horizon safe without any semantic change.
6. **Tilt floor**: the perspective Min-tilt slider and the incremental clamp
   are untouched; inside skyline mode the orbit tilt clamp can additionally
   confine elevation to roughly [-2, +5] deg so casual drags stay in the shot
   until a deliberate pull crosses the exit threshold.
7. **Tests**: [[test-plan-2026-07-25-camera-round-2]] items about band feel
   rewrite as human-verifiable steps: press K, watch the glide, check the
   chip persists, drag vertically, confirm pedestal / lens shift, yank the
   tilt up, confirm exit. No probe scripts, no fractions of a degree.

v2 model parity (old fixed 2 deg threshold) stays frozen - v2 is the untouched
fallback by design.
