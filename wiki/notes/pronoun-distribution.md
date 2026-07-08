---
tags:
  - domain/procgen
  - status/adopted
  - origin/external-research
---

# Pronoun & Gender-Identity Distribution

Rates used by the persona generator (`drawGenderIdentity` / `drawPronouns` in `lib/seed/personas.ts`), captured 2026-07-08 per user direction: "keep proportions relatively similar if just above real-life statistics", with sources noted for later review.

## Reference points (US, mid-2020s)

- **Pew Research (2022)**: ~1.6% of US adults are trans or nonbinary; ~5% of adults under 30.
- **Williams Institute (2021)**: ~1.2M US adults identify as nonbinary (~0.5% of adults).
- **Gallup (2024)**: LGBTQ+ identification ~7.6% of US adults, strongly generational.
- **The Trevor Project (2020, LGBTQ youth)**: ~25% of LGBTQ youth use nonbinary pronouns; ~4% use neopronouns (xe/xem, ze/zir, etc.).

## What the generator uses (slightly above those baselines)

- Gender identity: **trans 0.8%**, **nonbinary 2.5%** (≈3.3% combined vs Pew's 1.6% adult figure — deliberately "just above", and closer to the under-30 cohort since a city skews younger).
- Pronouns by identity:
  - nonbinary → they/them 70% · she/they 10% · he/they 10% · xe/xem 5% · ze/zir 5%
  - trans man → he/him 90% · he/they 10%; trans woman → she/her 90% · she/they 10%
  - cis woman → she/her 96% · she/they 4%; cis man → he/him 97% · he/they 3%

## Review levers

All rates are literals in the two draw functions — one edit each. Things to revisit: whether cis she/they and he/they rates should skew by age (younger higher); whether neopronoun share should rise; whether identity rate should vary by district character (it currently doesn't, by design — see the stereotype-separation rule in [[decision-persona-architecture]]).
