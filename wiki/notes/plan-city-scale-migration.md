---
tags:
  - domain/city-gen
  - domain/stack
  - status/open
  - scope/m3-plus
  - origin/verification-gate
---

# Plan: City-Scale Migration (generate-at-max + crop) — #14

**Date:** 2026-06-03 · **Branch:** `spike/city-scale` (off `arch/city-planning`)
**Implements:** [[decision-additive-growth-citygen]] · MAX = **Metro 6 km (half 3000)**.
**Source:** the `citygen-extent-audit` workflow (79 coupling sites, 14 rng-count breakers,
23 gen constants, 15 crop, 7 camera) + an adversarial completeness critic (11 more).

## The spine

- **Do NOT redefine `CITY_SCALE`.** Add `GEN_SCALE = MAX_HALF_EXTENT/BASE_HALF_EXTENT`
  (= 4) for **generation only**; `CITY_SCALE` (= 2) stays the **look** scale. Redefining it
  would double fog/haze/star/moon distances and wreck the cropped-City look (critic #10).
- **Three lanes, classify every site into one:**
  - **GEN** → key off `GEN_SCALE` / `MAX_HALF_EXTENT` (extent-invariant core).
  - **WORLD-BOUNDS** (far plane, ground disc, star-dome radius) → follow MAX (never reveal an edge).
  - **LOOK / CAMERA** (fog near/far, haze, resting camera distance, ortho size) → follow the **crop**, not MAX. Atmosphere is look, not bounds.
- **Generation runs once at MAX, mask-free; the crop is a post-filter.** Never pass the crop
  mask into `generateTensorStreets` *or* `fillTensorBuildings` (a leaked mask shifts the RNG
  draw sequence → re-rolls the core). Materialisation (meshes/instances) crops; generation never does.

## Design decisions (made 2026-06-03)

1. **GEN_SCALE separate from CITY_SCALE** (above).
2. **Lattice ramp keyed off a FIXED reference length** (not `half`): re-express
   `orientationAt` `t = dist/ORIENT_DRIFT_RADIUS` (= 1500) so the field is extent-invariant
   *and* preserves today's City exactly (ramp saturates past the old radius). Critic #9 — the
   single most likely golden-snapshot failure.
3. **`building.id` + `windowSeed` from a quantized world anchor** (not walk-order index/inline
   draw); `fillTensorBuildings` always on the full MAX road set. Critic #1/#2.
4. **Traffic = sparkle** (decision note: runtime state may differ). Defer per-segment streams /
   `MAX_CARS` to last/optional. Critic #6.
5. **Atlas pack-once-at-MAX + per-region culling** = the perf-foundation follow-up (Stage 2);
   the `frustumCulled=false` full-Metro draw cliff (critic #11) is real but out of the
   determinism spine.

## Ordered steps (gate1 + golden after each)

- [x] **Step 1 — baseline.** `scripts/cityGolden.ts` (capture/check); golden captured for
  gate1-0..9 BEFORE any change. Added `MAX_HALF_EXTENT=3000` + `GEN_SCALE` to topology.ts
  (unwired). gate1 + golden + tsc green. ✅
- [ ] **Step 2 — pin GEN domain to MAX.** Re-key off GEN_SCALE/MAX: `generateTopology` half
  (topology.ts:203→208), `buildTensorRoadsImpl` bounds (cityGen.ts:350), tensorField half+N
  (tensorField.ts:58,67), lattice half (lattice.ts:53) **+ ramp ref (decision 2)**, district
  `NET_GRID_STEPS` (district.ts:161) + topo.halfExtent (district.ts:192). Set the crop so
  `scale*MAX = 1500` (scale 0.5) for the regression run → must reproduce the Step-1 golden
  **byte-for-byte**. Expect the lattice ramp (decision 2) to be the divergence to fix.
- [ ] **Step 2b — gate1's own extent coupling.** gate1.ts:129 slack → MAX-derived; gate1.ts:186-187
  lattice scan box → ±MAX about CITY_CENTER (critic #3); make gate1 assert ACROSS {shape,scale}
  pairs, not same-arg twice (critic #4).
- [ ] **Step 3 — kill the 14 rng-count breakers.** Per subsystem, gate1 + cross-crop guard after each:
  (a) tensorField: N off GEN_SCALE + plaza→`::tensor::plaza` (+ optional per-cell `::tensor::cell::i:j`).
  (b) tensorStreets: fixed-MAX bbox freezes the seed loop; MAX_PTS off GEN_SCALE.
  (c) district: pin total/minArea/N at MAX; replace `assignCharacters` rank logic (subTarget/
  industrialTarget/n-2 pivot/order.slice) with **absolute distance bands**; anchor `district.id`
  to a quantized centroid.
  (d) buildings: `id`/`windowSeed` off quantized anchor; keep fill on full roads (critic #1/2).
- [ ] **Step 4 — slider = crop radius only.** Repurpose `cityShapeScale`→`cropFraction`
  (sceneStore.ts:257); square mask gets a real ±cropHalf test (cityShape.ts:45, else square can't
  crop — critic risk). Grow ADDS, shrink purges; intersection of any two crops byte-identical.
- [ ] **Step 5 — camera/look follow the crop.** cameraView.ts:38 H, DEFAULT_ORBIT.radius
  (sceneStore:98), DEFAULT_ORTHO_SIZE (:264) → crop radius. **Fog near/far, haze, stars/moon
  (sceneStore:113,120-124,162-179) → crop or literal, NOT doubled MAX** (critic #10). Keep zoom
  clamps (CameraControls:73-74,85-86), Scene far (Scene.tsx:47), ground disc keyed off MAX.
  Vertical/height values stay unscaled (#47). PlanView BOTH half usages (PlanView:68 + the
  gridN=70 sample loop :84-99) — critic #11.
- [ ] **Step 6 — lazy building materialisation.** InstancedMesh per cropped lot, evict/rebuild
  from seed-only MAX positions (InstancedCity:84). Atlas: pack once at MAX (critic #5).
  Per-region culling, drop `frustumCulled=false` for chunks (critic #11).
- [ ] **Step 7 — traffic per-segment streams** (optional sparkle). MAX_CARS vs Metro demand
  (critic #6): raise cap or accept non-subset.

## Regression guards (in gate1 + cityGolden)

- **Golden snapshot** (Step-1 contract): City-equivalent crop == today, byte-for-byte.
- **Cross-crop core byte-identity**: seed-only artefacts invariant to shapeScale across
  crops {0.25, 0.5, 1.0, 1.4} — topology, field grid, districts, polylines, lot positions,
  **+ building id/windowSeed** (critic #1).
- **District invariance**: M, id, character, centroid, classify(x,z) identical across crops.
- **Silhouette/layout cascade**: high-rise silhouette + per-district layout identical across crops.
- **Reveal-only monotonicity**: crop A < B ⇒ A's ids ⊂ B's; shared buildings identical
  (x,z,height,rotation,districtId,**windowSeed,id**).

## The 14 rng-count breakers (must-fix, Step 3)

tensorField N (`:67`) + plaza draws (`:85-87`); tensorStreets fallback-seed (`:145`),
accept-reset loop (`:144`), MAX_PTS (`:21`); district NET_GRID_STEPS (`:161`), minArea
(`:345`), assignCharacters ranking (`:86`), subTarget (`:110`), industrialTarget (`:122`),
n/2 pivot (`:133`), heritage selection (`:100`), dense-index/id (`:443`); traffic single
stream (`:96`, sparkle). Plus critic: building id/windowSeed (cityGen.ts:543/637/649).

## Risks (from the audit)

Float determinism at the extent change (lattice `t*t` ramp — decision 2 the fix);
absolute-band district character is a *look* change at MAX (visual check + maybe re-tune);
Metro one-time gen cost ~2.25× (off-thread per #44 — verify); square can't crop (Step 4);
camera default-vs-zoom-range split must not invert; MAX_CARS < Metro demand (Step 7).
