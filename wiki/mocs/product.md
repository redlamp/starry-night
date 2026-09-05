# Product Map

Starry Night is a modernized homage to the After Dark "Starry Night"
screensaver: a seeded, deterministic night city rendered so it feels
inhabited, not just lit. v1 proved the still frame could carry that mood on
its own; 2.0 is about proving the city is lived in - that the lights, the
people behind them, and the way you explore both add up to a place rather
than a diorama.

Each section below links the decision notes (and a few plan notes) that
define that system, newest reasoning first where it matters. Every
`decision-*.md` note in `wiki/notes` appears exactly once.

## City generation

- [[decision-1-unit-equals-1-meter]] - world units = meters; the scale
  contract every archetype dimension derives from
- [[decision-streets-of-rage-direction]] - Streets of Rage 1991 as the
  direct visual anchor for color, shape, and layout across the whole scene
- [[decision-district-based-city-layout]] (superseded) - first pass:
  rotated districts with hardcoded bounding boxes
- [[decision-streets-first-city-generation]] (superseded) - inverted the
  axis: roads first, districts form between them
- [[decision-grid-first-city-generation]] (superseded) - coherent grid
  substrate with a center-anchored orientation field
- [[decision-tensor-field-roads]] - current model: roads as streamlines of a
  grid-basis tensor field, one promoted highway, buildings line the frontage
- [[decision-network-aligned-districts]] - districts follow the arterials
  (flood-fill with roads as walls) instead of free-floating Voronoi cells
- [[decision-sketch-tensor-field]] - a hand-drawn sketch photo becomes the
  street plan via structure-tensor recovery
- [[decision-tensor-field-morphology]] - a menu of field families (warp,
  shear, calm-grid, tamed-radial) so seeds stop reading as one dull layout
- [[decision-density-gradient-bands]] - district count and high-rise core
  scale by absolute distance, not city size, fixing the all-high-rise metro
- [[decision-density-gradient-model]] - two-layer Clark's-law density field
  driving both road gating and per-district building/lamp character
- [[decision-additive-growth-citygen]] - generate-at-max + crop: a fixed
  extent so the size slider crops instead of regenerating, unblocking scale
- [[decision-road-reveal-cascade]] (deferred) - a center-out road reveal
  animation, built and reviewed, parked as too theatrical for this project

## Buildings and windows

- [[decision-window-proportion-by-archetype]] - window size and grid pitch
  vary per building archetype instead of one global ratio
- [[decision-correlated-window-lighting]] - whole floors and segments light
  together instead of independent per-window speckle
- [[decision-facade-display-space-color]] - facade colors are authored and
  varied in display space; converting them to linear silently collapses them
  to black
- [[decision-shader-varying-precision]] - varying-interpolation rounding
  rules that killed the far-pose window dithering family
- [[decision-window-lod-headroom]] - the distance wash is reserved headroom
  for stability, not a performance feature; off by default

## Lighting and atmosphere

- [[plan-night-shift-lighting]] - draft: perpetual night reframed as "who is
  awake right now," replacing the day/night cycle the project dropped
- [[plan-light-distance-model-v2]] - draft: revisiting how window brightness
  falls off with camera distance

## Sky

- [[decision-moon-celestial-model]] - the moon parametrized as azimuth,
  elevation, and distance rather than free-floating cylinder coordinates

## Camera

- [[decision-orbit-spherical-controls]] - spherical orbit plus drag / pinch
  / wheel controls on the canvas
- [[decision-camera-model-registry]] - a pluggable registry so camera
  personalities (map, drift, ...) mount as swappable "3 Cs" models
- [[decision-perspective-skyline-reframe]] - Skyline mode moves the coupled
  eye+target rig instead of faking altitude with a lens trick
- [[decision-camera-transition-tween]] - a shortest-arc tween back to the
  previous pose, plus a size-invariant ortho/perspective blend
- [[decision-snv2-wasd]] - WASD/QE ground-relative glide over the city, with
  a global hotkey remap
- [[decision-inspect-focus-selection]] - select vs. focus as two tiers, so a
  plain click never yanks the camera
- [[decision-camera-v3-continuous-modes]] - top-down, drift, and cone-view
  framing folded into one continuous camera instead of swappable siblings

## Traffic and air

- [[decision-population-density-field]] - a census of the built city (floor
  area x occupancy) drives both the population heat map and per-segment
  traffic busyness
- [[decision-flights-live-caps]] - live plane/helicopter count sliders that
  cap a fixed seed-baked pool at render time
- [[decision-heli-spline-tours]] - helicopter flight paths as closed
  Catmull-Rom splines instead of straight lines

## Personas and directory

- [[decision-persona-architecture]] - the seeded resident layer: datasets,
  naming, a five-pass directory, and an authored-template story layer built
  for Heat Signature-style head-canon, not AI-written prose
- [[decision-entity-columns]] - Miller columns unify building, company,
  persona, street, and district detail into one progressive-disclosure drill
- [[decision-family-tree-infinite-canvas]] - the family tree chart lives on
  a pan/zoom infinite canvas instead of a scrolling container
- [[decision-listed-residents-term]] - the directory's detailed personas are
  a "listed" sample of a larger city derived from the buildings, not a census
- [[decision-interaction-modes]] (open - draft, not yet chosen) - whether the
  scene or the directory should be the primary way in, recommending
  spatial-first with the directory demoted to search

## Intro

- [[decision-intro-mac-viewport]] - the live city rendered on a modeled
  Mac's CRT via a native-resolution multi-pass pipeline, coupled to device
  orientation like a snow globe

## Quality and performance

- [[decision-prd-v1-architecture]] - the foundational stack, rendering
  strategy, state model, and performance budget everything above builds on
- [[decision-tile-cull-materialisation]] - per-tile buffer compaction keeps
  draw calls constant while lazy materialisation falls out of generate-at-max
- [[decision-debug-panel-architecture]] (superseded) - first information
  architecture for the tuning panel, replaced the same day
- [[decision-settings-sidebar-shadcn]] - the shadcn-rewired settings sidebar
  that hosts camera, quality, and scene tuning controls today

## Workflow (branching, merge styles, deploy)

- [[decision-github-pages-deploy]] - static export deploys to GitHub Pages
  on every push to `main`
- [[decision-merge-styles]] - feature branches merge to `dev` with
  `--no-ff`; `dev` promotes to `main` with `--ff-only`
- [[decision-fable-branch-model-scope]] (routing retired, see the note below)
  - the original model-scoped `fable` branch design
- [[decision-fable-branch-retired]] - `fable` frozen as history; every
  session, any model, now branches `feat/<name>` straight off `dev`
- [[decision-prd-replacement]] - the PRD's roles split across a one-page
  charter, this product map, and a GitHub 2.0 milestone
