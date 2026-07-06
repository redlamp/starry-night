# CLAUDE.md

## Project

**Starry Night** (working title) — a modernized homage to the Berkeley Systems After Dark "Starry Night" screensaver. Web-based ambient cityscape with low-poly 3D, seeded procedural generation, and socioeconomic lighting logic.

## Where things live

- `docs/PRD.md` — product spec, stack, milestones, scope. Source of truth for v1.
- `wiki/` — Obsidian vault. Project state, decisions (`notes/decision-*.md`), daily logs, MOCs. See `wiki/CLAUDE.md` for conventions.
- `wiki/notes/decision-prd-v1-architecture.md` — load-bearing architectural decisions (2026-05-21).
- `wiki/index.md` — top-level Map of Content.

## Stack

See `docs/PRD.md` §4 for the full list. Core: Next.js (App Router), Bun, Three.js + R3F + drei, Zustand, seedrandom, Tailwind + shadcn/ui (M4). Hosting: GitHub Pages static export (`.github/workflows/deploy-pages.yml`) — the PRD's Vercel entry was planned, never adopted (corrected 2026-07-02).

## Architectural rules (see `docs/PRD.md` §5)

- Buildings: extend the existing `InstancedMesh` archetype. Do not add new meshes per variant.
- Windows: shader-painted on faces, not geometry. Per-window state lives in a small data texture.
- Determinism is the contract. No `Math.random()`, `Date.now()`, or `performance.now()` as input to scene state. Flicker uses shader math on `(windowSeed, uTime)`. Non-deterministic calls in render paths are a bug — flag, do not write.
- Two-tier state: derived-from-seed recomputes, never stored. Runtime (seed, mode, quality, paused) lives in Zustand only.
- sRGB output, ACES tone mapping, emissive > 1.0 for HDR glow.
- **Exception**: the city building shader (`cityInstanced`) writes `gl_FragColor` raw — no tone-mapping/colorspace chunks. Colours fed to it (facade attributes, palettes) are authored in **display space**; converting them to linear (`setHSL(…, SRGBColorSpace)`) collapses them to black. See `wiki/notes/decision-facade-display-space-color.md`.
- Aspect-bucket camera (landscape / square / portrait). Canvas is fullbleed and resizable.

If a request conflicts with the PRD or a `decision-*.md` note, surface the conflict before coding.

## Git workflow

**Branches**: `main` ← `dev` ← `feat/*`. Feature off `dev`; delete after merge. Stay on the current feature branch — a new `feat/*` only when the domain shifts (camera → fog → wiki) or the user closes the concept.
**Merge styles** (2026-06-05): feature → dev with `--no-ff`; dev → main with `--ff-only` (main = bookmark on dev's line; tag main per promotion). If `--ff-only` refuses, main has commits dev lacks — back-merge main into dev first, never force.
**Direct-to-main**: CI/hotfix only, and back-merge into dev the same session.
**Deploy source**: `main`.

### Commit, merge, push

- Default: do not commit — leave changes uncommitted and report what changed. Commit only on a user signal ("ship it", "commit it", "next", "move on", "yes, commit").
- Merge & push run on the same kind of signal as commit — no preview-and-wait dance. A clear ship signal ("ship it", "ready to share", "push it", "merge to main / dev") authorizes the whole chain through push; take it end-to-end without re-confirming each step.
- Only `--force` / `-f` is hard-gated by `.claude/hooks/git-gate.sh` (narrowed 2026-06-14 — it used to block merge/push too). Surface a force op, get explicit approval, then prefix that one command with `GIT_GATE_BYPASS=1`.
- Pushing `main` deploys via the GitHub Pages workflow (outward-facing), so don't push it without a signal that covers shipping ("ship / share / deploy / push" all do).

### End-of-turn structure

Lead with the next concrete step for the current concept (what to try next, design questions, things to verify). If a commit, merge, or push feels warranted, offer it last as a single optional line — never lead with it. If the user is mid-feedback or mid-iteration, skip the offer entirely.

## Commands

- `bun dev` — local dev server
- `bun run build` — production build
- `bun run lint` — ESLint + Prettier check
- `bun run typecheck` — TypeScript check

## Conventions

- Formal artefacts (specs, PRDs) → `docs/`.
- Project state, decisions, daily logs → `wiki/` per `wiki/CLAUDE.md`.
- Code comments only when the _why_ is non-obvious.
