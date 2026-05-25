# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project

**Starry Night** (working title) — a modernized homage to the Berkeley Systems After Dark "Starry Night" screensaver. Web-based ambient cityscape with low-poly 3D, seeded procedural generation, and socioeconomic lighting logic.

## Where things live

- `docs/PRD.md` — product spec, stack, milestones, scope. Source of truth for v1.
- `wiki/` — Obsidian vault. Project state, decisions (`notes/decision-*.md`), daily logs, MOCs. See `wiki/CLAUDE.md` for conventions.
- `wiki/notes/decision-prd-v1-architecture.md` — load-bearing architectural decisions (2026-05-21).
- `wiki/index.md` — top-level Map of Content.

## Stack

See `docs/PRD.md` §4 for the full list. Core: Next.js (App Router), Bun, Three.js + R3F + drei, Zustand, seedrandom, Tailwind + shadcn/ui (M4), Vercel.

## Architectural rules (see `docs/PRD.md` §5)

- Buildings: extend the existing `InstancedMesh` archetype. Do not add new meshes per variant.
- Windows: shader-painted on faces, not geometry. Per-window state lives in a small data texture.
- Determinism is the contract. No `Math.random()`, `Date.now()`, or `performance.now()` as input to scene state. Flicker uses shader math on `(windowSeed, uTime)`. Non-deterministic calls in render paths are a bug — flag, do not write.
- Two-tier state: derived-from-seed recomputes, never stored. Runtime (seed, mode, quality, paused) lives in Zustand only.
- sRGB output, ACES tone mapping, emissive > 1.0 for HDR glow.
- Aspect-bucket camera (landscape / square / portrait). Canvas is fullbleed and resizable.

If a request conflicts with the PRD or a `decision-*.md` note, surface the conflict before coding.

## Git workflow

**Branches**: `main` ← `dev` ← `feature/*`. Feature off `dev`. `--no-ff` merges. Delete after merge.
**Deploy source**: `main`.

### Defaults

- Do not commit. Leave changes uncommitted and report what changed.
- Stay on the current feature branch. A new `feature/*` only when the domain shifts (camera → fog → wiki) or the user closes the concept.
- Never bundle "I shipped X" with "want me to push?". Separate lines, declined by default.

### End-of-turn structure

Lead with the next concrete step for the current concept (what to try next, design questions, things to verify). If a commit, merge, or push feels warranted, offer it last as a single optional line. Never lead with it.

If the user is mid-feedback or mid-iteration, skip the offer entirely.

### Commit, merge, push

Commits are not hook-gated — local, reversible. Still: do not commit without a user signal ("ship it", "commit it", "next", "move on", "yes, commit"). Default = leave changes uncommitted, report what changed.

Merge, push, and any `--force` variant are blocked by `.claude/hooks/git-gate.sh`. When blocked, show the command you would run and wait. Unblock signals: "ship it", "next", "move on", or an explicit "yes, merge / push".

## Commands

- `bun dev` — local dev server
- `bun run build` — production build
- `bun run lint` — ESLint + Prettier check
- `bun run typecheck` — TypeScript check

## Conventions

- Formal artefacts (specs, PRDs) → `docs/`.
- Project state, decisions, daily logs → `wiki/` per `wiki/CLAUDE.md`.
- Code comments only when the *why* is non-obvious.