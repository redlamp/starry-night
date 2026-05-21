---
tags:
  - domain/stack
  - domain/3d
  - status/adopted
  - scope/m1
---

# Decision: PRD v1 Architecture

**Date**: 2026-05-21

**Context**: PRD review for the Starry Night project established starting positions for stack, rendering strategy, scope, and review process. Several open questions were resolved with practical starting values; bigger aesthetic decisions deferred until still-frame review.

## Decisions

### Stack

- **Bun + Next.js + R3F** confirmed. Fallback to pnpm if friction appears.
- **GSAP dropped from v1.** Use R3F `useFrame` + drei helpers for camera motion. GSAP reserved for later vignette / motion-graphics work if needed.
- **shadcn/ui deferred to M4** (Seed Sharing). Hooks baked in now but no install until needed.
- **ESLint + Prettier baseline** adopted.

### Performance

- **Target 60fps on mid-spec laptop**, with quality tiers (low/med/high/ultra) for high-end hardware. Dev machine is RTX 3080 Ti at 5120×1440 — quality tier system allows headroom rather than over-budgeting baseline.
- **<50 draw calls total** for full scene.
- Quality tier surfaced as `?quality=` URL param initially; settings UI later.

### Rendering strategy

- **`InstancedMesh` per building archetype** (5-10 archetypes). Per-instance attributes for height, window-seed, district.
- **Windows are shader-painted on building faces**, not geometry. Fragment shader computes window grid from UV and samples per-window state from a small data texture. Hundreds of windows per face at zero extra draw-call cost. This is the load-bearing scaling decision — it unlocks thousands of windows per city.
- **Stars: single `Points` cloud** with custom twinkle shader.
- **Color pipeline: sRGB output + ACES tone mapping.** Emissive values > 1.0 bloom naturally under ACES without clipping. Source colors stay sRGB.

### State model

Two-tier:

- **Derived from seed** (building positions, archetypes, window lit states, flicker phases) → recomputed when seed changes, lives in refs / memos / instanced buffer attributes / data textures. **Not** in Zustand.
- **Runtime / UI** (current seed, lighting mode, quality tier, paused) → Zustand.

Storing derived state breaks the determinism guarantee and wastes memory. Rule of thumb: if same seed always produces the same value, recompute it, do not store it.

### Deterministic flicker

Flicker must be reproducible — sharing a URL must produce the same visual experience. Achieved by giving each window a seeded flicker profile (phase, period, intensity) and computing brightness in-shader as a pure function of `(windowSeed, uTime)`. Pattern parity matters across viewers; per-session phase offset on page load is acceptable.

### Aspect-bucket camera

Canvas is fullbleed and resizable. Camera framing snaps to one of three aspect buckets:

- Landscape — original Starry Night proportions
- Square — tighter skyline crop
- Portrait — vertical sky emphasis, narrow city band

Portrait variant doubles as preparation for future mobile support.

### Seed in URL

- Use URL **hash** (`/#seed=...`), not query string. Hash avoids server-render bounce on Next.js. Same string always produces same city.

### Still-frame review process

- `bun run capture` headless screenshot script loads `/?seed=X&capture=1`, writes PNG to `/samples/`
- Loop over a seed list → folder of candidates
- Eyeball review; promote favourites into `samples/curated/` committed to repo
- Same script later doubles as regression-snapshot tool

### Practical starting values (open questions resolved enough to start)

- Building count: start 200-400 instanced
- Star count: ~2000 points
- Moon: simple disc with soft-edge shader
- Sky: pure black for baseline; revisit after still review
- Building archetypes: 5-10

## Rationale

The shader-painted window approach is the load-bearing architectural decision — it makes the difference between a Tokyo-density city and a sparse silhouette without changing draw-call count. Everything else flows from "still frame must already feel right at M1": instancing keeps M1 cheap, shader windows let density scale, ACES tone mapping makes emissives glow without color management headaches, aspect-bucket camera means M1 looks intentional in any window size.

Open aesthetic decisions (visual style commitment, sky color treatment) deferred until the still-frame review surfaces direction. Resolving them on paper risks committing before seeing the result.

## Links

- PRD: `docs/PRD.md`
- See also: [[architecture]] *(MOC, stub)*
