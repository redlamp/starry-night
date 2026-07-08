---
tags:
  - domain/procgen
  - domain/narrative
  - status/verified
  - origin/external-research
---

# Procgen Character Theory — Academic & Professional Literature

Academic/theory beat companion to [[procgen-character-design-games]]. Researched 2026-07-08. Feeds [[decision-persona-architecture]] and the [[personas]] iteration backlog.

## The closest system to ours: Talk of the Town / Bad News (James Ryan)

Procedurally generated American small town — residents with jobs, homes, families, and full **knowledge/gossip models**. Definitive writeup: [Game AI Pro 3, Ch. 37](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter37_Simulating_Character_Knowledge_Phenomena_in_Talk_of_the_Town.pdf).

- **Belief facets**: each character holds mental models of others `{facet, value, source chain, strength, accuracy}` — beliefs form on co-location, mutate (brown hair misremembered as gray), deteriorate, get lied about.
- **The cheap trick for us — post-generation knowledge implantation**: don't simulate years; implant beliefs at world-gen (family p=1.0, others by salience). Perfect for a deterministic seeded generator.
- [Bad News](https://www.badnewsgame.com/overview): an actor improvises every resident from the sim's ground truth — proof a generated town supports an hour of serious engagement with **no verbs but discovery** (find the next of kin ≈ our click-a-building loop).
- Ryan's dissertation ["Curating Simulated Storyworlds"](https://escholarship.org/content/qt1340j5h2/qt1340j5h2.pdf): raw sim output has no story shape — a **curator must sift**. Story sifting = pattern-match facts against templates ("two residents who used to date"). → our `siftBuilding()`.

## Prom Week / Comme il Faut

[AIIDE 2011](https://cdn.aaai.org/ojs/12454/12454-52-15982-1-2-20201228.pdf). Four-layer state (traits / statuses / relationships / directed scalar values) + **Social Facts Database** (permanent event log — rules can reference history) + volition = summed rule weights. Scale warning: playable social physics took ~4,900 rules; discovery-only needs a small fraction — legible desires, not playable ones.

## Oz Project (Bates/Loyall, CMU)

[Papers](https://www.cs.cmu.edu/afs/cs.cmu.edu/project/oz/web/papers.html). Believable ≠ realistic: personality is "all the particular details". **Consistency across all channels** (name, schedule, window light, bio must agree) is what makes an agent read as a person. Loyall's anti-modularity heresy: generic personality engines flatten idiosyncrasy — reconciliation for us: systemic skeleton + hand-authored exception pools.

## GDC talks

- **Grinblat, Caves of Qud** ([GDC 2018](https://gdcvault.com/play/1024990), [FDG'17 paper](https://pcgworkshop.com/archive/grinblat2017subverting.pdf)): **generate-then-rationalize** (pick event, backfill cause from traits — players can't tell); the **"domain" field** — one archetypal noun per figure threaded through every event template, so coherent personality emerges from repetition of one seeded word (single highest-leverage idea for iteration 2); histories as atomic **"gospel" snippets** discovered out of order.
- **Compton** (["1000 Bowls of Oatmeal"](https://galaxykate0.tumblr.com/post/139774965871), [GDC 2017](https://www.youtube.com/watch?v=WumyfLEa6bU)): perceptual uniqueness ≠ mathematical uniqueness; **the fanfic test** as a shipping gate; generator → critic → accept/reject; make generators *structurally unable* to produce offensive output (curated lists, not phoneme grammars).
- **Tanya X. Short** (["Maximizing the Impact of Procedural Personalities"](https://www.gamedeveloper.com/design/procedurally-generating-personalities); book *Procedural Storytelling in Game Design*, Short & Adams eds.): **tell then show** (card tells a trait; ambient behavior verifies it); expression tiers (never-clicked residents need only name + light pattern); breadth over depth.

## Emily Short (emshort.blog)

- ["Beyond Branching"](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/): **storylets** — gate deeper resident facts behind discovery state (visit count, time of night) instead of trees; salience-based selection picks the fact that fits *right now*.
- ["Procedural Text Generation in IF"](https://emshort.blog/2014/11/18/procedural-text-generation-in-if/): weighted/sticky selection kills repetition; generate-rich-then-filter (reveal budget at render).
- Warning that recurs across her posts: *"design and context matter more than the underlying technology."*

## Name/identity generation

- [Statistically Representative Name Generator](https://williecostello.github.io/StatisticallyRepresentativeNameGenerator/): roll age → birth decade → sample that decade's SSA table. Names cohort-date people (78-year-old Dorothy, 26-year-old Madison). → iteration 2 upgrade over our pool-halving.
- [Arena/Daggerfall pitfall study](https://wg.criticalcodestudies.com/index.php?p=/discussion/134/): phoneme-soup name grammars produce slurs statistically inevitably; never borrow a culture's *sound* without its *structure*. Curated real-name lists only.
- [Name-ethnicity algorithm bias (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9910274/): **the stereotype trap for this project specifically** — given our socioeconomic lighting logic, never let the name pool and a building's income band condition each other. Our separation: ethnicity affects surname *only*; profession keys off district *only*.

## Adjacent finds

- **Schedules as story** ([Game Design Snacks](https://game-design-snacks.fandom.com/wiki/NPC_Schedules_-_Help_Create_the_Illusion_of_a_Complex,_Self-Sufficient_World); [Majora's Mask analysis](https://withaterriblefate.com/2014/11/16/want-to-learn-how-to-design-sidequests-play-majoras-mask/)): in a no-verbs game **the schedule is the character**; felt story comes from **interference between two schedules** ("he leaves exactly when she gets home") — implementable in window-light patterns with zero text.
- **RimWorld relationship storage**: only parent-of + partner-of primitives; derive sibling/cousin/in-law at query time — fits our derived-from-seed rule exactly.
- **Neko Atsume / Animal Crossing / Kind Words**: observation IS the content; 8 personality voices suffice for mass attachment; players attach to a first initial — resident cards need less data than instinct says.

## Top 10 actions for us (ranked)

1. Domain word per resident, threaded through all their lines (Grinblat).
2. Drive window lights from schedules; author near-miss pairs (Majora).
3. Minimal relationship graph, derive labels (RimWorld).
4. Storylet-gated reveal on repeat visits (Short).
5. Post-hoc knowledge/gossip implantation (Ryan) — v3, big.
6. `siftBuilding` curation line — done tonight.
7. Fanfic test as the shipping gate (Compton).
8. SSA cohort-dated name tables (Costello).
9. Tell-then-show expression tiers (T. Short).
10. Withhold the resolving detail — done in template authoring rules.
