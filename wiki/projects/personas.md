---
tags:
  - domain/procgen
  - domain/narrative
  - status/open
---

# Personas — Seeded Residents & Story Hooks

Standing goal (2026-07-08): character generation at indie-game production quality — Heat Signature-level hooks; keep researching, testing, iterating. Branch `feat/personas` (worktree `C:\workspace\starry-night-personas`, off `fable`). Architecture: [[decision-persona-architecture]]. Research: [[procgen-character-design-games]], [[procgen-character-theory-literature]].

## Shipped (v1, 2026-07-08 overnight)

- Datasets: 100 first / 100 last names, 200 professions, zodiac (western + Chinese), MBTI, ethnicity, education.
- Naming: city identity, district proper names, street names, addresses, building names.
- Directory: households (7 compositions incl. multigen/widowed-elder), demographics, education, employment (affinity ladder), cross-building dating weave, family links, off-stage stubs.
- Story: 16 life-cluster template pools (~130 authored lines), city lore (~15 nouns), epithets, was/is, whyAwake, details, refusals, one-sided relations, hooks, legend persona, `siftBuilding` curation.
- UI: BuildingInfoPanel occupants section + PersonaPanel character sheet with sheet-to-sheet navigation and camera fly-to.
- Verification: `scripts/personaCheck.ts` (determinism + invariants + fanfic-test sample), golden untouched, typecheck/lint clean, CDP capture (`samples/personas/panels.png`).

## Shipped (round 2, 2026-07-08 early morning)

- **SSA cohort name tables** (`lib/seed/nameCohorts.ts`): birth-decade-weighted real SSA data, exactly one rng draw per name.
- **Domain words**: one obsession-noun per persona (32-noun pool, per-building dedupe) threaded through domain detail/hook/epithet pools — ~6.4k sheets repeat their noun.
- **Cross-building family weave**: adult children ↔ parents across town, surname + age-gap matched, reciprocal links (3,472 at the 6 km tier).
- **City Directory panel** (settings drawer): city stats, seeded resident-of-the-night spotlight + Next, name search, district → building browse tree.
- **Commute layer**: deterministic walk/cycle/transit/drive per employed persona; mode-coloured x-ray arc home→work on selection (`CommuteArc.tsx`); Commute row in the sheet.
- **Road hover**: inspect-mode street chip (name, tier, buildings-on-street) + x-ray road highlight via `roadQueryFor` segment grid (`RoadHover.tsx`); query verified headless, hover feel = user gate.
- Audit-driven pool growth (`scripts/personaAudit.ts`): hook max-repeat 857 → 591.

## Shipped (round 3-4, 2026-07-08 morning, live with user)

- **Entity columns** ([[decision-entity-columns]]): Miller-columns drill, three views (side-by-side / 3D deck / collapsed), branch-preserving back/forward, deck tab slivers + height tween, two-row headers (wrapping titles), stacked stat rows for long values, shadcn tooltips + trait hover cards.
- **Schools**: 71 per default seed (elem per district / middle per ~3 / high per ~5), 100% enrollment by nearest tier, walk/bus commutes, teachers via employment ladder.
- **Cone / Follow Locations**: header toggle framing the top card's full location set (fill-frame fit, p85 radius); employment arcs (workplace→employee homes) for building/company cards; commute + connection arcs for personas.
- **Focus framing**: 45° look-down, 33% display height for single-building focus.
- **/writing-lab**: editorial workbench over all ~50 content pools / ~947 entries — author (ai/human/edited) + status (draft/review/final/cut) per entry, inline editing, localStorage + copy-as-TS ship path. Design pass in flight (Lokalise-style IA, dropdown cells, resizable columns).

## Presentation options (proposed, not yet built)

1. ~~City directory panel~~ — shipped round 2 (above).
2. **District census cards** — extend DistrictsPanel rows: population, featured count, top professions, its lore entries.
3. **Business directory** — the phone-book view: businesses by district with staff lists.
4. **Lore index** — the ~15 city lore nouns as clickable entries listing every persona whose sheet touches them (the "everyone remembers the blackout" view).

## Finding people in the world (proposed)

1. **Window-level assignment** — map households to window rows (unit floor ↔ texture row); clicking a *window* (not just a building) opens that household; persona sheet highlights their actual window.
2. **Schedule-driven lights** — drive per-window lit state from resident schedules; author near-miss pairs (his light dies as hers wakes). The Majora's Mask trick, zero text.
3. **Storylet reveal** — deeper facts unlock on revisit (visit count in runtime state): first click name + hook, later visits add detail/refusal/relation.
4. **Relation trails** — the one-sided relation line already navigates to the target; add a subtle camera line/arc drawn between the two buildings while both sheets are open.
5. **Night walkers** — tie personas to the existing traffic/pedestrian systems (the rideshare driver's car is an actual car entity).

## Iteration backlog (research-ranked)

1. ~~Domain word~~ — shipped round 2.
2. ~~SSA cohort-dated name tables~~ — shipped round 2.
3. **Schedule → window lights** (needs renderer work; biggest payoff of all: the fiction becomes visible).
4. ~~Cross-building family~~ — shipped round 2.
5. **Gossip/knowledge implantation** (Talk of the Town) — who knows whom, one deterministic pass; enables "ask the neighbor about X" surfaces.
6. **Expression-tier audit** (oatmeal gate): expressive-range analysis over a few hundred sheets; grow thin pools (day-shift whyAwake, generic hooks) where repetition shows.
7. ~~Worker offload of the directory build if first-open hitch shows on low-tier devices~~ — deferred-build + lazy-deep-tier landed first instead (`feat/persona-perf`, 2026-07-10): mount-gate fix + Skeleton behind the directory/columns open gate, plus lazy per-persona `personaFlavor()` and per-building `ensureBuildingStories()`. See [[persona-gen-performance]]. Worker offload remains parked behind re-measurement of the post-lazy cold build.
8. Persona → traffic/flights tie-ins (the 4 a.m. ferry could *exist*).

## Open questions

- Should personas persist across city-size tier changes? (Currently keyed to extent like everything else — same seed at a different tier is a different city.)
- Kids' story pools: how dark is too dark for the ambient tone?
- Rare "hand-authored resident" slots (RimWorld backer-pawn model) — worth a JSON of ~10 fully-written residents seeded rarely?
