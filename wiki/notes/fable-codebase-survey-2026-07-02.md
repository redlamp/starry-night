---
tags:
  - domain/stack
  - domain/security
  - status/verified
---

# Fable Codebase Survey (2026-07-02)

Full-project survey by Claude Fable 5 (first session on this project), run as five
parallel read-only survey agents — architecture/code quality, performance, security,
determinism contract, docs/wiki health — plus a `bun audit`. Snapshot taken on `dev`
at `6fee09c`, ~160 TS/TSX files, ~33k LOC. Camera files were in active flux in a
parallel Opus session at survey time; findings in that area are flagged.

## Verdict summary

| Axis | Verdict |
| --- | --- |
| Architecture & code quality | **B+** — constraint-driven and disciplined; debt concentrated in 3 monolith files |
| Determinism contract | **Pass** — zero violations in the production scene path |
| Performance | **Healthy** — three concrete opportunities, no structural problems |
| Security | **Clean** — client-only, no secrets, safe injection surfaces; two minor gaps |
| Docs & wiki | **PRD stale by design**; 9 orphaned notes, 2 mis-tagged superseded decisions |

## Architecture & code quality

Strengths: zero `any` / `@ts-ignore`; all 18 eslint-disables narrow and justified;
no circular deps; no dead code (lab routes `/camera-lab`, `/drei-lab`, `/tensor`,
`/palette`, `/plan` are isolated, documented spikes); [[decision-prd-v1-architecture]]
rules (InstancedMesh archetypes, shader-painted windows, two-tier state,
aspect-bucket camera) all verified as enforced in code.

Debt, in order:

- `components/ui/CameraPanel.tsx` (3273 LOC) — 40+ nested section components in one
  file. Natural seam: split into ~8–10 files under `components/ui/panels/`
  (Orbit, Stars, Windows, Moon, Fog, Intro, Debug, Performance), keep CameraPanel
  as the accordion orchestrator. *In-flux area — defer until camera work settles.*
- `components/scene/DreiSceneControls.tsx` (1712 LOC) — gesture math, auto-revolution
  state machine, and projection utilities could move to `lib/scene/`. Already covered
  by [[plan-camera-refactor-optimization]] P0–P4; don't duplicate that plan.
- `lib/state/sceneStore.ts` (1713 LOC) — single store is *correct* (registry pattern,
  cross-dependent settings, one save/revert path); split into sub-files for
  readability only (`sceneTypes` / `sceneDefaults` / `sceneMigration` / store).
- `lib/seed/cityGen.ts` (1580 LOC) — cohesive sequential generation pass; leave
  as-is. Optional extractions: archetype logic, window-grid math (~150 LOC).
- Two `lib/ → components/` layering leaks, both metadata-only and low risk:
  `lib/scene/cameraReadout.ts:1` (type from CameraDiagram) and
  `lib/scene/cameraView.ts:15` (camera-model catalog lookup). Fix by moving the
  type and catalog into `lib/`.
- `CameraControls.tsx` (736) and `DreiSceneControls.tsx` coexist pending
  [[plan-drei-camera-migration]] — planned sunset, not a surprise.

## Determinism contract

**Honored — no violations.** Every `Math.random` / `Date.now` / `performance.now`
hit is properly scoped: seed-reroll buttons (legitimate new-seed generation), moon
phase sampled once at mount (PRD-sanctioned), perf profiling, camera/UI timing.
Verified: pause freezes the shared `uTime` uniform deterministically
(`TimeTicker.tsx`); Zustand stores no derived-from-seed data; localStorage persists
runtime config only, with migration; per-subsystem seed derivation
(`${master}::${subsystem}`) has no iteration-order fragility.

One guard-rail nit: `randomSeed()` in `lib/seed/rng.ts:24` wraps `Math.random()`
with nothing preventing a future import into a generation path — rename to
`generateRandomSeed()` or add a UI-only JSDoc warning.

## Performance

Render path is disciplined: module-scope vector reuse in camera models, atomic
Zustand selectors, generation off-thread via `cityGen.worker.ts`, textures uploaded
once, route-level code splitting, single 3-pass composer on `/intro` only. Ranked
opportunities:

1. **Uniform update flood** — `components/scene/InstancedCity.tsx:181–224` writes
   ~29 uniforms per archetype mesh (×7) every frame, including window-profile arrays
   that only change from the Settings panel. Cache last values, skip unchanged.
   Low effort, est. 5–10% per-frame CPU.
2. **Redundant buffer copies** — `components/scene/Traffic.tsx:90–99` re-`.slice()`s
   arrays already fresh from `reorderToTiles()`; ~80–100 KB wasted per seed change.
   (The nine `.slice()`s in InstancedCity are *intentional* — tile-compaction source
   copies per [[decision-tile-cull-materialisation]]. Do not remove those.)
3. **Tile-cull recompaction frequency** — every visible-tile-set change triggers a
   full GPU recompact. Profile the signature-change rate first; add hysteresis only
   if it exceeds ~10% of frames.

