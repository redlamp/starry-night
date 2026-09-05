---
tags:
  - domain/ci-cd
  - status/adopted
---

# Decision: Retire the `fable` Branch Routing

**Date**: 2026-09-05. Related: [[decision-fable-branch-model-scope]], [[fable-branch-history]], [[decision-merge-styles]].

## Context

[[decision-fable-branch-model-scope]] (2026-07-05) made `fable` model-scoped: a
separate integration branch so work done with the Fable model stayed
attributable, since every commit lands authored "Taylor Wright" in git and the
branch routing plus merge messages are the only record of which work was
Fable's (see [[fable-branch-history]] and the 2026-08-23 daily's "Fable
attribution" section).

As of 2026-09-05, `fable` is 35 commits behind `dev`, 0 ahead, with no commits
since 2026-07-27. Fable is now the everyday model for this project, so the
model-scoped detour buys nothing: every feature costs an extra merge hop
(`feat/<name>` -> `fable` -> `dev` instead of straight to `dev`), and multiple
sessions (Fable and otherwise) kept breaking the routing rule by accident
rather than by disagreement with it.

## Options considered

1. **Keep routing through `fable`.** Preserves the original attribution
   design, but the cost (a merge per feature, repeated routing mistakes) no
   longer buys anything now that Fable is the default model rather than an
   occasional guest.
2. **Freeze `fable` as history; route everything `feat/<name>` off `dev`.**
   Keep the branch and its ~294 commits / ~48 merges intact as the record of
   what Fable built between 2026-07-02 and 2026-07-27, but stop pushing new
   work through it.
3. **Delete `fable`.** Destroys the attribution trail the branch exists to
   preserve, for no benefit - every commit on it already merged to `main`.

## Chosen

**Option 2: freeze `fable` as history.** Keep the branch (never delete it,
never route through it again). Taylor agreed 2026-09-05 (tick on the
2026-09-05 review page, `docs/reports/review-2026-09-05-road-to-2.0.html`).

## The new rule

All sessions, any model: `feat/<name>` branches off `dev`, merges back into
`dev` with `--no-ff` on a ship signal, and `dev` promotes to `main` with
`--ff-only`. There is no model-scoped branch anymore - Fable sessions and
every other model use the same single lane.

## Why

The branch cost outlived its reason. It existed to let Fable-authored work be
reviewed and adopted deliberately, back when Fable was one contributor among
several. Now that Fable is the everyday model, "review before adopting"
applies to every feature branch regardless of model, which the ordinary
`feat/<name>` -> `dev` flow already provides. The attribution record itself
doesn't need the branch to keep existing going forward - it's already
complete on the historical `fable` branch and in past merge commits.

## Follow-ups (not done in this note)

- `~/.claude/projects/C--workspace-starry-night/memory/project_fable-branch.md`
  (built-in project memory) still states the old Fable-branches-off-`fable`
  routing and needs updating.
- This project's `CLAUDE.md` "Git workflow" paragraph ("Fable-model sessions
  branch `feat/*` off `fable` instead...") still describes the retired
  routing and needs updating.
