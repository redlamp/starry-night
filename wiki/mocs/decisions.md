# Decisions

Map of Content for architectural and product decisions. Each decision is an atomic note under `wiki/notes/decision-*.md`.

## v1 / Foundation

- [[decision-prd-v1-architecture]] — PRD shape, rendering strategy, state model, scope
- [[decision-streets-of-rage-direction]] — Streets of Rage 1991 intro adopted as primary direct visual anchor
- [[decision-1-unit-equals-1-meter]] — World units = meters, with derived archetype dimensions
- [[decision-district-based-city-layout]] — City composes from rotated districts with own grid angles and characters *(superseded)*
- [[decision-streets-first-city-generation]] — Streets-first hybrid: highways and arterials drawn first, districts form between them, blocks/lots emerge from network closure *(road mechanism partially superseded)*
- [[decision-grid-first-city-generation]] — Grid-first rework: coherent grid substrate, patchwork via center-anchored orientation field, continuous seam streets, arterials = heavy grid lines (kills the radial starburst), zone-driven hybrid fill *(geometry superseded)*
- [[decision-tensor-field-roads]] — **Tensor-field streets-first (current model):** roads = streamlines of a grid-basis tensor field, criss-cross arterials + streets, one promoted highway, occasional roundabout, buildings line the frontage; default city generator
- [[decision-network-aligned-districts]] — **Districts follow the arterials:** raster flood-fill with arterials/highway as hard walls (minor streets passable), slivers merged; replaces free-floating Voronoi on the tensor path; one shared field across buildings + all overlays
- [[decision-additive-growth-citygen]] — **Additive growth = generate-at-max + crop:** fix gen at a constant MAX extent (extent-invariant core), drive the size slider as a crop only, materialise buildings lazily within the crop; sidesteps road seam-coherence / global district re-ranking; unblocks the #14 scale spike
- [[decision-density-gradient-bands]] — **District count + absolute-distance character (#49):** sliver-merge keyed to an absolute min area (count scales with the city), high-rise pinned to a compact CBD core by absolute distance (Clark 1951) with residential as the bulk; fixed the Metro "84–98% high-rise slab"
- [[decision-tensor-field-morphology]] — **Tensor field morphology menu (#51):** each seed draws one family — warp / shear / calm-grid / tamed-radial — all as grid-basis layouts with per-position θ; kills the "dull linear / common bullseye" read; per-seed `deviation` for spread
- [[decision-sketch-tensor-field]] — **Sketch-driven tensor fields (#40):** a photo of a hand-hatched sketch becomes the street plan — structure-tensor recovery, doubled-angle bilinear sampling, ink = footprint mask; registry mirrors the store, one inert tracer param, `/tensor` lab as the bridge
- [[decision-tile-cull-materialisation]] — **Per-tile culling via buffer compaction (#55):** items stored tile-major, visible tiles' slices copied to the buffer head on set-change, `mesh.count`/drawRange lowered; draw calls constant, lazy materialisation falls out of generate-at-max
- [[decision-window-proportion-by-archetype]] — Per-archetype window size + grid pitch (skyscraper glass / warehouse bays / heritage punched windows); admits archetype-level fenestration to v1
- [[decision-moon-celestial-model]] — Moon parametrised as azimuth / elevation / distance, not cylinder coords
- [[decision-orbit-spherical-controls]] — Spherical orbit + drag / pinch / wheel controls on the canvas
- [[decision-github-pages-deploy]] — Static export to GitHub Pages on every push to main
- [[decision-debug-panel-architecture]] — IA + master toggle + save / reset / copy values *(superseded)*
- [[decision-settings-sidebar-shadcn]] — shadcn rewire: full-height sidebar, multi-open accordion, light/grey/dark theme tokens
