---
tags:
  - domain/lighting
  - status/open
  - origin/external-research
---

# Light Size vs Distance - How Small Emitters Read at Range

Research base for GitHub issue #99 (light-source apparent size should scale with camera
distance). External survey of how renderers, games, and flight sims size small light
sources (car lights, streetlights, aircraft strobes) on screen as the camera moves.
Companion to the internal audit [[light-sprite-sizing-survey]]; prior art in-repo:
#52 (distance attenuation + far-culling), #67 (plane lights), #89 (helicopters).

## 1. The Perceptual Model: Why Distant Lights Don't Shrink Like Geometry

A distant headlight subtends far less than a pixel (or a retinal photoreceptor). What we
actually see at night is not the source's geometric image but the optical system's
response to it:

- Spencer, Shirley, Zimmerman, Greenberg, "Physically-Based Glare Effects for Digital
  Images" (SIGGRAPH 95) models scattering in the cornea, lens, and retina plus diffraction
  in the lens fiber structure as the cause of the "bloom" and "flare lines" around bright
  points ([paper PDF](https://www.graphics.cornell.edu/pubs/1995/SSZG95.pdf),
  [ACM entry](https://dl.acm.org/doi/10.1145/218380.218466)). The glare point spread
  function (PSF) is a fixed angular profile of the eye - it does not depend on the
  source's size at all.
- Because the PSF is fixed in angle, the visible glow disc extends to wherever scattered
  light still beats the dark surround. Its radius is driven by irradiance at the eye
  (which falls as 1/d^2) filtered through a shallow power-law PSF skirt - so the glow
  shrinks with distance much more slowly than the geometric 1/d image would, and over a
  wide band a bright point reads as a near-constant-size disc that mostly dims. Human
  straylight literature quantifies this fixed angular spread
  ([glare spread function](https://mccannimaging.com/Glare_in_Vision/Human_Glare_Spread_Function.html),
  [intraocular scattering and skyglow](https://arxiv.org/pdf/2212.09103),
  [straylight measurement review](https://www.sciencedirect.com/science/article/pii/S0939388912001420)).
- Jensen, Durand, Dorsey, Stark, Shirley, Premoze, "A Physically-Based Night Sky Model"
  (SIGGRAPH 2001) applies the same idea to stars: they are subpixel, so they are rendered
  by splatting a flux-scaled PSF, not by projecting geometry
  ([project page](http://graphics.stanford.edu/~henrik/papers/nightsky/),
  [ACM entry](https://dl.acm.org/doi/10.1145/383259.383306)). Same physics as
  [[star-twinkle-scintillation]].

Target behaviour this implies: near = generous glow that grows quickly as you approach;
mid = slow shrink (slower than 1/d); far = clamp at a legible minimum size and let
brightness carry the remaining falloff (which #52's attenuation already does).

## 2. Standard Real-Time Techniques

### Point sprites with attenuation and clamps

- Three.js `PointsMaterial.size` with `sizeAttenuation: true` scales by `scale / -mvPosition.z`
  (half the drawing-buffer height over view-space depth) - pure 1/depth, and notably it
  ignores FOV ([docs](https://threejs.org/docs/#api/en/materials/PointsMaterial.size),
  [issue #12150](https://github.com/mrdoob/three.js/issues/12150)). With
  `sizeAttenuation: false` points are constant pixels.
- Unclamped 1/depth makes points vanish below one pixel on zoom-out; the standard fix is
  a custom shader with a floor
  ([three.js forum: vanishing points on zoom-out](https://discourse.threejs.org/t/pointsmaterial-how-do-i-prevent-vanishing-points-on-zoom-out/9776)).
- Fixed-function OpenGL had this baked in: `derivedSize = clamp(size * sqrt(1/(a + b*d + c*d^2)))`
  with `GL_POINT_DISTANCE_ATTENUATION` coefficients and a clamped output range
  ([OpenGL point parameters](https://web.mit.edu/cfox/share/ghc-6.6.1/html/libraries/OpenGL/Graphics-Rendering-OpenGL-GL-Points.html)) -
  a tunable distance polynomial between a floor and a ceiling, i.e. the same shape as
  `clamp(k/d, min, max)`.
- Hardware caps `gl_PointSize` (`ALIASED_POINT_SIZE_RANGE`), and large points clip when
  their center leaves the frustum - keep ceilings modest or promote huge near lights to
  quads ([webgl2fundamentals on gl_PointSize limits](https://webgl2fundamentals.org/webgl/lessons/webgl-qna-working-around-gl_pointsize-limitations-webgl.html)).

### Screen-space bloom vs per-sprite glow cards

Post-process bloom only spreads what survives rasterization: a subpixel emitter aliases in
and out per frame and the bloom chain amplifies it into firefly flicker; fixes are heavy
(TAA, median prefilters, temporal accumulation)
([GameDev.net: bloom flickering](https://www.gamedev.net/forums/topic/673136-bloom-flickering/),
[bloom overview](https://grokipedia.com/page/Bloom_(shader_effect))). Per-sprite glow
cards (a camera-facing disc with an authored radial falloff) guarantee a minimum raster
footprint, so they are stable at any distance - which is why light-point systems in sims
use them instead of relying on bloom.

### Flight sims and driving games: light billboards

- X-Plane draws camera-facing textured billboards for the glare/glow around every light
  source; scenery and aircraft lights are "named lights" or "custom lights" with
  configurable RGBA, size, and texture parameters
  ([Custom Lighting Billboards](https://developer.x-plane.com/article/custom-lighting-billboards/),
  [Billboard and Spill Lights for OBJs](https://developer.x-plane.com/article/billboard-and-spill-lights-for-objs/),
  [light param catalogue](https://github.com/X-Plane/XPlane2Blender/blob/master/io_xplane2blender/resources/lights.txt)).
  Billboard size and persistence at range are tuned per light type, and the whole system
  was rebuilt around photometric levels in v10
  ([Light Levels: Don't Panic](https://developer.x-plane.com/2011/01/light-levels-dont-panic/),
  [aircraft lighting](https://developer.x-plane.com/article/exterior-aircraft-lighting-in-x-plane-9/)).
- MSFS is the cautionary tale: its light LOD culls emissive lights around 1 km even when
  the real fixture is visible for 11 km, and scenery devs resort to attaching invisible
  geometry to force longer render distances
  ([FSDeveloper: render distance](https://www.fsdeveloper.com/forum/threads/mcx-adjusted-emittive-lights-render-distance.460027/),
  [FSDeveloper: revisiting MSFS lights](https://www.fsdeveloper.com/forum/threads/revisiting-msfs-lights-after-a-few-years.456790/)).
  Culling or shrinking lights too aggressively destroys the "city visible from miles away"
  read - exactly the failure #52 already hit once (1/d with no floor collapsed
  streetlights at city range, see [[light-sprite-sizing-survey]]).
- Driving games use the same pattern at a smaller scale: distance-banded sprite scaling -
  headlight/taillight glow cards whose scale and intensity step or lerp across distance
  bands, with a floor so distant traffic stays a legible moving dot.

## 3. The Orthographic Case

Ortho projection has no perspective foreshortening, so eye distance is useless as a size
key; apparent size must key off the view volume height instead. Precedent:

- Map viewers express marker size in pixels anchored to zoom: deck.gl's OrthographicView
  and zoom-based scaling (one zoom step = 2x scale)
  ([deck.gl MapView/zoom](https://deck.gl/docs/api-reference/core/map-view),
  [orthographic view](https://github.com/visgl/deck.gl/blob/v9.0.0-beta.4/docs/api-reference/core/orthographic-view.md)).
- Engines expose the same knob as ortho size/zoom: Bevy's projection-zoom example scales
  the view volume ([Bevy projection zoom](https://bevy.org/examples/camera/projection-zoom/)),
  libGDX's OrthographicCamera zoom ([libGDX wiki](https://libgdx.com/wiki/graphics/2d/orthographic-camera)),
  Unity ortho tips ([blog](https://thinkinginsideadifferentbox.wordpress.com/2020/09/27/orthographic_camera_tips_for_unity3d/)).
  CAD/RTS icons and handles divide by zoom to hold constant screen size.

Unifying frame: apparent pixel size = worldGlowDiameter * viewportHeight /
frustumHeightAtLight. In perspective the frustum height at depth d is `2 * d * tan(fov/2)`;
in ortho it is just `orthoSize`. So `k / distance` and `k' / orthoSize` are the same
formula with a different frustum-height term - which is exactly the seam our
ProjectionBlender morph needs to cross smoothly.

## 4. Recommendation for This Project (#99)

One shared GLSL helper consumed by all five point shaders (`Streetlights.tsx`,
`lib/shaders/traffic.ts`, `lib/shaders/flights.ts`, `lib/shaders/helicopters.ts`,
`Beacons.tsx`), replacing the hand-tuned magic numerators (3600 / 300 / 180):

- **Derive size from the projection matrix itself.** Because ProjectionBlender writes the
  blended matrix into `camera.projectionMatrix`, the built-in `projectionMatrix` uniform
  already encodes the morph: `sizePx = worldDiameter * projectionMatrix[1][1] * uViewportHeight / (2.0 * gl_Position.w)`.
  Check: perspective gives `P[1][1] = cot(fov/2)`, `w = depth`, reproducing
  `D * H / (2 d tan(fov/2))`; ortho gives `P[1][1] = 2/orthoSize`, `w = 1`, reproducing
  `D * H / orthoSize`. No `uOrthoT` branching, and the projection morph is continuous for
  free. (Fallback if the matrix route fights instancing: `frustumH = mix(2.0 * dist * uTanHalfFov, uOrthoSize, uProjectionBlend)`.)
- **Clamp, then soften.** `gl_PointSize = clamp(sizePx, uMinPx, uMaxPx) * uDPR` - the floor
  is the anti-collapse guard (Section 2), the ceiling caps near-camera overdraw. To honor
  the perceptual model's slower-than-1/d shrink, optionally compress with an exponent:
  `sizePx = refPx * pow(refFrustumH / frustumH, uGamma)` with gamma around 0.6-0.8.
- **Tuning knobs:** per-family `worldDiameter` (headlight vs strobe vs streetlight halo vs
  beacon), shared `minPx` / `maxPx` / `gamma`. Keep #52's intensity attenuation separate:
  brightness keeps fading below the size floor so lights exit gracefully instead of
  popping (the [[decision-flights-live-caps]] lesson - cap intensity, not size, at the floor).
- **Pitfalls:** multiply final size by DPR only once (gl_PointSize is device pixels; every
  current shader does this - keep it in the helper); fade intensity to zero before any
  far-cull or LOD bound so nothing pops; large points clip at screen edges - keep `maxPx`
  modest; additive blending of many maxed near sprites can white-out, so pair the ceiling
  with a near intensity rolloff; do not remove the floor and lean on bloom (subpixel
  firefly flicker, Section 2).
- **Determinism:** size is a render-time pure function of camera uniforms and per-light
  seeded attributes - no scene-state impact, contract untouched.

Verification per [[light-sprite-sizing-survey]]: wheel-zoom sweep street level to
whole-city in both projections and through the morph; the user's live feel test is the gate.
