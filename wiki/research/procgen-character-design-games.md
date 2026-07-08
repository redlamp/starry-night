---
tags:
  - domain/procgen
  - domain/narrative
  - status/verified
  - origin/external-research
---

# Procgen Character Design — Game References

How shipped games make procedurally generated characters that players *care* about. Companion note: [[procgen-character-theory-literature]] (academic/theory beat). Both feed [[decision-persona-architecture]] and the [[personas]] project. Researched 2026-07-08 for the persona system's quality bar: "Heat Signature-level story-in-the-player's-head."

## Heat Signature (Tom Francis, 2017) — the primary reference

A character is just **name + one personal mission + 1-2 items + traits/vows**. Personal missions are single-sentence, specific, personal: "rescue their brother", "steal their gun back", "get revenge on their partner's killer" ([Steam page](https://store.steampowered.com/app/268130/Heat_Signature/); [Personal Mission wiki](https://heatsignature.fandom.com/wiki/Personal_Mission)). Vows are pure roleplay constraints ("You've vowed never to cause anyone's death"); negative traits are one vivid line ("Dying — you only have 10 minutes to live").

- Francis: *"For me a Story Generator is one of the highest goals in game design"* ([pentadact.com](https://www.pentadact.com/2017-09-27-heat-signatures-launch-and-first-player-legend/)).
- Roguelike Celebration talk ["Generating boring levels for fresh experiences"](https://www.youtube.com/watch?v=3vSCncV5hkI): *"We didn't need to generate interesting levels to generate interesting experiences."* Randomness's job is **situations, not content**.
- Why sparse hooks work: each names a *relationship* + an *unresolved want*, and the game never contradicts the player's mental fill-in.
- Post-completion, characters retire as "Living Legends" and name items/stations — the world accumulates proper nouns from past characters.

## Shadow of Mordor — Nemesis system

Orc = name + **earned epithet** + rank + strengths/weaknesses/fears + **memory of encounters** (scars, callbacks in dialogue). GDC 2018: [Chris Hoge, "Helping Players Hate (or Love) Their Nemesis"](https://www.gdcvault.com/play/1025150/). Success = recognition (name+face+voice) + continuity (visible state from history) + acknowledged shared history. The procedural cast sat on a **hand-authored voice layer** (novelist Dan Abnett). Mechanic patented by WB (US 10,894,215) — covers the revenge-encounter loop, not panel-based character display.

## RimWorld — backstory anatomy

Each pawn: childhood + adulthood backstory **pair, often in tension** (slave → navy scientist), each = title + short title + 1-3 sentences of second-person flavor + skill grants + **work incapabilities** ([Backstories.xml](https://github.com/RimWorld-zh/RimWorld-English/blob/master/Backstories/Backstories.xml)). Drama comes from what a character *can't/won't* do. Sylvester's framing ([GDC 2017](https://www.gdcvault.com/play/1024232/), ["The Simulation Dream"](https://tynansylvester.com/2013/06/the-simulation-dream/)): *"This apophenia — perception of personality and intent where there is none — is the key"*; *"show the simulation equivalent of moving balls and let the player layer in their own emotional perceptions."*

## Watch Dogs: Legion — the cautionary tale

Census system ([Game Developer breakdown](https://www.gamedeveloper.com/design/how-watch-dogs-legion-s-play-as-anyone-simulation-works); [GDC Vault](https://www.gdcvault.com/play/1027018/)): richest profile data of any system here (job → salary → neighborhood → home/family links → schedule → "problems" as missions). **It failed**: dialogue was decoupled from profile data, so a lawyer and a courier sounded identical ([PC Gamer](https://www.pcgamer.com/all-of-my-watch-dogs-legion-recruits-are-massive-disappointments/)). The equation: **rich data + generic voice = spreadsheet; modest data + history + authored voice = person.**

## Brief: DF / Wildermyth / CK3

- **Dwarf Fortress**: minimum viable "existed before you looked" = a dated event involving a named other. Adams: dwarves are *"more human than human"* — allowed bigger emotions and bigger mistakes ([PC Gamer, GDC 2025](https://www.pcgamer.com/games/sim/dwarf-fortress-dwarves-are-more-human-than-human-creator-says-theyre-allowed-to-embody-bigger-emotions-theyre-allowed-to-make-bigger-mistakes-theyre-allowed-to-do-anything/)).
- **Wildermyth**: authored story templates, procedurally *cast* — writers write the shape, the generator picks who it happens to ([overview](https://en.wikipedia.org/wiki/Wildermyth)).
- **CK3**: traits/relationships/secrets feed one stress economy — one pressure value turns numbers into melodrama.

## The 15 principles distilled (applied in [[decision-persona-architecture]])

1. **One unresolved hook, not a biography** — ends the sheet, never resolves.
2. **Voice generated FROM the data** — templates scoped to occupation/life clusters, no global grab-bag (the Legion failure).
3. **Asymmetric edges** — A's sheet mentions B; B doesn't know. The player who clicks both gets a story neither resident knows they're in.
4. **Anchor to the pixel clicked** — `whyAwake` explains the lit window.
5. **Schedules make residents exist before you looked** — drive window lights from schedules (v2).
6. **State the fact, withhold the feeling** — no emotion words, no "because".
7. **One vivid concrete detail beats ten stats.**
8. **Two-beat was/is in tension** (RimWorld pairs).
9. **Flaws and refusals, not competence.**
10. **Shared city lore nouns** — ~15 named places/events/bands many sheets touch.
11. **Authored shapes, procedural casting** — 50 excellent templates × slots beats 5,000 Markov sentences.
12. **Epithets** — the neighbor's name for them ("the night guard").
13. **Rare/legend residents** as perceptual-uniqueness anchors.
14. **Bigger emotions than realism allows** — ~10% outsized pool.
15. **The sheet ends on the hook.**

One-line synthesis: **players don't attach to generated data, they attach to the inferences the data forces them to make** — few, specific, mutually consistent facts with deliberate gaps, anchored to the window they clicked, stopping one sentence early.
