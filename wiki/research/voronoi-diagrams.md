---
tags:
  - domain/3d
  - status/verified
  - origin/external-research
---

# Voronoi Diagrams

A **Voronoi diagram** partitions a plane into regions by proximity to a set of input points. Given a set of **sites** (a.k.a. seeds), every location in the plane is assigned to the *nearest* site. The region owned by one site is its **Voronoi cell**.

It is the mathematical backbone of our district partition — see [[decision-streets-first-city-generation]] and `lib/seed/district.ts`.

## Anatomy

- **Site / seed** — an input point. We scatter ~10–24 of these (`placeSeeds`, `district.ts`).
- **Cell** — all points closer to that site than to any other. One cell = one district shell.
- **Edge** — the boundary between two cells; every point on it is *equidistant* to the two neighbouring sites. With the Euclidean metric an edge is a straight perpendicular bisector. **These edges are our district seams** — and the goal of the rework is to turn them into real seam streets.
- **Vertex** — a point equidistant to three or more sites (where edges meet).
- **Delaunay triangulation** — the *dual* graph (connect sites whose cells share an edge). Maximises the minimum angle of its triangles; useful for adjacency queries.

## The distance metric controls the shape

This is the load-bearing fact for us. The "nearest site" test depends on which **distance metric** you use, and the metric dictates what the cell boundaries look like:

| Metric | Formula | Boundary shape | Reads as |
|---|---|---|---|
| **Euclidean (L2)** | `√(dx² + dz²)` (we use squared form, no `sqrt`) | straight bisectors at **arbitrary angles** | organic / angular — *current look* |
| **Manhattan (L1)** | `|dx| + |dz|` | rectilinear: axis-aligned + 45° facets | blocky, map-like |
| **Chebyshev (L∞)** | `max(|dx|, |dz|)` | rectilinear, tends to **axis-aligned** walls | districting-map grid |

L1 and L∞ are the same family rotated 45° (see [[taxicab-geometry]]). Both give the "looks like a zoning map" read the Euclidean version lacks. The rework leans **L∞ evaluated in the grid's frame** so cell walls land *on* grid lines and become seam streets — but L1/L∞ can also create 2-D equidistant "plateau" regions (ties) that need a deterministic tie-break. Metric choice is the first open sub-decision of the grid rework.

## Common variants

- **Weighted / power diagram** — sites carry a weight; bigger weight = bigger cell. Lets some districts dominate.
- **Centroidal Voronoi (Lloyd's relaxation)** — iteratively move each site to its cell's centroid and recompute. A few passes yield evenly-sized, rounded cells (good for *uniform* districts; we deliberately *don't* fully relax, to keep size variety).
- **Clipped / bounded** — cells clipped to a bounding box so they don't run to infinity (we clip to the city extent; out-of-bounds returns `-1` in `classify`).

## Algorithms

- **Fortune's algorithm** — sweepline, `O(n log n)`, the standard exact planar method.
- **Raster / nearest-site sampling** — for each cell of a sample grid, just test all sites and take the nearest. `O(grid × sites)`. Crude but trivial, deterministic, and metric-agnostic. **This is what we do** (`district.ts` samples a 64×64 grid), which is why swapping the metric is a one-line change at the distance test.

## How it applies here

- `lib/seed/district.ts` builds the district field as a raster Voronoi over a 64×64 sample grid, with **highways as hard walls** (`macroSignature` — a point never joins a site across a highway).
- Today the metric is **squared Euclidean** (`(sx-x)² + (sz-z)²`), giving diagonal, organic seams.
- The grid rework proposes switching to **Chebyshev L∞ in the grid frame** so seams are rectilinear and align with the street grid — see [[taxicab-geometry]] and [[decision-streets-first-city-generation]].

## Links

- Voronoi diagram — https://en.wikipedia.org/wiki/Voronoi_diagram
- Fortune's algorithm — https://en.wikipedia.org/wiki/Fortune%27s_algorithm
- Delaunay triangulation (the dual) — https://en.wikipedia.org/wiki/Delaunay_triangulation
- Lloyd's algorithm (centroidal relaxation) — https://en.wikipedia.org/wiki/Lloyd%27s_algorithm
- Weighted Voronoi — https://en.wikipedia.org/wiki/Weighted_Voronoi_diagram
- Amit Patel, *Polygonal Map Generation* (Voronoi + Lloyd for procedural maps, interactive) — https://www.redblobgames.com/x/1843-planet-generation/ and https://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/

## Related notes

- [[taxicab-geometry]] — the L1/L∞ metrics that make the cells rectilinear
- [[decision-streets-first-city-generation]] — where the district partition lives in the pipeline
- [[city-planning-references]] — why multi-grid / seam patterns read as real cities
