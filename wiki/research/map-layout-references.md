---
tags:
  - domain/3d
  - domain/visual-language
  - status/verified
  - origin/external-research
---

# Map Layout References

Real city-plan screenshots (captured 2026-05-30) + textual references for
grounding the grid-first city rework ([[decision-grid-first-city-generation]],
[[plan-grid-first-rework]]). Images live in `assets/`.

## Odd-angle core districts (added 2026-06-08, #49 round 4)

User-supplied OSM captures grounding the tensor-field grid PATCHES
(`tensorField.ts` — hard-override regions with a smoothstep seam band):

- `![[San Diego California.jpg]]` — **Barrio Logan / Golden Hill run ~45°**
  against the downtown grid; each rotated zone is district-sized and
  internally coherent, seams are short curved connector blocks.
- `![[San Francisco 1 California.jpg]]` — **Market St** as the single diagonal
  seam between the northern grid and SoMa's rotated, larger-block grid.

Takeaway: the metro core keeps its grid but carries 1–3 district-scale
rotated patches; the seam reads as bent connector streets / one diagonal,
never as a gradual warp. Relates: [[suburban-street-patterns]].

## Seam fork — RESOLVED (tiered / seam-as-arterial)

The plan's open question: promote **every** Voronoi district boundary to a thin
~14m seam street, or only the major ones? **The screenshots settle it: tiered.**

What real cities show, without exception:

1. **Grids meet along a few MAJOR existing through-streets — not a lane per
   boundary.** SF's two grids join at the single diagonal **Market St**.
   Manhattan's Commissioners grid vs the older Village/downtown core transitions
   along a handful of streets, with **Broadway** slicing through as one diagonal.
2. **The big seams are usually DIAGONAL** and double as arterials — Market St,
   Broadway, DC's radial avenues, Chicago's Milwaukee/Clybourn/Lincoln. So #33
   (seams) and #34 (legacy diagonals) are the **same heavy through-network** at
   the largest scale.
3. **A city has a HANDFUL of large coherent grid zones**, each with its own
   constant orientation — not dozens of small cells. Orientation changes are
   **discrete steps at a seam**, not a continuous warp.

### Implications for implementation

- **#33** — do NOT draw a street on every Voronoi boundary (reads as confetti).
  Promote only the **major** boundaries to wider shared avenues; leave minor
  boundaries as the existing footprint gap. The heaviest promoted seams should
  align with / become the diagonals.
- **#34** — diagonals are the wedge/flatiron makers (DC, Chicago six-corners,
  the Flatiron). They are wide named avenues cutting across the grid.
- **Drift field (the held MED)** — real grid grain is **per-zone constant with a
  step at the seam**, not the current smooth radial ramp. The fix should make
  orientation **discrete per district** (bigger inter-district deltas) rather
  than a continuous distance-based bend. This upgrades the MED from "tweak
  GRID_RESIDUAL_SPREAD" to "give each district its own zone orientation."
- **Radial routes are FREEWAYS, not street-level spokes** (Houston, Columbus).
  Validates the rework: radial structure belongs to the **highway** tier
  (topology ring-radial), arterials stay as grid lines — the old street-level
  starburst was the bug.

## Gallery

### Seams — how grids meet

**San Francisco (downtown / SoMa).** Market St = one diagonal boulevard uniting
the off-cardinal downtown grid (NW) and the 45°-rotated SoMa grid (SE); local
streets T-junction into it from both sides. The textbook tiered seam.

![[San Francisco 1 California.jpg]]

**San Francisco (whole city).** Many neighbourhood grids at different
orientations (Sunset, Mission, the central diagonals) meeting at major streets
or breaking around hills/parks — a patchwork of large coherent zones, not a
smooth field.

![[San Francisco 2 California.jpg]]

**Manhattan (lower/mid).** One dominant Commissioners grid (~29° off cardinal);
the irregular older core sits below 14th; **Broadway** is the lone diagonal
slicing through and making wedge lots (the Flatiron).

![[Manhattan 1 New York.jpg]]

**Manhattan (upper).** The grid runs uniform for miles, stepping orientation
only at the north end; Central Park is a large void. Few, large zones.

