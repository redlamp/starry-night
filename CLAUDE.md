# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Starry Night** (working title) — a modernized homage to the Berkeley Systems After Dark "Starry Night" screensaver, rebuilt as a web-based ambient cityscape with low-poly 3D, seeded procedural generation, and socioeconomic lighting logic.

## Where things live

- `docs/PRD.md` — product spec, stack, milestones, scope. Source of truth for what v1 is.
- `wiki/` — Obsidian vault. Project state, decisions (`notes/decision-*.md`), daily logs, MOCs. See `wiki/CLAUDE.md` for conventions.
- `wiki/notes/decision-prd-v1-architecture.md` — load-bearing architectural decisions made on 2026-05-21.
- `wiki/index.md` — top-level Map of Content.

## Stack (see PRD §4 for full list)

Next.js (App Router) · Bun · Tailwind + shadcn/ui (M4) · Three.js + React Three Fiber + drei · Zustand · seedrandom · ESLint + Prettier · Vercel.

## Core architectural facts (load-bearing — see PRD §5)

- **Buildings are `InstancedMesh` per archetype.** Per-instance attrs for height, window-seed, district.
- **Windows are shader-painted on building faces, not geometry.** Fragment shader reads per-window state from a small data texture. Hundreds of windows per face, zero extra draw calls.
- **Determinism is the contract.** Same seed → same city, including flicker. Flicker uses shader math on `(windowSeed, uTime)`, not `Math.random()`.
- **Two-tier state.** Derived-from-seed → recompute, do not store. Runtime (current seed, mode, quality, paused) → Zustand only.
- **sRGB output + ACES tone mapping.** Emissive > 1.0 for HDR-feel glow.
- **Aspect-bucket camera** (landscape / square / portrait) — canvas is fullbleed and resizable.

## Git workflow

Per global rule in `~/.claude/memory/general.md`:

- **Branching: `main` ← `dev` ← `feature/*`** (3-tier). Feature branches off `dev`, PR back to `dev`. `dev` → `main` only on explicit user approval. `--no-ff` merges. Delete feature branches after merge.
- **Commit cadence: by concept, not by prompt.** Batch related edits into one commit per concept. Don't commit + push after every user message. When unsure whether to commit, hold. When unsure whether to push, hold harder and ask.
- **Deploy source is `main`** (not dev, not feature branches).
- **Git author email**: `taylor@redlamp.org`.

## Conventions

- Formal artefacts (specs, PRDs) → `docs/`.
- Project state, decisions, daily logs → `wiki/` per `wiki/CLAUDE.md`.
- Cross-cutting feedback rules → built-in Claude memory.
- Cross-project tool gotchas → global memory.
- Code lives in code; comments only when the *why* is non-obvious.
