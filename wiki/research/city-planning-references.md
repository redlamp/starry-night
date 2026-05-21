---
tags:
  - domain/visual-language
  - domain/3d
  - status/adopted
  - scope/m1
  - origin/external-research
---

# City Planning References

For when "grid of blocks" stops being enough — multi-angle camera will expose layout flatness from any direction other than the canonical Streets-of-Rage axis. Real cities solve this with a few load-bearing patterns.

## Patterns to steal

### 1. Multiple grids meeting at angles

Real cities are usually a mosaic of mini-grids, not one master grid. Each mini-grid often reflects when/by-whom that quadrant was developed.

- **Manhattan** — rigid Commissioners' Plan grid above 14th Street; tangled organic streets below (West Village, Lower Manhattan / Financial District); the older Dutch wagon roads survive as Broadway/Bowery; the planned grid meets the organic core at Astor Place.
- **Boston** — orthogonal Back Bay grid is rotated about 30° off the older South End grid, which is itself off the cow-path organic core.
- **Barcelona** — Eixample's perfectly square grid (chamfered corners) abuts Barri Gòtic's medieval tangle.
- **Detroit / Toronto / Chicago** — colonial grid with arterial diagonals (Woodward, Yonge, Michigan/Grant) and the occasional river-following street.

### 2. Diagonal arterials cutting through

A grand avenue at 25–45° slicing through grids, often radiating from a central node.

- **Washington DC** — L'Enfant plan. Orthogonal grid + diagonal "state" avenues (Pennsylvania, Massachusetts, etc.) converging on Capitol and White House. Creates triangular "wedge" blocks where they meet.
- **Paris** — Haussmann's boulevards radiate from Place de l'Étoile and other star points, crossing the older fabric.
- **Manhattan** — Broadway is the diagonal exception that produces triangular blocks (Times Square, Flatiron, Herald Square).

### 3. Organic / pre-planning core

Older cores predate orthogonal planning. Streets follow former cow paths, walls, watercourses. Blocks are small, irregular, non-rectangular.

- **Boston North End**, **Lower Manhattan**, **central Athens**, **central Rome**, **most of central Tokyo**.
- Useful as a contrast district against rigid downtown.

### 4. Geographic distortion

Even rigid plans bend around topography. Defer for v1 (no terrain), but note:

- **San Francisco** — grid bends around hills; impossible streets like Lombard.
- **Pittsburgh** — three-rivers triangle forces irregular street pattern.
- **Edinburgh** — Old Town follows a glacial ridge; New Town is parallel to it.

### 5. Block size by district

- Downtown / financial — small blocks (60–80 m on a side) for short walking distances
- Residential — larger blocks (100–150 m), longer rows
- Industrial / warehouse — very large blocks (150–250 m), big footprints, sparse buildings
- Old core — variable, mostly small + irregular

## What we will adopt for v1

A district-based layout. Each district carries:

- An axis-aligned **rotation angle** in its local frame
- A **footprint** (rectangle or polygon) in world space
- A **block-size range** and **street-width range**
- A **character bias** (downtown / residential / industrial / oldtown) that biases archetype and lit ratios
- A **regularity** flag (rigid grid vs irregular block sizes vs fully organic)

The city composes ~3–6 districts. They may abut at sharp angles, which is exactly the seam we want.

Plus, **one or two diagonal arterials** cutting at ~25–45° across the city, treated as wide streets that override block boundaries.

Plus, an **organic old quarter** in some seeds — Voronoi or perturbed cells instead of axis-aligned grid.

This system is procedural and seed-deterministic; districts and arterials are derived from sub-seeds, not authored per-seed.

## GIS / real-world data

Real geo data is freely available and could feed our generator. Options, easiest to hardest:

### OpenStreetMap (OSM)

- Global coverage, free, permissive (ODbL) — needs attribution if we ship rendered output verbatim
- **Overpass API** — query roads + buildings by bounding box, returns OSM XML / JSON
- **Overpass Turbo** — web UI for testing queries
- For a 1 km × 1 km square downtown extract, the API call is small, the response is manageable
- We could fetch a real district once, extract:
  - block polygons (closed road loops)
  - street centerlines + widths
  - block aspect ratios + angles
- Use as either: (a) direct geometry feed, or (b) statistical inspiration for the procedural generator

### Mapbox / Maptiler vector tiles

- Pre-tiled, mercator-projected vector data
- Includes buildings with heights (in some cities)
- Requires API key, has free tier
- More polished than raw OSM but less granular

### US Census TIGER / Line shapefiles

- US-only, very accurate roads + administrative boundaries
- No building geometry
- Free, public domain

### City open data portals

- NYC OpenData, SF DataSF, Chicago Data Portal, etc.
- Often have **building footprint shapefiles with heights**
- Best source if you want a real specific city's volumes
- Licensing varies

### What's worth doing for this project

For v1: **no real GIS dependency**. Procedural with the patterns above is enough, and keeps determinism + portability simple.

For M2+: optionally pull a single OSM extract (e.g. Manhattan around Bowery / SoHo, or central Boston, or Chiyoda Tokyo) **once**, use it as a fixed dataset to drive a "real-fed" mode alongside the procedural mode. The fixed dataset would ship in `public/` and load on demand.

## What we will NOT do

- No live OSM fetch at runtime — would break offline and break determinism
- No accurate global projection — flat plane, meters local
- No street naming or wayfinding
- No vehicle traffic simulation (separate skill set)

## Related notes

- [[decision-1-unit-equals-1-meter]] — meters is the unit
- [[building-sizes-real-world-references]] — block-size bands per district
- [[decision-streets-of-rage-direction]] — anchors visual style; this note anchors structural plan
