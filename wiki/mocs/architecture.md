# Architecture

Map of Content for system shape, rendering strategy, and the language used to
talk about them. Decision history lives in [[decisions]]; this collects the
reference notes that describe how the running system behaves.

## Surveys

- [[fable-codebase-survey-2026-07-02]] — full-project survey (architecture,
  performance, security, determinism, docs health) with a prioritized action
  backlog; determinism contract verified end-to-end

## Rendering & animation

- [[road-reveal-choreography]] — the city-load animation: phases (blueprint
  trace → scout glint → cascade → intro gate → settled), the glossary
  (wavefront, tip, stagger window, straggler tail, radial orphan…), and the
  tuning quick-reference

## Camera & controls

- [[plan-unify-camera-selector]] — **2026-06-28 plan:** collapse the two selection axes (`cameraMode` Fly/Orbit/Top-down + `cameraModel` Map/Drift/Turntable) into one shadcn `<Select>` "Camera" dropdown; Stage A = presentation over the existing axes, Stage B = one `CameraId` + fold Fly/Top-down into the registry + retire the legacy controller
- [[plan-camera-refactor-optimization]] — **2026-06-27 audit + plan:** current-state analysis (3 coexisting controllers / stalled migration, faked-ortho keystone, the 1758-line monolith, the `cameraLive` re-render storm, doc-lag) + a P0–P4 prioritized change/optimization plan
- [[camera-architecture-and-perf]] — external research feeding the plan: camera-controls/drei internals, R3F render-loop perf (throttle in StarPass, adaptive DPR, static-matrix), projection-morph theory, 2024–26 interaction/a11y deltas
- [[camera-systems-history]] — timestamped survey of every camera + controller in the
  repo's history (eras A–G), current control mappings, and parallels to known systems
- [[camera-lab-test-plan]] — the `/camera-lab` testbed: the seven methods, test tasks,
  rating dimensions, and the lab internals worth porting into the real controller
- [[camera-lab-to-app-port]] — auditable record of which lab mechanics have moved into the real
  controller (side-view diagram, Focal-Y detent, touch pin-scrub, default focal-Y) and the one gap left
- [[camera-controls-feature-matrix]] — behavior-by-behavior migration matrix
- [[plan-drei-camera-migration]] — the drei `<CameraControls>` migration plan

## Load-bearing decisions (see [[decisions]] for the full list)

- [[decision-prd-v1-architecture]] — PRD shape, rendering strategy, state model
- [[decision-tensor-field-roads]] — the current city generator
- [[decision-additive-growth-citygen]] — generate-at-max + crop
- [[decision-tile-cull-materialisation]] — per-tile culling via buffer compaction
- [[decision-road-reveal-cascade]] — the reveal model this MOC's choreography note describes
