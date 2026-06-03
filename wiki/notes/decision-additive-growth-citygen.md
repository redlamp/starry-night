---
tags:
  - domain/city-gen
  - domain/stack
  - status/adopted
  - scope/m3-plus
  - origin/verification-gate
---

# Decision: Additive City Growth via Generate-at-Max + Crop

**Date:** 2026-06-03
**Drives:** #14 (city scale) — this was the gate on the scale spike.
**Context:** [[plan-metro-suburbs-highways]] additive-growth open question; [[plan-city-scale-tiers]]; [[decision-tensor-field-roads]].

## The requirement

User wants extent to grow **additively**: expand outward, keep the existing core
**unchanged**, no full re-roll on a live slider change — *"avoid regen of existing city on
live slider change, just expand what's currently there."* Proposed mechanism (2026-06-03):
a large, cheap, generative tensor-field map; build only within the **city-shape crop**;
defer buildings/roads until an area is exposed; purge cropped-out content; rely on
determinism to recreate exact positions on demand (window/light *state* may differ — fine);
reuse the same machinery for culling / occluding offscreen content.

## Code audit — coordinate-local vs global (today)

- **Tensor field** (`tensorField.ts`): already a lattice of grid bases, BUT basis count
  `N = 4·CITY_SCALE` (`:67`) and a single sequential `rng` stream (`:55`) make it
  **extent-dependent**. Trivially fixable (per-cell seeding + fixed pitch + neighbourhood
  sampling).
- **Roads** (`tensorStreets.ts`): streamlines are **long global paths**
  (`MAX_PTS ≈ 420·scale` → ~3.4 km at Metro). Seeded by a **random fallback across the
  whole bbox** (`:145`) and gated by **order-dependent separation state** (`GridStorage` /
  `blocked`, `:64`). → bbox size changes the whole city. This is the seam-coherence +
  long-streamline problem.
- **Districts** (`district.ts`): **no longer Voronoi** (replaced — `:144`). Derived from
  the arterial network by a **global full-grid flood-fill** (`NET_GRID_STEPS = 200·scale`)
  plus a **global distance-to-centre character ranking** (`assignCharacters`, `:78`:
  `subTarget = 1+n/5`, industrial = furthest, etc.). Adding peripheral districts changes
  `n` → **re-ranks and re-labels existing districts**. Global.
- **Buildings** (`cityGen.ts` `fillTensorBuildings`): per-lot, **local**; positions
  reproduce exactly from seed. Window/light state is shader math on `(windowSeed, uTime)` —
  identical at equal `uTime`, so a purge+regen is seamless (and even *consistent*, not just
  plausible, as the user assumed).

→ Field is trivially fixable; **roads and districts are genuinely global** (long
streamlines, global flood-fill + ranking). Truly lazy *per-chunk* generation of roads /
districts is the hard problem (seam coherence, halo ≈ full streamline length, re-ranking).

## Options

**A — Coordinate-local lattice chunking (true infinite streaming).** Per-cell-seeded
field/seeds; deterministic streamline priority + a generation halo; local flood-fill with
seam stitching; per-chunk district character from `(cell, radius-from-centre)` instead of
a global rank. Gives an unbounded city + the best culling story. **Cost: high; road seam
coherence + the long-streamline halo are real engineering risk.**

