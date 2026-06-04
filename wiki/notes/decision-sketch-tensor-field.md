---
tags:
  - domain/city-gen
  - status/adopted
  - scope/m3-plus
---

# Decision: Sketch-Driven Tensor Fields (#40)

**Date:** 2026-06-04 · shipped to `dev` (`15d1437`, `b1ba4f8`, `3c373ab`).

## Context

The user's hand-hatched notebook sketches (dense directional pen hatching, whirls
+ patchwork grids) look strikingly like tensor-field visualisations. Question:
can a photo of one *become* the city's street plan?

## What was built

1. **Recovery** (`lib/sketch/orientationField.ts`): image structure tensor
   (Sobel → J = ∇I·∇Iᵀ, box-blurred ≈ Gaussian) per ~9 px cell → stroke
   orientation (mod π) + coherence; energy-percentile + coherence gates drop
   bare paper. A sign-continuity BFS *implies* a flow direction from the
   π-ambiguous strokes (gridified `alignDir`) — visualisation only; the tracer
   never needs absolute sign.
2. **TensorField wrapper** (`makeSketchTensor`): bilinear sampling in
   **doubled-angle space** (`a = Σw·cos2θ, b = Σw·sin2θ` — the same `[a, b]`
   symmetric-traceless representation `tensorField.ts` uses) so θ vs θ+π can't
   corrupt the blend. Ink coherence doubles as the mask: streamlines stop at
   bare paper.
3. **City integration** (`lib/seed/citySketch.ts`): module registry mirroring
   the store (the `setCityTier` pattern). A registered sketch swaps the seeded
   basis field at the `buildTensorRoadsImpl` choke point and its ink becomes
   the street mask + footprint clip — districts, buildings, lights all derive
   from the roads, so the whole city follows with no further changes. All gen
   caches + the worker request key on `sketchKey()` (content hash).
4. **`/tensor` lab page**: drop/paste a sketch photo, dial recovery + trace
   knobs, layer toggles (sketch / orientation / implied flow / tensor crosses /
   traced streets), **Use in city** bridge to the scene. No scene store, no
   city generator beyond the tracer.

## Why this shape

- `generateTensorStreets` gained one inert `fieldOverride` param — golden
  PASS ×10 proves the no-sketch path byte-identical.
- Determinism contract holds: the city is a pure function of
  (seed, tier, sketch); the sketch is runtime config, exactly like `cityShape`.
- Session-only for now (re-drop to restore). Persistence + a curated
  sketch *library* (seed picks one + transform) are open follow-ups.

## Verification

`sketchCitySmoke` (no-sketch identity, sketch-drives-city, all buildings on
ink, district band), golden ×10, worker smoke, tier sanity. Visual:
`samples/sketch-city.png` (notebook page → 3.3k-building city, whirl → ring
roads + spokes).

## Open questions

- Fixed sketch vs seeded variety: blend sketch with seeded bases? Library of
  recovered fields as a morphology family?
- District character over sketch cities (only 6 districts on the test page —
  ink coverage shrinks the network the flood-fill divides).

Relates: [[decision-tensor-field-roads]], [[decision-tensor-field-morphology]],
[[decision-additive-growth-citygen]].
