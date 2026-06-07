---
tags:
  - domain/city-gen
  - domain/performance
  - status/adopted
  - scope/m3-plus
---

# Decision: Per-Tile Culling via Buffer Compaction (#55)

**Date:** 2026-06-04 · shipped to `dev` (`324bf27`).

## Context

Metro ≈ 24k buildings in 7 archetype `InstancedMesh`es + 2 GL_POINTS clouds
(streetlights, traffic), all `frustumCulled=false` — every instance/point
processed every frame regardless of camera. The steady-state perf cliff
(mobile-critical). #52's shader LOD shrank/dimmed far lights but still
processed them.

## Options

1. **Per-tile meshes** (tile × archetype `InstancedMesh`es, three.js culls each)
   — ~225 tiles × 7 archetypes ≈ 1.5k objects; draw calls explode when zoomed
   out, scene-graph churn.
2. **Buffer compaction** ← chosen: keep the 9 draw objects; partition items
   once into 500 m world tiles with records stored **tile-major**; per frame
   ~150–225 AABB-vs-frustum tests pick the visible set; only when the set
   *changes* are visible tiles' contiguous slices copied to the head of the
   draw buffers and `mesh.count` / `drawRange` lowered.

## Why 2

- Draw calls constant (7 + 2) at any zoom; the win is per-frame vertex /
  instance work + additive overdraw.
- "Lazy materialisation" falls out: eviction = not being copied; re-entry is a
  lossless slice copy (generate-at-max means records never recompute).
- A still camera costs only the AABB tests; copies fire on tile-boundary
  crossings (~1.5 MB worst case, sub-ms).
- Window atlas still packs once over ALL buildings (migration critic #5).

## Mechanics (`lib/scene/tileCull.ts`)

`partitionByTile` (tile-major order + pre-margined Box3 per tile, heights
honoured; traffic tiles by segment midpoint with margin ≥ longest half-segment
so shader-animated cars never leave their box) → `visibleTiles` (frustum from
camera each frame, signature string for change detection) → `compactVisible`
(slice copies per channel: instance matrices + every instanced attribute).
`lod.tiles` toggle (default on, forward-filled into old saved configs).

## Verification

`tileCullSanity`: conservation (all-tiles compaction reproduces every record
exactly once), zero false negatives vs per-point frustum containment, 49/144
tiles for an in-city pose. Gen untouched — golden/gate1 unaffected by
construction. 3080 Ti fps confirmed fine; Pixel 6 pass pending.

## Remaining (carved to #70 — #55 closed 2026-06-07)

#55 closed at v2026.06.07.1 (culling + debug tooling shipped; 3080 Ti and
Pixel 6 passes confirmed). The lazy-materialisation refinements moved to #70:
crop-as-tile-op without buffer rebuild, center-out reveal ordering, and
"materialise dark, wake by light" (from #59) — the tile machinery is the
natural carrier for all three.

Relates: [[decision-additive-growth-citygen]] (materialisation vs generation),
[[plan-city-scale-migration]].
