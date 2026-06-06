# Road Reveal Cascade — Design Spec

**Date**: 2026-06-05
**Status**: approved (brainstorm session, animated mockups in `.superpowers/brainstorm/`)
**Issue**: roads currently snap in when generation completes; the GenTrace overlay (#59 Phase B) pops segments in batches and hard-cuts to the final ribbons.

## Decision

Centre-out topological cascade (mockup option B), with the gen-wait trace
softened into it (wait-treatment option 3). Replays on **every** new city —
seed, tier, shape, or sketch change — warm or cold cache.

- Highways grow outward from their point nearest the city centre (closed
  rings grow both directions around).
- Arterials sprout from their highway junction at the moment the wavefront
  reveals that junction.
- Streets sprout from their arterial junction the same way.
- Roads lead, buildings follow: the building intro is gated until cascade
  progress ≈ 35%.

## Components

### 1. Schedule — `lib/scene/roadReveal.ts` (new, pure)

`buildRevealSchedule(highways, arterials, streets, centre) → per-poly {start, speed, attachArc}`

Hierarchical attach by geometric proximity (gen output carries no parentage):

- street → nearest arterial point (streets seed from arterial endpoints, so
  the match is tight); arterial → nearest highway point; highway → centre.
- Attach time = parent's reveal time at the junction point + small lag; the
  line grows from its attach point at a per-tier speed.
- Orphans (no parent within ε — random infill seeds): fall back to radial
  wavefront time (distance from centre ÷ wave speed) so they join the wave
  rather than pop.
- Normalize so the slowest line finishes at progress 1.0.

Pure function of road geometry → deterministic, recomputable, never stored
(two-tier state rule). Cost: one pass over polyline points with a grid hash,
run once per generated city alongside geometry build.

### 2. Geometry — `lib/seed/roadMesh.ts`

`buildRoadGeometry(polys, revealOf?)` — optional `revealOf(polyIndex, arcDist) → number`.
Each emitted vertex (segment quads AND join/cap discs) gets an `aReveal`
attribute = normalized reveal time at its arc position. Omitted → 0
(immediately visible): /plan, scripts, and any existing caller unchanged.

### 3. Render — `components/scene/Roads.tsx`

Replace `meshBasicMaterial` with a minimal ShaderMaterial preserving current
params (flat colour, `polygonOffset -2/-2`, `depthWrite:false`, `fog:false`,
`toneMapped:false`, DoubleSide). Fragment: discard where
`aReveal > uRevealProgress`; vertices within a short window behind the
wavefront get a bright tip (emissive > 1.0 → ACES glow), settling to the tier
colour.

`uRevealProgress` is a shared uniform singleton (sharedTime pattern), advanced
in a `useFrame`: `progress = clamp(elapsedSinceCityReady / duration)`. Resets
when the city key changes (seed/tier/shape/sketch). Honors `paused`. Reveal is
render-side presentation like the existing intro — scene state stays
seed-deterministic.

### 4. Wait act — `components/scene/GenTrace.tsx`

- Each streamed line gets per-vertex birth time (batch arrival) + arc
  fraction; line draws on over ~0.4 s instead of popping.
- Dimmer palette than today (it's a sketch, not the show).
- When the cascade starts, trace opacity fades to 0 across the cascade
  duration beneath the bright network. No unmount blink.
- Warm cache: no trace (no progress events) — cascade plays alone. Sync
  fallback path (no Worker): same.

### 5. Choreography

- Building intro start gated until cascade progress ≥ ~0.35.
- Streetlights + traffic fade-in keyed to the same gate (both already have
  intro-progress uniforms). Polish tier — same branch, end of plan.

### 6. Control surface

- `roadReveal.durationSec` in Zustand, persisted. Default 4 s at City tier,
  ×1.4 at Metro, ×0.7 at Town. `0` = off → instant roads (today's behavior).
- Slider in the Roads panel.

## Edge cases

- Closed highway rings: grow both directions from nearest-centre point; both
  arcs carry reveal times.
- City key change mid-cascade: progress resets, new schedule.
- Debug roads hidden/wireframe: reveal attribute harmless; wireframe shows
  the same clip.
- /plan page and headless scripts: `revealOf` omitted → fully visible.
- `prefers-reduced-motion`: respect by forcing duration 0? — deferred to
  implementation review (intro doesn't currently).

## Out of scope

- Road-gen speed (the ~6 s metro roads phase) — separate issue
  `perf(gen): roads phase`, RK4 tracer profiling first.
- Per-building reveal keyed to its specific street (approximated by the
  radial gate).

## Verification

- gate1 + city golden unchanged (schedule is render-side only).
- Visual: capture `/` with cascade mid-flight (per project verification
  habit); confirm no z-fight/moiré regression from the material swap.
- Determinism check: same seed → identical schedule (pure function).
