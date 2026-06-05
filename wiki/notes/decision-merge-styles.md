---
tags:
  - domain/ci-cd
  - status/adopted
---

# Decision: Merge Styles — `--no-ff` Into Dev, `--ff-only` Into Main

**Date**: 2026-06-05

**Context**: The history graph had become a 20-lane braid — every dev→main
promotion was a `--no-ff` merge, each opening a permanent lane. Separately,
three direct-to-main CI commits (the Pages workflow runs from main's copy of
its file) drifted dev's workflow copy until it would have regressed the live
deploy on a future promotion.

**Options**: (a) keep `--no-ff` everywhere (status quo, braid grows forever);
(b) squash promotions (tried before — caused real divergence pain, see
`git-squash-divergence` in global memory); (c) split by merge site.

**Chosen**: (c) —

- **feature → dev**: `git merge --no-ff` — the bubble groups a feature's
  commits, keeps one-command revert.
- **dev → main**: `git merge --ff-only` — main is a bookmark sliding up dev's
  line; promotions add zero graph lanes. Tag main per promotion for the
  "approved version" record.
- **Direct-to-main**: CI/hotfix only, back-merged into dev the same session
  (settled historically by back-merge `5b10706`). The back-merge rule is what
  keeps `--ff-only` always possible; a refusal means the rule was broken —
  repair with a back-merge, never force.

**Why**: dev is the source of truth; main only receives approved snapshots.
`--ff-only` encodes that relationship mechanically and turns rule violations
into loud merge refusals instead of silent drift.
