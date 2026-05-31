---
tags:
  - domain/3d
  - status/verified
  - origin/external-research
---

# Taxicab / Manhattan Geometry

**Taxicab geometry** (a.k.a. **Manhattan distance**, **L1**) measures distance as the sum of the axis-aligned steps between two points — the distance a taxi drives on a grid of streets, never cutting diagonally:

```
d_L1(a, b) = |ax − bx| + |az − bz|
```

It is one member of the **Minkowski / Lp** family of distances. The three that matter to us:

| Name | p | Formula | Unit "circle" (all points at distance 1) |
|---|---|---|---|
| **Manhattan** | 1 | `|dx| + |dz|` | a diamond (square rotated 45°) |
| **Euclidean** | 2 | `√(dx² + dz²)` | a circle |
| **Chebyshev** | ∞ | `max(|dx|, |dz|)` | an axis-aligned square |

As `p` rises from 1 to ∞ the unit ball morphs diamond → circle → square. The shape of that ball is *why* the metric changes a Voronoi diagram's look (see [[voronoi-diagrams]]): cell boundaries are built from arcs of these balls.

## Properties worth knowing

- **L1 and L∞ are the same geometry rotated 45° (and scaled).** Rotate the plane 45° and a Manhattan diamond becomes a Chebyshev square. So they produce the same *family* of rectilinear boundaries, just oriented differently. This is the crux of our metric choice: to get **axis-aligned** seam walls (streets running with the grid), evaluate **Chebyshev in the grid frame**; raw Manhattan tends to put the facets on the 45° diagonals instead.
- **Many shortest paths.** On a grid there are multiple equal-length routes between two points (any monotone staircase). The geometric consequence: equidistant *regions* can be 2-D "plateaus", not just thin lines. In a Voronoi diagram this shows up as ambiguous boundary bands that need a deterministic tie-break.
- **No diagonal shortcut.** Distance never rewards cutting the corner — which is exactly why it reads as "city blocks."

## Where it shows up

- **Grid / lattice pathfinding** — Manhattan is the natural admissible A* heuristic on a 4-connected grid; Chebyshev for 8-connected (king moves).
- **Chess** — king's move count between squares *is* Chebyshev distance; a rook's axis-constrained travel is Manhattan-flavoured.
- **VLSI / circuit routing** — wires run orthogonally, so wire length is Manhattan ("Manhattan routing").
- **Facility location / districting** — service areas on a street grid are naturally Manhattan, which is why L1/L∞ Voronoi diagrams look like real administrative/zoning maps.

## How it applies here

The district partition (`lib/seed/district.ts`) currently uses **squared Euclidean (L2)**, so seams cut at arbitrary diagonal angles and read organic. Switching the nearest-site test to **Chebyshev L∞ in the city's grid frame** makes the cell walls rectilinear and grid-aligned — so a district boundary *becomes* a street that both neighbouring grids already align to (the structural anti-hash guarantee). It's a one-line change at the distance test plus a grid-frame rotate. Trade-off: L1/L∞ ties (the plateaus above) need a small seeded tie-break to avoid jagged seams. See [[voronoi-diagrams]] and [[decision-streets-first-city-generation]].

## Links

- Taxicab geometry (L1) — https://en.wikipedia.org/wiki/Taxicab_geometry
- Chebyshev distance (L∞) — https://en.wikipedia.org/wiki/Chebyshev_distance
- Minkowski distance (the Lp family) — https://en.wikipedia.org/wiki/Minkowski_distance
- Lp space / p-norm — https://en.wikipedia.org/wiki/Lp_space

## Related notes

- [[voronoi-diagrams]] — how the metric reshapes the district partition
- [[decision-streets-first-city-generation]] — the rework that adopts a rectilinear metric
