# Research

Map of Content for external references that shape direction.

## Visual references

- [[after-dark-starry-night-original]] — YT capture of the original Berkeley Systems *After Dark* "Starry Night" Mac screensaver; the primary homage anchor (ambient behaviour + pacing)
- [[city-life-montages]] — curated montages that establish a city as a living organism beyond the main story: the GITS (1995) New Port City anchor + anime, the "city symphony" film genre (Berlin/Vertov/Koyaanisqatsi), live-action (Blade Runner, Drive), and games (Night City, Kamurocho). Maps each "aliveness" lever onto our scene
- [[cyberpunk-visual-treatment]] — glowing-translucent-cube / "hacking the Gibson" treatment ideas: Marathon login-rewards card + Hackers (1995) "City of Text" flythrough, with a feasibility sketch (fresnel rim + edge-glow + duotone in-shader; additive glow layer vs. real bloom; the InstancedMesh-transparency crux)
- [[night-sky-reference-real]] — #26 research pass: Bortle skyglow color/extent, magnitude-band star counts + 2.512× brightness law, elevation-driven twinkle, moon 21.84° halo physics, moonlit-sky behavior
- [[night-sky-reference-stylized]] — #26 research pass: the original decoded from `starryn` C source (exact constants), Outer Wilds/BotW/Firewatch/Van Gogh/Ghibli techniques, Three.js recipes (gradient dithering, fog-chunk override → #54)
- [[star-twinkle-scintillation]] — 3-agent pass on atmospheric scintillation: physics (log-normal, `(sec z)³` amplitude, few–16 Hz broadband, chromatic flash), rendering landscape (Stellarium dim-only luminance model, sum-of-sines vs noise), foundational white papers (Dravins/Osborn/Roddier; Jensen night-sky/Temporal Glare), and the target model spec. Verdict: keep the per-vertex chassis, replace the signal
- [[moon-rendering]] — 3-agent pass on the moon: lock-to-starfield bug (anchored to orbit pivot, not the star dome), phase from date (synodic/Meeus/SunCalc), lit-sphere rendering with Lommel-Seeliger (no limb darkening), NASA CGI Moon Kit albedo, earthshine, slider assessment (stale `distance`, oversized angular size), and a staged implementation plan
- [[streets-of-rage-intro]] — Sega 1991 intro screen; primary direct color/shape/layout anchor for v1 (see [[decision-streets-of-rage-direction]])
- [[map-layout-references]] — real city-plan screenshots + OSM links + figure-ground refs; the seam-street fork (SF Market St = one shared diagonal boulevard, not per-boundary lanes) for issues #33/#34

## Scale references

- [[building-sizes-real-world-references]] — real-world floor heights, window dims, archetype size bands, city framing
- [[plan-city-scale-tiers]] — scale-tier proposal for #14 (Town/District/City/Metro); recommended City (`half=1500`, 3 km across); one-knob `×k` scaling recipe + perf/LOD roadmap

## Urban planning references

- [[city-planning-references]] — real-world city plan patterns (multi-grid, diagonal arterials, organic cores, geo distortion) + GIS/OSM data options
- [[highway-network-references]] — freeway hierarchy, interchange spacing/types/footprints, ramp + curve geometry, tiered night lighting (FHWA/AASHTO/NCHRP/Caltrans/TxDOT) for #13; metric params + placement rules
- [[suburban-street-patterns]] — Southworth & Ben-Joseph pattern taxonomy (gridiron → warped parallel → loops & lollipops → lollipops on a stick) + US subdivision dimensions (cul caps, station spacing); grounds the #49 Stage-2 subdivision builder

## Generation techniques / math

- [[voronoi-diagrams]] — proximity partition behind the district shells; how the distance metric reshapes the cells
- [[taxicab-geometry]] — Manhattan (L1) / Chebyshev (L∞) vs Euclidean; rectilinear, map-like seams for the grid rework
- [[block-proportions]] — real-world block aspect ratios (1:2–1:3 downtown, 1:1.5–1:2 residential); recommended W:D bands per GRAMMAR character; how to apply in grid-first block formation (issue #33)

## Interaction / camera references

- [[camera-interaction-models]] — survey of camera/navigation models (Google Maps, Mapbox, Cesium; RTS + city-builders; Blender/Maya/Fusion/Unity/Unreal; drei `<CameraControls>` / camera-controls / OrbitControls vs MapControls) to evaluate "drag the pin to set Focal Y" + find missing angles for the drei camera bridge. Includes the open-decisions list awaiting review.
- [[camera-architecture-and-perf]] — the architecture/perf/library-internals companion to the above (2026-06-27): camera-controls + drei internals (update/rest/SmoothDamp, the #2005 demand bug, ortho ZOOM≠DOLLY), R3F render-loop levers (StarPass FPS throttle, dirty-flag projection, static-city matrices, adaptive DPR), receding-eye morph theory, and 2024–26 interaction/a11y deltas (DragControls now auto-disables; `@use-gesture` already installed; reduced-motion). Feeds [[plan-camera-refactor-optimization]]

## Colour references

- [[color-usage-night-skyline]] — kelvin distribution per source kind, what real night-skyline windows actually look like, where current palette skews wrong, recalibration plan
