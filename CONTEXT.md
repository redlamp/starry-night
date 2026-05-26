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

First-class major surface road. Polyline, straight or near-straight. 3–6 per seed. Buildings excluded from corridor (narrower than Highway). Cluster centers nucleate preferentially at arterial intersections (high betweenness). Real planning term from FHWA functional classification.

### Network topology

The macro shape of the highway + arterial network for a given seed. Drawn from a fixed library: *Crossroads*, *Bypass*, *Ring*, *Ring + radial*. Determines where the network's high-betweenness nodes are, which in turn determines where clusters can plausibly nucleate. Each topology has its own real-world reference family (Crossroads ≈ American mid-size; Bypass ≈ interstate era; Ring ≈ Moscow / Beijing; Ring + radial ≈ Paris / Tokyo).

### Local street

Implicit street — the gap between adjacent blocks. Not a first-class primitive; block boundaries are local-street centerlines. Invisible as geometry at orbit distance.

Collector-tier streets (FHWA classification between arterial and local) are folded into *Arterial* for v1.

## Out of scope (deferred to in-city camera milestone)

Street-level concepts — setbacks, FAR, lot coverage, fenestration, ground-floor commerce, sidewalk widths, awnings — do not survive at orbit distance and are deliberately absent from v1 grammar.
