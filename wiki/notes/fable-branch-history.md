# Fable Branch History

Moved from built-in memory 2026-09-03; the standing rules stay in `~/.claude/projects/C--workspace-starry-night/memory/project_fable-branch.md`.


Created 2026-07-02 at the user's request: a `fable` branch off `dev` holds all
work done by Fable sessions (code, wiki, tooling). Commit freely to `fable`
per task; merging `fable → dev` (--no-ff, house style) still needs the usual
user ship-signal. The Opus camera-v2 stream previously ran directly on dev;
Fable work stays off dev so the user can review/adopt it deliberately.

Refined 2026-07-02 (evening): new feature work branches off `fable` as
`feat/<name>` and merges back into `fable`; `fable` is the Fable-stream
integration branch (small fixes/docs may still land on it directly). Chain:
feat/<name> → fable → dev → main. `fable` is pushed to origin.

Refined 2026-07-05 (Opus session, user directive): `fable` is MODEL-SCOPED —
reserved for work done with the FABLE model ONLY. The feat/<name>→fable chain
above applies to FABLE sessions. NON-Fable work (Opus, etc.) uses `feat/<detail>` off `dev` → `dev` → `main`
(the `feat/` prefix, per user 2026-07-05; NOT `feature/`), and must NOT route
through `fable`. No feature branches should hang off `fable` between Fable
sessions. (An Opus session had shipped through `fable` by habit; corrected +
deleted the merged fable-stream branches feat/city-features, feat/scene-polish,
feat/drei-camera-tuning.) See wiki `decision-fable-branch-model-scope`.

Delegation pattern the user asked for: spin up cheaper-model agents (Sonnet)
for well-specified tasks, but REVIEW their diffs — on 2026-07-02 review caught
two real bugs in an agent's uniform-caching draft (mid-loop cache starving
meshes 2..7; stale caches after mesh rebuild) and one invalid survey item
(Traffic `.slice()` is load-bearing for tile compaction).

Worktree naming (user 2026-07-05): `isolation: "worktree"` agents get an auto-named
worktree + branch `worktree-agent-<agentId>` (opaque hashes; no per-spawn name param to
override). The user dislikes the hash names. Apply: always label which worktree/hash maps
to which task in updates + at cleanup; where a named worktree genuinely helps, create it
manually (`git worktree add .claude/worktrees/<name> -b feat/<name>`) and run the work
there instead of relying on auto-isolation.

Worktree BASE gotcha (2026-07-18): auto-isolation worktrees base on the repo's
current default/checked-in branch tip (fable that day), NOT the launching
session's HEAD - two agents spec'd as "based on feat/full-city-framing" got
fable instead; one self-merged the dependency, one rebuilt a minimal slice that
later needed reconciling. Apply: when an agent depends on unmerged work, say so
in the prompt AND tell it to `git merge <branch>` first thing; verify the base
in its report. Also: launching several worktree agents at once can leave a stale
`.git/index.lock` in the main repo (0-byte, no live git process - safe to
remove after checking `tasklist`). Rename `worktree-agent-*` branches to
`feat/<name>` (`git branch feat/<name> <sha>`) as each agent lands; a session
`cd` into a worktree PERSISTS across Bash calls - later "main tree" git commands
silently run in the worktree (bit me mid-merge; use absolute paths / re-cd).

Verification harness worth reusing: `scripts/cdpShot.ts` (real-GPU headless
captures, SHOT_SETUP drives `window.__sceneStore` in ?capture=1 mode),
`scripts/moireMetric.ts` (speckle metric), `scripts/profileTileCull.ts`
(recompaction rate), differential DOM probes via stash/pop. See
[[window-lod-moire-diagnosis]] in the project wiki.
