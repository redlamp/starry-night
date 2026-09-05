---
tags:
  - domain/personas
  - domain/narrative
  - status/open
  - origin/external-research
---

# Plan: Andy Playtest Follow-Up Issues

Five issue drafts from [[2026-07-18-andy-zawadzki-playtest]], ready to file
under milestone "2.0" once reviewed. Not filed yet - a later step does that.

## 1. Engagement ratings on the persona card

**Suggested label**: `playtest-andy`, `enhancement`

Andy: "I think you have a lot of dry information... what I think would add a
lot of depth is the thoughts of those characters ABOUT their life... Do they
like their job? Are they happy with their spouse?" Taylor's reply agreed this
is "easy enough to stub in, that alludes to something more significant."
Add a simple engagement/sentiment rating (job, relationship, family) to the
generated persona data and surface it on the card, seeded like everything
else. Start as a single scalar per relationship, not new prose.

## 2. Trim card noise behind a disclosure, not deletion

**Suggested label**: `playtest-andy`, `enhancement`

Andy: "trimming down the list of details, because stuff like T-shirt size
feels like noise." Taylor deliberately kept the full fact grid on 2026-07-11
([[decision-family-tree-infinite-canvas]] context, same session) rather than
cut it. Propose a "Details" disclosure that collapses the low-signal fields
(T-shirt size and similar) behind a toggle rather than removing them, so the
data survives for players who want it without cluttering the default card.

## 3. A resident can be somewhere other than home

**Suggested label**: `playtest-andy`, `enhancement`

Andy: "I haven't found a way to have the character physically be at another
place than where they live, which means that having them selected always
shows them on the screen." Ties directly to [[plan-night-shift-lighting]]:
the awake are meant to be at work, not asleep at home, so a resident's
current location needs to be a first-class derived value (home vs workplace
vs commute) rather than always resolving to the home address.

## 4. City news feed as poetic establishing shots

**Suggested label**: `playtest-andy`, `enhancement`

Andy floated a "newsfeed from the city" investigator loop. Taylor's reply
reframed it: "I like the idea of this project becoming a city 'news feed'.
Maybe portraying it more poetically... I'm thinking of anime establishing
shots, more than crime reporting." Ties to the PRD's deferred vignette system
(`docs/PRD.md` section 2 non-goals: "No vignette system or curated camera
moments"). Scope as short, seed-derived establishing-shot captions tied to a
person or place, not a mechanic with consequences.

## 5. Resolve the interaction-mode split

**Suggested label**: `playtest-andy`, `enhancement`

Andy's clearest structural ask: separate the spatial toy (click through the
city) from the structured browse (the directory list), which are mixed today
and let the list-first path dominate. See [[decision-interaction-modes]] for
the drafted options and recommendation (spatial-first, directory demoted to
search). File once that decision moves from open to adopted.
