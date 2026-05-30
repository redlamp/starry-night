---
tags:
  - domain/3d
  - status/verified
  - origin/external-research
---

# Block Proportions — Real-World References

Research note feeding issue #33 (grid-first block formation) and a future GRAMMAR aspect-ratio tweak. The core problem: current GRAMMAR values produce near-square blocks (e.g. downtown 55×48 ≈ 1.15:1, residential 82×62 ≈ 1.32:1) that read as unrealistically compact. Real city blocks are almost universally elongated rectangles with a clear long axis, and that elongation is load-bearing for legibility.

## Key insight up front

> Most city blocks have a **dominant long axis** (the frontage street runs along the short dimension; the alley or mid-block runs along the long). Elongation **1.5:1 to 3:1** is the North American norm. Near-1:1 blocks are the exception — Portland's famously square grid and Barcelona's chamfered Eixample squares are the canonical outliers, not the rule.

The perceptual effect: elongated blocks make the street network readable (you can tell which streets are the major frontage streets vs the cross-streets). Square blocks flatten that hierarchy.

---

## Real-world block dimensions by city

All dimensions are approximate face-to-face measurements (kerb to kerb across the block interior, not including street widths). Aspect ratio = long side ÷ short side.

### Manhattan (New York, NY)

- **Short side (cross-street spacing):** ~80 m (about 264 ft; one standard avenue block)
- **Long side (avenue-to-avenue):** ~240–270 m (roughly 790–880 ft; one standard block between avenues)
- **Aspect ratio:** ~1:3 (3:1)
- The Commissioners' Plan of 1811 deliberately chose this extreme ratio to maximise frontage on the numbered cross-streets. The long axis runs east–west; avenues are the minor-spacing direction north–south.
- Below 14th Street the grid dissolves into smaller, irregular blocks (West Village ~60×90 m, Financial District even smaller and irregular).

### Chicago, IL

- **Short side:** ~100 m (one standard Chicago block = 660 ft ÷ ~2.5 blocks per km)
- **Long side:** ~200–210 m (eight standard Chicago blocks per mile = ~201 m/block along the long direction)
- **Aspect ratio:** ~1:2
- The Chicago standard ("eight blocks to the mile") is widely cited in American urban planning. Downtown Loop blocks are somewhat smaller (~85×170 m). Residential blocks in Lincoln Park / Wicker Park follow the same ~100×200 m module.

### Salt Lake City, UT

- **Short and long side:** ~200 m square (~660 ft, ten-chain Plat of Zion)
- **Aspect ratio:** ~1:1 (unusually large squares)
- Brigham Young's Plat of Zion deliberately produced oversized square blocks. Notable as an extreme outlier — the large size means perceived density is still low even in "downtown." Not a model for our residential/downtown bands.

### Portland, OR

- **Side:** ~60 m (~200 ft) near-square
- **Aspect ratio:** ~1:1
- Portland's extremely small square blocks are a deliberate walkability experiment (1866 survey, Thomas & Elliott). Famous precisely *because* they are square and tiny. Another outlier: used as a heritage/oldtown model, not a general reference.

### Barcelona Eixample (Spain)

- **Block face:** ~113 m per side (chamfered square, ~45° corners cut at ~20 m)
- **Aspect ratio:** ~1:1 (square, but chamfered)
- Cerdà's 1859 plan. The chamfering is the distinguishing feature — each intersection opens up into an octagonal plaza. Very recognisable from above but functionally near-square.

### Savannah, GA (and other colonial/heritage grids)

- **Ward block (residential trust lot):** ~75 m × 90 m (~1.2:1)
- **Micro-blocks within wards (the "tything" lots):** ~37 m × 55 m
- More elongated than Salt Lake City but still relatively compact. Heritage districts lean toward 1.2:1 to 1.5:1.

### Washington DC

