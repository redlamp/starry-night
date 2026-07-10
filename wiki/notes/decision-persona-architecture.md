---
tags:
  - domain/procgen
  - domain/narrative
  - status/adopted
  - origin/external-research
---

# Decision: Persona System Architecture

2026-07-08, on `feat/personas` (worktree, off `fable`). The seeded human-persona layer: who lives and works in every building, generated deterministically from the master seed, presented as clickable character sheets with story hooks. Quality bar set by the user: "a well-received indie game" — Heat Signature-style hooks where the story lives in the player's mind. Research grounding: [[procgen-character-design-games]] + [[procgen-character-theory-literature]]. Design thesis: [[apophenia-engine]].

## Context

The city already derives everything from `masterSeed` via namespaced `seedrandom` streams; buildings carry stable `id` + `districtId`; `buildingPopulation()` estimates occupancy; the `::residents` sub-seed existed in `rng.ts` but was never used. No street names, addresses, or occupant data existed.

## Decisions

1. **Module layout** (all in `lib/seed/`, mirroring `population.ts` conventions):
   - `personaData.ts` — static datasets: 50+50 first names (decade-ordered for cohort dating), 100 census surnames, 200 BLS-grounded professions (category, education tier, workplace type), zodiac tables (western + Chinese), MBTI axis weights, ethnicity weights, education labels.
   - `naming.ts` — city identity (name, university, hospital, paper, transit line), district proper names by character ("The Foundry", "Alder Heights"), street names (tier-appropriate suffixes, per-city theme weights, downtown ordinals), US-style addresses (hundreds-per-block along nearest non-highway road, side parity, collision bump), building names by archetype probability.
   - `personas.ts` — the directory build, 5 passes: households → businesses → employment weave → dating weave → story weave.
   - `personaStory.ts` — authored template pools + `weaveStories()` + `siftBuilding()`.
2. **Own rng streams only**: `${seed}::personas::*`, `${seed}::names::*`. Existing generators' draw order untouched — `scripts/cityGolden.ts` stays byte-identical (verified).
3. **Eager whole-city build, module-cached** with the shared cache-key recipe (`seed::shape::scale::extent::sketch::deviation::densityProfile`). ~500 ms cold at the 6 km tier (23.5k personas), 0 ms warm. Address pass uses a 150 m spatial hash over road segments (brute force was 19 s). *(Update 2026-07-10: the #93 multi-household re-roll grew the population to 39.4k; measured 2246 ms cold at the 6 km tier before the lazy split — see [[persona-gen-performance]] and `feat/persona-perf`.)*
4. **Featured, not census**: households per building = `clamp(pop/40, 1, 6)`; the panel shows both "Est. Population ~276" and the featured households. Personas are "the residents whose windows you happen to look into."
5. **Relationships**: primitives only in-household (partner/parent/child/sibling links, reciprocal); city-wide weaves are deterministic passes — employment (kind → title-affinity → category-affinity → open ladder, so dentists land at "{F} Dental" and bellhops at hotels) and dating (seeded shuffle + greedy compatible pairing across buildings). Off-stage relatives are name-only stubs (deliberate negative space).
6. **Story layer** applies the research principles: authored template pools scoped to 16 life clusters; fields `epithet / wasIs / whyAwake / detail / refusal / hook / relation`; ~15 shared city-lore nouns; one legend persona per city; per-household hook+whyAwake dedupe; per-building epithet dedupe; the sheet always ends on the hook. Template authoring rules: concrete nouns, no emotion words, no "because", never resolve.
7. **Stereotype separation** (from the name-bias literature): ethnicity influences surname *only* (soft 70% affinity); profession weights key off district character *only*; name pools and income band never condition each other.
8. **UI**: `BuildingInfoPanel` gains building name, address, proper district name, `siftBuilding()` curation line, businesses + households (clickable members). New `PersonaPanel` (bottom-right) is the character sheet; family/partner/relation lines navigate between sheets; Go Home / Go to Work reuse `focusBuilding`. Only `selectedPersonaId` enters Zustand (runtime tier).
9. **Fixed in-world date** `CITY_EPOCH` (2026-07-01) for ages — never `Date.now()` (the city is one endless night).

## Known simplifications

- Chinese zodiac keys off calendar year (Lunar New Year boundary ignored — Jan/early-Feb birthdays can be one animal off).
- Name cohort-dating is pool-halving, not SSA-weighted tables (upgrade path in [[personas]]).
- Dating pairing is orientation-simplified; cross-building *family* links don't exist yet (only off-stage stubs).
- Directory builds on the main thread on first panel open (~0.5 s worst tier); worker offload if it ever shows. *(Update 2026-07-10: this had regressed to building synchronously at page mount — `EntityColumns` called `useEntityIndexes()` before its `if (!open) return null` gate, so the hook fired on every mount. Fixed on `feat/persona-perf` by moving the build behind the actual open-gate with a shadcn Skeleton placeholder; deep tier — flavor/astrology/MBTI and story hooks/relations — is now lazy per persona/building rather than built eagerly for the whole city. See [[persona-gen-performance]].)*

## Verification

`scripts/personaCheck.ts` — dataset counts, same-seed determinism, cross-seed divergence, reciprocal partner/family links, employee-list consistency, age sanity, hook/whyAwake presence, no leaked `{slot}` braces, lore count; prints sheets for the human "fanfic test". Plus typecheck, lint, golden PASS, CDP screenshot of both panels live.
