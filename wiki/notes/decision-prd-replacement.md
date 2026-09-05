---
tags:
  - domain/ui
  - status/adopted
---

# Decision: Replace the PRD Instead of Rewriting It

**Date**: 2026-09-05. Related: [[decision-prd-v1-architecture]].

## Context

`docs/PRD.md` is the May 2026 v1 spec. v1 shipped in June, and exceeded its
own scope (slow orbit motion landed on top of the still-frame foundation).
Since then the project built a second generation with no spec above decision
notes: metro-scale city generation, the persona system, camera v3, flights
and helicopters, the `/intro` sequence, and building inspection. The
2026-09-05 review (`docs/reports/review-2026-09-05-road-to-2.0.html`) found
the PRD's building-count annotation off by an order of magnitude (claims
~1,500; the metro tier generates about 15,900) among other staleness.

Taylor, reading the review: "I haven't touched the PRD in a very long time,
it feels like an outdated approach to agentic work from when this project
started."

## Options considered

1. **Rewrite as PRD v2.** Keep the single-document spec format, bring it
   current. Rejected: a long spec is the artifact agents and people stop
   reopening; the project already produces better living documentation as
   decision notes, and a v2 spec would drift again the same way v1 did.
2. **Keep annotating v1 in place.** Cheapest, but the annotations already
   lagged reality (the building-count number, the M2 status line) and this
   just continues that pattern.
3. **Replace with lighter instruments.** Split the PRD's jobs - pitch,
   scope discipline, living spec, and a punch list - across purpose-built
   pieces that are each cheap to keep current.

## Chosen

**Option 3.** Three instruments replace the PRD's role:

(a) **`docs/charter.md`** - one page: thesis, non-goals, quality bars, and
the version rule. Being written separately by the lead; not written in
this note.

(b) **`wiki/mocs/product.md`** - the product map, linking every decision
note grouped by system. This is the living spec: what the project
actually is, derived from what was actually decided, not from what was
planned in May. Lives at [[product]] (wiki/mocs/product.md)
into place.

(c) **A GitHub milestone "2.0"** holding the gate issues that decide when
the project is ready to call itself 2.0 rather than 1.x.

`docs/PRD.md` stays in the repo as v1-historical, with a banner line pointing
at the charter (a follow-up; not edited in this note).

## Why

Agents and people already read decision notes and GitHub issues day to day -
that's where the actual reasoning and state live. A long spec document is the
thing nobody reopens once the project outgrows its first milestone; three
small, purpose-specific instruments (a pitch, a living map, a punch list)
each stay cheap enough to keep current, which a single sprawling PRD does
not.