## Security

Client-only static site: no API routes, middleware, or server actions; `.env*`
gitignored and none committed; wiki vault leaks no credentials; CI uses frozen
lockfile and standard actions. Both `dangerouslySetInnerHTML` uses and the one
`innerHTML` (cursor glyphs, in-flux camera file) are hardcoded static strings.
`?seed=` feeds only seedrandom; localStorage reads are try/catch + whitelist.

- `bun audit`: 9 advisories (1 high, 6 moderate, 2 low) — **all in dev-tooling
  chains** (shadcn CLI → hono/MCP SDK, eslint tooling, tsx→esbuild). Nothing in the
  runtime bundle.
- **Action**: `shadcn` is a CLI but sits in production `dependencies` — move to
  `devDependencies` (removes the high-severity chain from the production tree).
- Optional defense-in-depth: CSP / X-Frame-Options headers. Low stakes for this
  threat model.

## Docs & wiki

- **PRD drift** (docs/PRD.md, ~2026-05-26): M1 shipped and exceeded, M3 + M4
  shipped, M2 partial (infrastructure ready, not user-facing). PRD still describes
  grid-based generation (now tensor-field roads per
  [[decision-tensor-field-roads]]), a simple orbit camera (now a 7-model registry
  per [[decision-camera-model-registry]]), and ~350 buildings (now metro-scale per
  [[decision-additive-growth-citygen]]). Not covered at all: `/intro` Mac stage,
  star scintillation, moon phases, traffic, lab routes, device-adaptive quality.
- **Wiki hygiene**: 9 notes unreachable from any MOC (mostly active `plan-*` notes:
  plan-city-scale-migration, plan-metro-suburbs-highways, plan-device-adaptive-quality,
  plan-fog-extent-adaptation, plan-suburb-node-fields, settings-ia-evaluation,
  camera-rotate-tilt-foray, intro-exploration-merge-handoff, plan-grid-first-rework);
  [[decision-grid-first-city-generation]] and [[decision-streets-first-city-generation]]
  are still tagged `status/adopted` though semantically superseded.
- `docs/superpowers/plans/` is an empty stub — populate or remove.

## Prioritized action backlog

Outcomes added 2026-07-02 (worked through on the `fable` branch; commits noted):

| # | Action | Effort | Payoff | Outcome |
| --- | --- | --- | --- | --- |
| 0 | Window moiré on band floors (user report) | — | Visual correctness | **Fixed** `ee9e79f` — see [[window-lod-moire-diagnosis]] |
| 1 | Move `shadcn` to devDependencies | 5 min | Clears high-severity audit chain | **Done** `c031436` (+ missing typecheck script) |
| 2 | Cache/skip unchanged uniforms in InstancedCity | 1–2 h | 5–10% frame CPU | **Done** `759b94f` (agent draft had 2 correctness bugs: mid-loop cache starving meshes 2–7, stale cache after rebuild — both fixed in review) |
| 3 | Drop redundant `.slice()` in Traffic.tsx | 30 min | Alloc churn per seed change | **Invalid** — slices are load-bearing: `compactVisible` needs src/dst distinct or compaction corrupts tiles (`tileCull.ts:138`) |
| 4 | Rename/document `randomSeed()` as UI-only | 10 min | Determinism guard-rail | **Done** `f07385e` → `randomSeedForReroll` |
| 5 | Wiki: retag 2 superseded decisions, link 9 orphans | 30 min | Vault navigability | **Done** `c46f05e` — all 48 notes MOC-reachable |
| 6 | Fix 2 lib→components metadata imports | 30 min | Clean layering | **Done** `c3c4d7c` — catalog + CamReadout moved to lib, shims keep importers |
| 7 | Split sceneStore into sub-files (one logical store) | 1–2 h | Readability | In progress (agent) |
| 8 | Split CameraPanel into `panels/` | 2–4 h | Maintainability | In progress (agent; camera work settled 2026-07-02) |
| 9 | PRD refresh or successor state-of-codebase note | 1–2 h | Onboarding accuracy | **Done** `a2f546a` — status banner + annotations |
| 10 | Profile tile-cull recompaction; hysteresis if justified | 3–5 h | Conditional | **Measured, no action**: 0% still / 1.33% drift-orbit recompaction frames (`scripts/profileTileCull.ts`, `f0b25ba`) |
| 11 | CSP headers | 30 min | Optional hardening | **Done** `7b33780` — Vercel-served only |

Git-hygiene follow-ups (2026-07-02 history review, parked per user): resolve
`feature/road-reveal` (15 unmerged commits), delete merged
`origin/feat/drei-camera-tuning`, add CI typecheck/lint/build gate.

Items 8 and anything touching `camera-models/`, `CameraControls.tsx`,
`DreiSceneControls.tsx`, or `CameraPanel.tsx` should wait for the in-flight camera
work to land.
