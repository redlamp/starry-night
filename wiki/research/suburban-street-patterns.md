---
tags:
  - domain/city-gen
  - origin/external-research
---

# Suburban Street Patterns — Taxonomy + Dimensions

2026-06-08 · grounding for the #49 Stage-2 redo (user: "lots of circles, no
kidney bean / bezier curve roads… reference real suburban planning and maps").

## The Southworth & Ben-Joseph taxonomy (2003)

Five canonical residential street patterns, in rough chronological order:

1. **Gridiron** (1900s) — the core grid we already trace.
2. **Fragmented parallel** (1930s) — grid broken into runs, T-junctions.
3. **Warped parallel** (1950s) — gently curved parallels, streetcar-suburb feel.
4. **Loops and lollipops** (1960s) — collector + LOOP streets (two access
   points, bulging through the block) + cul-de-sacs. The classic post-war
   subdivision; "one must always leave via the collector".
5. **Lollipops on a stick** (1980s) — a single spine collector with culs
   hanging off it; sealed interior, 1–2 entrances.

Sources: [taxonomy figure](https://www.researchgate.net/figure/Types-of-street-patterns-Source-Southworth-Ben-Joseph-2003_fig1_235005201),
[Reconsidering the Cul-de-sac (ACCESS 24)](https://accessmagazine.org/spring-2004/reconsidering-cul-de-sac/),
[crash-severity comparison](https://ctrf.ca/wp-content/uploads/2014/07/RifaatTay2008.pdf).

## Dimensions (US subdivision standards)

- Cul-de-sac max length ~700 ft (**≈210 m**) suburban, ~1000 ft (≈300 m)
  rural; turnaround bulb 50 ft Ø.
- Street mouths off a major: ~250 ft (**≈76 m**) opposing-side spacing,
  ~500 ft (≈152 m) same-side → stations every ~75–150 m.
- Loop streets: two access points, longer than culs; block depths between
  parallel runs ~60–120 m.
- Intersections as near to right angles as practical.

Sources: [VDOT Subdivision Street Design Guide](https://www.vdot.virginia.gov/media/vdotvirginiagov/doing-business/technical-guidance-and-support/land-use-and-development/subdivision-street-requirements/appendb.pdf),
[Miami County subdivision standards](https://www.codepublishing.com/KS/MiamiCounty/html/MiamiCountySUB/MiamiCountySUB05.html),
[Grammenos & Pogharian, Residential Street Pattern Design](https://realestate.wharton.upenn.edu/wp-content/uploads/2017/03/389.pdf).

## What this means for the generator

- **No concentric rings.** A radial tensor basis traces bullseyes; real
  subdivisions are loops/culs hung off a collector. The curve shapes are
  low-curvature splines (bezier-like), curvature varying along the street.
- **Connectivity is by construction**: collector anchored to the arterial
  network, loops anchored twice to the collector, culs once. Nothing floats.
- **Hierarchy**: arterial → collector (1–2 mouths per subdivision) → loops →
  culs. Interior is sealed — you cannot drive straight through.
- Pattern mix by era/density: warped parallel reads inner-suburb; loops +
  lollipops outer; lollipops-on-a-stick rural edge.

Relates: [[plan-suburb-node-fields]], [[decision-density-gradient-model]].
