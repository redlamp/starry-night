---
tags:
  - domain/ui
  - domain/personas
  - status/adopted
---

# Decision: Card Front Is The Person

**Date:** 2026-09-05. Related: [[decision-entity-columns]], [[decision-listed-residents-term]], [[decision-persona-architecture]].

## Context

The resident card's pinned header has carried a two-column civic fact grid
(Gender|Age, DOB|Time, Height|T-Shirt, ID|In City) since 2026-07-11, with the
astrology/MBTI hover badges right below it, and the `whyAwake` line (the
sentence explaining why this person is up right now, in the city's
eternal-night framing) buried further down, after Details and Family. Andy
Zawadzki's playtest ([[2026-07-18-andy-zawadzki-playtest]])
flagged this directly: "I feel like there is so much information that I
don't know what's important" and "I would suggest trimming down the list of
details, because stuff like T-Shirt size feels like noise." The civic facts
are a fiction device (apophenia bait), not the point of the card — but they
were occupying the most prominent real estate on it.

## Options

1. Keep the July 11 fact grid pinned, unchanged — rejected, it's the exact
   complaint from the playtest.
2. Move the fact grid (and the astrology/MBTI badges) behind the existing
   Details disclosure, and promote `whyAwake` + Home into the pinned header
   instead — the header becomes "who is this person and why are they awake,"
   the disclosure becomes "the paperwork."
3. Delete the noisy facts outright (T-Shirt, civic ID) — rejected, they're
   harmless once they're not fighting for the header's attention, and some
   playtesters may still enjoy the apophenia texture; no need to lose the
   data model or the derivations over it.

## Choice

Option 2. Pinned header, in order: portrait + epithet (unchanged) → one line
of gender icon + pronouns + age ("he/him · 69") → `whyAwake`, plain
`text-base`, no italics → Home (district + address, two lines, same click
targets as before). The DOB/Time/Height/T-Shirt/ID/In City grid and the
astrology/MBTI badges move into the Details disclosure, with the fact grid
first and the badges immediately after it, ahead of Commute/Work/Education/
Relationship. Family and the hook are untouched. Every formatter and
derivation (alma mater lookup, transit line hash, etc.) is unchanged — this
is a layout move only.

The building card gets the same treatment in miniature: its companies list
and households/residents list move behind a new "Occupants" collapsible
(`cardOccupantsOpen`, default open, session-only — same pattern as the
resident card's `cardDetailsOpen`/`cardFamilyOpen`), with occupant counts in
the trigger row ("Occupants · 3 companies · 12 households") so the closed
state still reads as informative. The pinned stats above it (archetype,
focus button, district/address, population, height, footprint) are
untouched.

## Why

`whyAwake` is the one line that actually explains the lit window a player
clicked on — the eternal-night framing Taylor described in the same playtest
thread ("who's awake right now, and why"). It belongs at the top, not
competing with a T-Shirt-size stat for attention. The civic-ID grid and
astrology/MBTI badges are real, and stay — they're just not the first thing
a reader needs, so they move behind a disclosure the reader opens on
purpose.

The owner may roll this back if the new order doesn't read well in practice.