![[Manhattan 2 New York.jpg]]

**Tokyo (Shibuya).** The non-American case: largely organic mesh structured by
rail corridors + arterials, only patchy local grids. Our grid-first model won't
mimic this, but it confirms major routes/rail as the structuring seams.

![[Tokyo Shibuya Japan.jpg]]

### Diagonals + wedge blocks (#34, Stage 7 flatiron)

**Washington DC (L'Enfant).** Orthogonal grid overlaid with radial diagonal
avenues meeting at circles/squares — triangular wedge lots at nearly every
diagonal×grid crossing. The prime reference for diagonals + the wedge archetype.

![[Washington DC.jpg]]

**Chicago.** Uniform elongated grid (~2:1 blocks) with diagonal arterials
(Milwaukee, Clybourn, Lincoln) cutting across and creating six-corner wedge
intersections.

![[Chicago Illinois.jpg]]

### Block proportions ([[block-proportions]])

**Savannah.** Colonial grid punctuated by the famous ward squares; moderately
elongated blocks, organic outskirts.

![[Savannah Georgia.jpg]]

(Manhattan ~3:1 and Chicago ~2:1 above confirm the elongated-rectangle bands;
near-square blocks are the exception.)

### Curvilinear / anti-grid + arterial spacing

**Phoenix / Sun City, AZ.** A rigid 1-mile arterial grid (arterials ~1.6km
apart) with local streets — including Sun City's concentric circular
subdivision — filling between. Shows arterial spacing + a curvilinear contrast.

![[Phoenix Sun City Arizona.jpg]]

**San Diego.** Downtown grid rotated ~45° to the bay meeting inland cardinal
grids; freeways + canyons break the fabric — another grid-seam case.

![[San Diego California.jpg]]

### Ring roads / scale (#14 — rings were too small)

**Columbus, OH.** Inner freeway belt + downtown grid; the full I-270 outerbelt
sits far outside this frame — beltways encircle the *whole* metro.

![[Columbus Ohio.jpg]]

**Houston.** Radial freeways spoking from downtown to the 610 Loop and beyond
(Beltway 8, Grand Parkway) — rings at true metro radius. Confirms **Ring A**
(push radius to the edge) and that a real beltway is even larger relative to the
core (the case for option B / partial-ring at bigger city scale).

![[Houston Texas.jpg]]

## OSM links (north-up, open to re-shoot)

| Place | OSM link |
|---|---|
| SF Market St | [map](https://www.openstreetmap.org/#map=16/37.7875/-122.4060) |
| Manhattan West Village | [map](https://www.openstreetmap.org/#map=16/40.7339/-74.0011) |
| Tokyo Shibuya | [map](https://www.openstreetmap.org/#map=15/35.6618/139.7041) |
| Chicago Loop + Lincoln Park | [map](https://www.openstreetmap.org/#map=15/41.8807/-87.6300) |
| Washington DC | [map](https://www.openstreetmap.org/#map=14/38.8951/-77.0364) |
| Houston (610 + Beltway 8) | [map](https://www.openstreetmap.org/#map=10/29.7600/-95.3700) |

## Background references

- **Figure-ground / Nolli plan** — solid/void mapping; the lens for block *fill*
  density (Stages 5–6). [Wikipedia](https://en.wikipedia.org/wiki/Figure-ground_diagram) ·
  [MORPHOCODE](https://morphocode.com/figure-ground-diagram/).
- **Orthogonal grids from above, 17 cities** — [ArchDaily](https://www.archdaily.com/949094/orthogonal-grids-and-their-variations-in-17-cities-viewed-from-above).
- **Street-network orientation & entropy** — [Boeing 2019](https://link.springer.com/article/10.1007/s41109-019-0189-1).
- **SF Market St history** (two grids → one diagonal boulevard) — [Wikipedia](https://en.wikipedia.org/wiki/Market_Street_(San_Francisco)).

## Cross-links

- [[plan-grid-first-rework]] · [[decision-grid-first-city-generation]]
- [[city-planning-references]] · [[block-proportions]] · [[voronoi-diagrams]] · [[taxicab-geometry]]
