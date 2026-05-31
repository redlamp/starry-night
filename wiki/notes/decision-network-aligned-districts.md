---
tags:
  - domain/stack
  - status/adopted
  - origin/external-research
---

# Decision: Network-Aligned Districts (Arterials as Walls)

**Date:** 2026-05-31

## Context

The tensor-field rebuild ([[decision-tensor-field-roads]]) fixed the *roads*, but districts were still the old **Voronoi** field: `generateDistricts` dropped center-weighted seed points and carved cells whose edges floated freely across the road network. So the district overlay never lined up with the streets the buildings were placed against — a district boundary could run straight through the middle of a block.

The user asked for districts that "follow the street/arterial bounds, not free-floating Voronoi." Background research (districting strand of the 2026-05-31 enhancement workflow) confirmed the real-world model: **district boundaries ARE arterials.** The superblock planning model puts dense/commercial uses on the arterials bounding a block and residential uses inside; NYC zoning runs district edges along street centrelines (NYC ZR 76-141). A district is a *group* of adjacent blocks bounded by arterials, subdivided internally by minor streets.

## Options considered

1. **Planar-face extraction + dual-graph flood-fill** (the textbook CityEngine approach the research described). Build a vertex-snapped half-edge graph from the road polylines, extract faces (blocks) by angular-sorted traversal, build a block dual-graph, flood-fill across minor edges but not arterial edges. *Rejected:* tensor streamlines cross **mid-segment** (cross-family), not at shared endpoints, so this needs robust all-pairs segment-intersection + face traversal — fragile, determinism-sensitive, and the same hand-rolled-planar-graph risk the tensor review already flagged.
2. **Raster flood-fill with arterials as walls (chosen).** Rasterise arterials + the highway as hard walls, flood-fill the gaps, merge slivers, assign character as before.

## Chosen

**Option 2** — `generateDistrictsFromNetwork(masterSeed, walls, topo)` in `lib/seed/district.ts`:

1. Rasterise the city extent (200×200, ~7.5 m cells). Mark a cell as **wall** if an arterial/highway segment passes within `width/2 + 0.6·step` — thick enough that a 4-connected flood can't leak across a diagonal.
2. Flood-fill the non-wall cells (4-connectivity) into raw components. Minor streets are **not** walls, so one component spans several street blocks.
3. Multi-source BFS floods the component labels out into the wall cells, so every cell is owned by its nearest district and boundaries sit on the arterial medians.
4. Union-find merge: collapse the smallest region into its strongest-bordering neighbour until under the cap and no sliver (< 4.5% of map area) remains, never below the floor (6). The **area threshold**, not the cap, is the primary control — it makes a district a *group* of arterial superblocks and lets the count vary by seed.
5. Character pass: identical distance-to-centre rank + RNG key (`::districts`) as the Voronoi path, so the downtown/subcentre/residential/industrial/heritage logic is unchanged.

`classify()` stays an O(1) `Int16Array` lookup, so **every consumer is untouched** (building fill, lighting, streetlights, overlays). To break the old streets→districts dependency, `generateTensorStreets` now takes bounds directly (it only ever used `field.bounds`); `buildTensorRoads` builds streets first, then derives districts from the finished network. `buildTensorRoads` is cached and exposes `tensorDistrictField`, which the `/plan` overlay, the scene `DistrictShells`, and the settings Districts list all read — so the drawn districts match the ones the buildings sit in (previously each ran its own Voronoi pass and silently disagreed).

## Why

- Boundaries fall on arterials, the way real district edges do — the overlay finally agrees with the road network and the building placement.
- Raster flood-fill is robust + fast + **fully deterministic** (pure geometry; the only RNG is the existing seeded character pass) — avoids the fragile planar-face extractor.
- One shared field across every consumer, so nothing can drift out of sync.

## Verified

`gate1` PASS on 20 seeds: districts land in **[8,14]** with a realistic mix (central downtown + subcentre cluster, residential body, edge industrial, ~70% heritage), 0 overlaps, 0 corridor hits, determinism PASS, ~1,600 buildings/seed. `tsc` clean, build green.

Supersedes the Voronoi districting on the tensor path. The Voronoi `generateDistricts` remains only for the dormant grid-first A/B path (pending the dead-code purge).
