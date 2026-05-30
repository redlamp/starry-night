---
tags:
  - domain/3d
  - domain/visual-language
  - status/draft
  - origin/external-research
---

# Map Layout References

Visual + textual references for grounding the grid-first city rework
([[decision-grid-first-city-generation]], [[plan-grid-first-rework]]) in real
city plans. Seeded 2026-05-30 while gathering Google-Maps screenshots; the
design-critical question is how differently-oriented grids actually *meet*.

## The design-critical finding (seam streets, issue #33)

The grid-first plan promotes **every** Voronoi district boundary to a thin
(~14m) "seam street." Real cities frequently do the opposite: a single **wide
shared boulevard** reconciles two clashing grids, and it is often **diagonal**.

**San Francisco — Market Street** is the canonical case. Two grids (SoMa runs
parallel to Market; downtown is ~9° off cardinal) were laid by separate owners
and were geometrically incompatible. Engineer Jasper O'Farrell united them in
1847 with a single **120-ft (≈37m) diagonal boulevard** (Market St) aimed at
Twin Peaks — explicitly "a transition between the two opposing street grids."
Source: [Market Street (San Francisco) — Wikipedia](https://en.wikipedia.org/wiki/Market_Street_(San_Francisco)).

**Implication for the rework:** the biggest seams may want to be **promoted to
wide avenues**, and the largest of those *are* the legacy diagonals (#34) — i.e.
#33 (seam streets) and #34 (diagonals) overlap at the major boundaries. Open
fork to resolve from the screenshots:

1. **As-spec** — every Voronoi boundary → thin ~14m seam street (many seams).
2. **Tiered** — only the major boundaries promoted to wider avenues; minor
   boundaries stay as the existing footprint gap (no drawn street).
3. **Seam-as-diagonal** — the dominant seam per macro-region *is* a diagonal
   boulevard (#33 + #34 merge), the rest are thin gaps.

## Screenshot shot list (open the links, capture north-up, scale bar visible)

Drop captures into `wiki/research/assets/` (create as needed) and I'll annotate
each here with what it demonstrates. A satellite shot of the same spot helps —
it shows block *fill* (solid/void), not just street centrelines.

### Seams — two grids meeting (priority, issue #33)

| # | Place | OSM link | Shows |
|---|---|---|---|
| 1 | SF, Market St | [map](https://www.openstreetmap.org/#map=16/37.7875/-122.4060) | SoMa grid vs downtown grid at one diagonal boulevard — the seam archetype |
| 2 | Manhattan, West Village | [map](https://www.openstreetmap.org/#map=16/40.7339/-74.0011) | Commissioners' grid vs older irregular Village grid — messy seam |
| 3 | SF, Castro/Mission | [map](https://www.openstreetmap.org/#map=15/37.7625/-122.4350) | several small grids colliding at Market |
| 4 | Tokyo, Shibuya | [map](https://www.openstreetmap.org/#map=15/35.6618/139.7041) | organic, non-orthogonal multi-grid seams (non-American case) |

### Block proportions (confirm [[block-proportions]] bands)

| # | Place | OSM link | Shows |
|---|---|---|---|
| 5 | Manhattan, midtown | [map](https://www.openstreetmap.org/#map=16/40.7549/-73.9840) | ~3:1 elongated blocks |
| 6 | Chicago, Loop + Lincoln Park | [map](https://www.openstreetmap.org/#map=15/41.8807/-87.6300) | ~2:1 standard module |
| 7 | Sun City, AZ | [map](https://www.openstreetmap.org/#map=14/33.5975/-112.2772) | curvilinear suburban contrast (anti-grid) |

### Diagonals + wedge blocks (issues #34, Stage 7 flatiron)

| # | Place | OSM link | Shows |
|---|---|---|---|
| 8 | Washington DC | [map](https://www.openstreetmap.org/#map=14/38.8951/-77.0364) | L'Enfant diagonals + triangular wedge blocks |
| 9 | Manhattan, Flatiron | [map](https://www.openstreetmap.org/#map=17/40.7411/-73.9897) | the literal wedge lot (Broadway × 5th × 23rd) |

### Ring roads / scale (issue #14 — current rings too small)

| # | Place | OSM link | Shows |
|---|---|---|---|
| 10 | Columbus, OH (I-270) | [map](https://www.openstreetmap.org/#map=11/39.9612/-82.9988) | beltway-to-built-extent ratio |
| 11 | Houston (610 + Beltway 8) | [map](https://www.openstreetmap.org/#map=10/29.7600/-95.3700) | two concentric rings at metro scale |

## Background references

- **Figure-ground / Nolli plan** — solid (built) vs void (open) mapping; the
  right lens for block *fill* density (Stages 5–6), less so for street seams.
  [Wikipedia](https://en.wikipedia.org/wiki/Figure-ground_diagram) ·
  [MORPHOCODE intro](https://morphocode.com/figure-ground-diagram/).
- **Orthogonal grids from above, 17 cities** — comparative aerial set.
  [ArchDaily](https://www.archdaily.com/949094/orthogonal-grids-and-their-variations-in-17-cities-viewed-from-above).
- **Street-network orientation & entropy** — quantifies grid coherence vs
  disorder; useful for the drift-field (`DEFAULT_DRIFT_DEG`).
  [Boeing 2019, Applied Network Science](https://link.springer.com/article/10.1007/s41109-019-0189-1).
- **Evolution of US street-network planning** — grid → cul-de-sac → back.
  [arXiv 2010.04771](https://arxiv.org/pdf/2010.04771).

## Cross-links

- [[plan-grid-first-rework]] — the implementation plan this informs (Stage 3 = seams)
- [[decision-grid-first-city-generation]] — the architecture decision
- [[city-planning-references]] · [[block-proportions]] · [[voronoi-diagrams]] · [[taxicab-geometry]]
