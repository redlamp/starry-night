---
tags:
  - domain/personas
  - domain/city-gen
  - status/adopted
---

# Decision: "Listed" — the term for detailed residents, and the full-capacity city frame

**Date**: 2026-07-18
**Status**: adopted (user can veto — pure UI copy, cheap to change). Issue #96.

## Context

The persona directory holds ~41.6k residents at the 6 km tier, but the buildings' capacity model says the city holds ~326k people. The directory was presenting its featured subset as if it were the whole town. #96 reframes: the simulated personas are a detailed *sample* of a larger city whose scale is derived from the built environment.

## The term

**Listed.** As in a phone-book listing: "39,412 listed residents", "6 listed of 34 employees", "Listed Residents" column stats. Chosen 2026-07-18 while the user was away (they asked for a term proposal; awake/away framing was considered and rejected by them as state-, not coverage-based).

Rejected alternatives:

- **featured** - already in code comments, but reads editorial/showbiz in UI copy.
- **profiled** - census-accurate but carries surveillance connotations.
- **known / documented** - immigration-adjacent baggage.

Code comments may still say "featured"; user-visible copy says "listed".

## The numbers behind the frame

All in `PersonaDirectory.city` (lib/seed/personas.ts), derived per seed, no rng:

- **population** - sum of `buildingPopulation()` over residential archetypes (full capacity, not the household-capped persona estimate).
- **households** - population / 2.4 (same mean the persona pass assumes).
- **jobs** - sum of every business's `totalHeadcount` (the seeded full-headcount estimate formerly private to tenancy-layout sizing, now first-class on `Business`). Lands near 1.1 jobs per resident - a core-city ratio (DC/Boston), staffed by unlisted in-commuters.
- **establishments** - jobs / 16, floored at the listed business count; unlisted establishments read as smaller outfits.

Display uses `approxCount()` (lib/utils.ts) - magnitude-scaled rounding so estimates read as census figures ("~325,500"), while listed counts stay exact.
