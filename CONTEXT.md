# Starry Night — Domain Glossary

Canonical terms for the city-planning and rendering domain. No implementation details — see `docs/PRD.md` and code for those.

## Spatial / planning

### District

A bounded perceptual area of the city. The *named place* unit. Real-world examples: Financial District, Theater District, Old Town, Lower East Side, Lujiazui. Composed of many polygons, bounded by *Highways* + map edges; *Arterials* run through a district, not between them.

A district carries:

- **Character** — its dominant planning flavour. One of: *Downtown high-rise*, *Subcentre high-rise*, *Heritage*, *Residential*, *Industrial*, *Mixed-use*.
- **Identity** — optional. *Downtown* (at most one per city) or *Subcentre* (0–N per city) attaches to districts of high-rise character. Background-character districts don't carry identity.
- **Silhouette template** — only when character is high-rise. Drawn from the template library.

District character determines the *bias* of its zones — a Residential district is mostly Residential-zoned polygons but can contain Commercial corner polygons. A high-rise district is mostly Commercial / Mixed-use zoned.

### Zone

The land-use category of a single polygon. Applied to every polygon, regardless of district. Four categories:

- *Residential* — housing-dominant
- *Commercial* — offices, retail
- *Industrial* — manufacturing, warehousing, freight access
- *Mixed-use* — explicit overlap of two or more

Zone determines archetype mix, base height-cap, and lighting profile bias for the polygon. District character biases the *distribution* of zones inside the district, but each polygon's zone is decided polygon-wise.

Industrial polygons preferentially appear at district edges adjacent to highways or map perimeter (real planning: industrial seeks freight access and cheap land).

### Downtown

The **primary planning identity** of a cluster — the city's central business / civic district. Marks intent (where the city imagines its commercial centre to be), not built form. A downtown can be low (Shanghai's Bund, historic European cores) or tall.

A city has 0–1 *Downtowns*.

### Subcentre

A **secondary planning identity** — a non-primary commercial heart. Real cities are routinely polycentric: Tokyo's Shinjuku and Shibuya (副都心 *fukutoshin*) are subcentres relative to Marunouchi.

A city has 0–N *Subcentres*. Distinct from *Downtown* in role; a subcentre can carry any silhouette template.

### High-rise cluster

A **built-form** descriptor — a cluster whose silhouette is dominated by towers. Independent of planning identity:

- La Défense is a high-rise cluster but not Paris's Downtown
- The Bund is Shanghai's historic Downtown but not a high-rise cluster
- Lujiazui (Pudong) is both Pudong's Subcentre and a high-rise cluster

A city can have multiple high-rise clusters. Polycentric height grammar is built from this.

### Silhouette template

The skyline-shape that a high-rise cluster takes. Drawn per-cluster from a fixed library:

- **Tabletop** — uniform tall heights with sharp boundary falloff. Default shape. Reference: Manhattan Midtown, Chicago Loop.
- **Wedding cake** — radial step-down from centre to edge. Real planning term, from NYC 1916 Zoning Resolution setback regulations. Reference: pre-war NYC, Tokyo Marunouchi.
- **Twin-peak** — two near-equal peaks with valley between. Reference: Hong Kong IFC + ICC, Petronas, pre-2001 WTC.
- **Landmark** — one dominant tower 1.7–2.2× the rest. Term from Kevin Lynch, *Image of the City* (1960). Rare. Reference: Frankfurt Mainhattan, Shanghai Lujiazui, Dubai DIFC.

Template prevalence is weighted (Tabletop most common, Landmark rare); weights are tunable from still-frame samples.

## Road network

### Highway

First-class limited-access road. Polyline, may curve. 1–2 per seed (possibly including one ring/loop). Buildings excluded from corridor. Reference: motorways, interstates, expressways. Real planning term — *freeway* / *motorway* / *expressway* depending on country; *Highway* used here as the cross-region neutral name.

### Arterial

First-class major surface road: the **heavy through-streets of the grid** — wider, longer-running grid lines that carry traffic across districts. Straight or near-straight, follows the grid orientation. Buildings excluded from corridor (narrower than Highway). Real planning term from FHWA functional classification.