- **Standard block:** ~85 m × 170 m (~1:2)
- L'Enfant grid; diagonal avenues slice the grid and create triangular wedge blocks at intersections.

### Typical North-American bands (synthesised)

| District type | Typical block size (m) | Aspect ratio | Notes |
|---|---|---|---|
| Dense downtown / financial | 70–90 × 170–270 m | 1:2 to 1:3 | Manhattan archetype; cross-streets tight, avenue spacing wide |
| Sub-centre / secondary CBD | 85–110 × 150–200 m | 1:1.5 to 1:2 | Chicago-style loop edges |
| Heritage / old core | 50–80 × 60–100 m | 1:1.2 to 1:1.6 | Smaller, more irregular; Portland/Savannah range |
| Residential inner | 80–110 × 130–180 m | 1:1.5 to 1:2 | Row-house frontage on short side; rear alley on long |
| Residential outer | 100–140 × 160–220 m | 1:1.5 to 1:1.8 | Longer blocks, occasional dead-ends |
| Mixed-use / transitional | 80–100 × 130–160 m | 1:1.5 to 1:1.7 | Often converted residential fabric |
| Industrial / warehouse | 120–180 × 200–350 m | 1:1.5 to 1:2.5 | Long axis parallel to rail or highway; loading-dock depth |

### The long-axis rule

In a standard rectilinear grid the long axis of a block runs **parallel to the primary (major) street direction** — the street that defines the block's frontage address. Buildings face the short ends of the block (the cross-streets). Alleys, if present, run down the midline of the long axis. This is why elongated blocks reinforce street hierarchy: the long axis *is* the arterial direction.

In a rotated or patchwork grid (as per [[decision-grid-first-city-generation]]) the long axis should align with the dominant local grid orientation θ (the W dimension in GRAMMAR) so the short depth D is perpendicular to the street. The terms `blockW` (width along street) and `blockD` (depth perpendicular to street) in `cityGen.ts` already encode this convention — W should be the long dimension in most characters.

---

## Diagnosis of current GRAMMAR values

Current values in `lib/seed/cityGen.ts`:

| Character | blockW | blockD | Ratio W:D | Real-world target | Gap |
|---|---|---|---|---|---|
| `downtown` | 55 | 48 | 1.15:1 | 2:1 to 3:1 | Far too square |
| `subcentre` | 60 | 50 | 1.20:1 | 1.5:1 to 2:1 | Too square |
| `heritage` | 38 | 32 | 1.19:1 | 1.2:1 to 1.5:1 | Marginally OK; could use mild elongation |
| `residential` | 82 | 62 | 1.32:1 | 1.5:1 to 2:1 | Noticeably short |
| `industrial` | 115 | 85 | 1.35:1 | 1.5:1 to 2.5:1 | Short |
| `mixed-use` | 64 | 52 | 1.23:1 | 1.5:1 to 1.7:1 | Short |

The whole table is compressed into a narrow 1.15–1.35 band. The fix is not to scale both dimensions uniformly — it is to **widen the ratio by shrinking D (depth) relative to W (width)** while keeping W (the frontage dimension) roughly anchored to the existing street-spacing logic. Shrinking D also opens up the cross-street more (the "streetD" channel), which benefits the visual read.

---

## Recommended per-character aspect bands

Expressed as W:D target range. W (frontage, long axis) stays close to current values; D (depth, short axis) is reduced. The `streetD` complement can absorb part of the freed space.

| Character | Current W×D | Recommended W×D | Target W:D ratio | Long-axis alignment |
|---|---|---|---|---|
| `downtown` | 55×48 | 55×22–28 | 2:1 to 2.5:1 | W parallel to primary arterial direction (θ) |
| `subcentre` | 60×50 | 60×30–38 | 1.6:1 to 2:1 | W parallel to θ |
| `heritage` | 38×32 | 38×24–28 | 1.35:1 to 1.6:1 | Irregular; jitter may already break symmetry enough |
| `residential` | 82×62 | 82×42–52 | 1.6:1 to 2:1 | W parallel to θ |
| `industrial` | 115×85 | 115×55–70 | 1.6:1 to 2.1:1 | W parallel to rail/highway (may diverge from θ) |
| `mixed-use` | 64×52 | 64×36–44 | 1.45:1 to 1.8:1 | W parallel to θ |

