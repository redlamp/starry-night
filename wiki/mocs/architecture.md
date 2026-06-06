# Architecture

Map of Content for system shape, rendering strategy, and the language used to
talk about them. Decision history lives in [[decisions]]; this collects the
reference notes that describe how the running system behaves.

## Rendering & animation

- [[road-reveal-choreography]] — the city-load animation: phases (blueprint
  trace → scout glint → cascade → intro gate → settled), the glossary
  (wavefront, tip, stagger window, straggler tail, radial orphan…), and the
  tuning quick-reference

## Load-bearing decisions (see [[decisions]] for the full list)

- [[decision-prd-v1-architecture]] — PRD shape, rendering strategy, state model
- [[decision-tensor-field-roads]] — the current city generator
- [[decision-additive-growth-citygen]] — generate-at-max + crop
- [[decision-tile-cull-materialisation]] — per-tile culling via buffer compaction
- [[decision-road-reveal-cascade]] — the reveal model this MOC's choreography note describes