_Avoid_: radial spoke, starburst arm. An arterial is **not** a line radiating from a central point — that hub-and-spoke pattern is a removed bug, not the definition.

### Network topology

The macro shape of the highway + arterial network for a given seed. Drawn from a fixed library: *Crossroads*, *Bypass*, *Ring*, *Ring + radial*. Determines where the network's high-betweenness nodes are, which in turn determines where clusters can plausibly nucleate. Each topology has its own real-world reference family (Crossroads ≈ American mid-size; Bypass ≈ interstate era; Ring ≈ Moscow / Beijing; Ring + radial ≈ Paris / Tokyo).

### Local street

The fine lines of the **Street grid** — gaps between adjacent blocks. Block boundaries are local-street centerlines. Reads at orbit distance only as the dark gaps between lit blocks. Collector-tier streets (FHWA classification between arterial and local) are folded into *Arterial* for v1.

### Street grid

The continuous platted grid that is the **primary network substrate** — laid before buildings, shared across the city. *Arterials* are its heavy lines; *Local streets* its fine lines. Districts are zones painted over the grid; blocks are its cells. Connectivity is structural: every street meets every cross-street.

### Seam street

The boundary street where two *District* grids of different orientation meet (Patchwork model). A real street that absorbs the angle change so neighbouring grids stitch instead of clashing. Often promoted to an *Arterial*.

### Legacy diagonal

A rare (0–3 per city) pre-grid road that survives and cuts across the grid at an angle, crossing grid lines at real intersections. Reference: Broadway (Manhattan), Chicago plank-road avenues, Detroit's Woodward. The only sanctioned non-grid surface line — the controlled source of diagonal interest, distinct from the removed radial *starburst*.

### Cross-hatch (anti-pattern)

The failure mode to avoid: road segments that form isolated "+" crossings which don't line up into a continuous network — scattered, like cross-hatching in a drawing, rather than a connected street plan. Cause is *intersection-first* generation (place crosses, hope the stubs meet). Forbidden structurally by the **lines-first** rule: roads are continuous lines, and intersections + blocks are emergent overlaps of those lines, so every street connects by construction. See [[decision-streets-first-city-generation]].

_Avoid_: hash (earlier informal name for this; ambiguous, retired in favour of *cross-hatch*).

## Built form

### Window proportion

The per-building glass-to-wall character: how large the lit windows are relative to their facade cell, and how widely the window grid is spaced. Keyed to *Archetype*, with an *age* modifier from *Heritage* districts. Reference reads:

- **Towers** (spire, narrow-tower, office-block) — near-full curtain-wall glass; fine, tightly-spaced mullions.
- **Warehouse / industrial** — wide, short window bands; few, broad bays.
- **Heritage / low-rise (older)** — small punched windows with a lot of surrounding wall.

A deliberately coarse, archetype-level form of *fenestration* — admitted to v1 because windows demonstrably read at orbit distance. Street-level fenestration detail (individual mullion patterns, ground-floor glazing, spandrels) remains out of scope.

### Flatiron / wedge building

A tapered building that fills a triangular lot left where a *Legacy diagonal* or steep *Seam street* cuts the grid. Kept as a **four-sided trapezoidal box** — one short end face (fewer window columns across it) and two slightly slanted sides — rather than a true triangular prism, so it reuses the standard per-face window machinery unchanged. **Downtown only**: anomalous wedges are admitted in the dense core where diagonals slice the coherent grid; in outer / residential grids the leftover slivers stay open (plaza / park) instead. Reference: Manhattan Flatiron, Times Square wedges.

## Out of scope (deferred to in-city camera milestone)

Street-level concepts — FAR, lot coverage, ground-floor commerce, awnings, and fine fenestration detail — do not survive at orbit distance and are deliberately absent from v1 grammar. Two limited exceptions are now in scope because they read at orbit distance: archetype-level *Window proportion* (see Built form), and a **coarse sidewalk setback** — a small, consistent per-zone frontage gap (~2–8 m, wider in high-foot-traffic cores) that makes buildings form a street wall set back from the kerb. The earlier 15–30 m standoff was a corridor-rejection bug, not a sidewalk.