**Street clearance note:** current `streetD` values (10–22 m) will need a small upward adjustment — as D shrinks, the cross-street channel must not become wider than intended. A workable formula: `streetD_new ≈ streetD_old + (blockD_old − blockD_new) × 0.3` to redistribute roughly 30% of the freed depth as extra street room.

---

## How to apply in grid-first block formation (issue #33)

**Do not mutate the legacy GRAMMAR table blindly.** The current GRAMMAR drives both the legacy stripe-fill path and the new grid-first lattice; a naive resize breaks gate1's building-count assertion (which is seeded and deterministic). The recommended approach:

1. **Add a `blockAspect` range to each `CharacterGrammar` entry** (e.g. `aspectMin: 1.6, aspectMax: 2.5`) instead of hard-coding `blockD`. The grid-first block formation step samples this range per block (seeded).
2. **Derive `blockD = blockW / sampledAspect`** inside `districtBlocks()` (or its grid-first replacement) rather than reading a fixed `grammar.blockD`. This leaves `blockW` and `streetW/D` unchanged so the lattice column spacing stays deterministic.
3. **Keep the legacy path using the hard-coded `blockD`** (flag-guarded, same as the `useGrid` sentinel). This preserves byte-identical output for the flag-off branch and avoids breaking gate1 until the grid-first path is verified.
4. **Validate with gate1 and a 16-seed `/plan` grid** before flipping the flag. In particular, the OBB overlap test and the `depthBudget = b.d - 2` constraint in `fillStripe()` both depend on D — verify that narrower blocks don't collapse the stripe budget below `min(6, ...)`.
5. **The long axis must align with the grid orientation θ** at each block, which is already satisfied by the existing `cosR/sinR` rotation in `districtBlocks()`. No change needed there; the geometry is correct once the ratio is fixed.

---

## Links / sources

- **Manhattan block dimensions**: NYC Department of City Planning, *Manhattan Street Network*; also Steuteville, R. (2015) "The standard block size", Congress for the New Urbanism.
- **Chicago block standard**: City of Chicago Department of Planning and Development; Miles, J. (2021) "Chicago's Grid" — eight blocks to the mile = 201 m/block.
- **Salt Lake City Plat of Zion**: Lyman, E.L. (1994), *Political Deliverance*; Utah AGRC parcel data.
- **Portland 200-ft blocks**: Portland Bureau of Transportation; Duany, Plater-Zyberk & Speck (2000), *The New Urbanism*.
- **Barcelona Eixample**: Cerdà, I. (1867), *General Theory of Urbanization*; reproduced in Aibar & Bijker (1997), "Constructing a City."
- **Savannah ward system**: Reps, J.W. (1965), *The Making of Urban America*, Chapter 8.
- **Washington DC**: NCPC, *DC Comprehensive Plan*, Street Network chapter.
- **General synthesis**: Southworth, M. & Ben-Joseph, E. (2003), *Streets and the Shaping of Towns and Cities*, Island Press. Chapter 3 ("The Grid and Its Variants") includes a comparative block-size table across US cities.
- **OSM/GIS data**: see [[city-planning-references]] §GIS for query options if empirical validation is wanted.

---

## Cross-links

- [[decision-grid-first-city-generation]] — the block formation this feeds (issue #33 is the implementation ticket)
- [[city-planning-references]] — companion reference for grid patterns, diagonal arterials, multi-grid patchwork
- [[building-sizes-real-world-references]] — archetype footprint sizes that must fit inside these blocks