**B — Generate-at-max-extent + crop (the user's idea). [CHOSEN]** Always generate the
field + roads + districts at a **fixed MAX extent** (Metro tier), deterministically —
*never* at the current displayed size. The existing **city-shape crop**
(`makeShapeMask` / `clipRoadsToMask`, already what the size slider drives after the #14
relabel) selects what is revealed. Growing the slider enlarges the crop → reveals
already-determined content; shrinking purges it. **The core never re-rolls because the
generation bbox never changes.** Buildings — the expensive part — are *materialised*
lazily per-lot within the crop; off-crop lots aren't built and off-crop road meshes are
clipped away.

The load-bearing distinction:
- **Generation** = cheap, done once at MAX, **extent-invariant**: the field function, the
  road polylines, the district labels, every lot's position.
- **Materialisation** = mesh / instances, **lazy + crop-gated**: building InstancedMesh
  entries and road ribbon geometry, built only for what the crop reveals, evicted on shrink.

## Why B

- Directly implements the user's proposal and the **no-re-roll-on-slider** requirement
  (gen bbox constant → core invariant). ✓
- **Sidesteps every hard problem at once** — road seam coherence, the long-streamline
  halo, the global flood-fill, the global character re-ranking — because we always compute
  the full max-extent layout and only ever *hide* parts of it. ✓
- Leverages infrastructure that already exists: the crop mask + slider. The change is to
  **decouple the gen extent from the crop** and fix gen at Metro. ✓
- **Fixes seed-portability:** a seed yields the same core at any displayed size (gen extent
  constant), so the old "different city per size" issue ([[plan-city-scale-tiers]])
  dissolves. ✓
- **Perf/culling synergy:** per-lot/per-region materialisation + frustum culling is the
  same mechanism as Stage 2 (Worker gen + culling). One layer serves both. ✓
- Cost is bounded and acceptable (next section).

## Cost of "a very large tensor field map" (the user's direct question)

Cheap. The field is a **function, not stored data**; building the basis array is
O((4·scale)²) (~256 bases at Metro) and a sample is a bounded weighted sum. The real
one-time costs are the **single RK4 road pass** and the **single full-grid flood-fill** at
Metro — both bounded, deterministic, and **cacheable per seed**, and already movable off
the mount-critical thread (#44). The term that actually grows with area — **buildings** —
is exactly what the crop defers. So: large field + full road/district layout once + lazy
cropped buildings = affordable. The user's intuition (field cheap, defer the expensive
build) is correct.

## Tradeoff / ceiling

B's city is bounded by the chosen **MAX extent** (Metro), not truly infinite. Acceptable:
the project has a defined tier ceiling ([[plan-city-scale-tiers]]); an After-Dark homage
cityscape does not need unbounded sprawl. If unbounded is ever wanted, **A** is the
upgrade — and B's materialise/evict layer is reusable groundwork for it.

## Migration (folds into the #14 scale spike)

1. Introduce a constant **MAX gen extent** (Metro) separate from the display crop; make the
   `CITY_HALF_EXTENT` / `CITY_SCALE`-derived gen constants key off MAX, not the slider.
2. Verify gen-at-MAX is deterministic + **gate1 PASS**, and that the crop reproduces
   today's City view byte-identically at the City crop radius (regression guard).
3. Drive the size/crop slider as **crop radius only** (already most of the way — #14
   relabel made it crop the foundation square).
4. **Lazy building materialisation:** build instances only for lots whose centre passes the
   crop; evict on shrink; rebuild on grow (deterministic per-lot seed → identical
   positions).
5. Profile Metro gen off the mount-critical thread (#44 already moved gen off it; confirm
   at the larger extent).

## Open follow-ups

- **MAX extent value — DECIDED 2026-06-03: Metro 6 km (half 3000).** Reasoning: under B,
  MAX is *not* the default view — the crop is — so the larger extent gives the rural/fringe
  band, core-skirting highways, and the suburbs rebuild the periphery they need, while the
  slider crops back to an intimate skyline on demand. The decision note's old "flat noise
  at orbit" worry was about the *default view*, which is just a crop setting, not MAX.
  Higher one-time gen cost (~2.25× City-plus), bounded + cached. Fully reversible (one
  constant).
- **Eviction granularity** (per-lot vs per-tile) — a perf-tuning detail.
- **Hitch-free live grow:** materialising a ring of new lots mid-drag may need
  throttling/async (ties to the Worker plan, Stage 2).
- This **unblocks the #14 scale spike**, which in turn unblocks the suburbs rebuild and the
  highway corridor rebuild (both deferred to scale).
