# Architecture

Map of Content for system shape, rendering strategy, and the language used to
talk about them. Decision history lives in [[decisions]]; this collects the
reference notes that describe how the running system behaves.

## Rendering & animation

- [[road-reveal-choreography]] — the city-load animation: phases (blueprint
  trace → scout glint → cascade → intro gate → settled), the glossary
  (wavefront, tip, stagger window, straggler tail, radial orphan…), and the
  tuning quick-reference

## Camera & controls

- [[camera-systems-history]] — timestamped survey of every camera + controller in the
  repo's history (eras A–G), current control mappings, and parallels to known systems
- [[camera-lab-test-plan]] — the `/camera-lab` testbed: the seven methods, test tasks,
  rating dimensions, and the lab internals worth porting into the real controller
- [[camera-controls-feature-matrix]] — behavior-by-behavior migration matrix
- [[plan-drei-camera-migration]] — the drei `<CameraControls>` migration plan

## Load-bearing decisions (see [[decisions]] for the full list)

- [[decision-prd-v1-architecture]] — PRD shape, rendering strategy, state model
- [[decision-tensor-field-roads]] — the current city generator
- [[decision-additive-growth-citygen]] — generate-at-max + crop
- [[decision-tile-cull-materialisation]] — per-tile culling via buffer compaction
- [[decision-road-reveal-cascade]] — the reveal model this MOC's choreography note describes
