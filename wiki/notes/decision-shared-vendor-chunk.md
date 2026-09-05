---
tags:
  - domain/perf
  - domain/stack
  - status/deferred
---

# Decision: Shared Vendor Chunk for Three.js

**Date:** 2026-09-05. Related: [[decision-camera-v2-retired]].

## Context

An earlier measurement on this worktree's pre-merge base (dev tip `1465077`, before merging in `f7eda46`) found three separate ~530 KB chunks each carrying a full copy of three.js core - byte-identical sizes confirmed by grepping for `REVISION:` / `isVector3` - with `/` + `/window-lab` + `/drei-lab` sharing one copy and `/intro` and `/camera-lab` each carrying their own. The ask was to trace the cause and land a single shared vendor chunk across routes via Turbopack chunking config, falling back to a webpack `splitChunks` cacheGroup if needed.

## What was found

After merging `dev` up to its current tip (`f7eda46`, "retire the V2 camera model, extract V3 geometry helpers" - see [[decision-camera-v2-retired]]) and rebuilding clean (`bun run build`, verified twice including a `rm -rf .next` clean build), **the duplication no longer reproduces.** `.next/diagnostics/route-bundle-stats.json` plus a grep of the built chunks under `.next/static/chunks` for genuine three.js markers (`isVector3` AND `WebGLRenderer` together, to rule out app code that merely references `THREE.PerspectiveCamera` or `THREE.REVISION`) show exactly two chunk files carrying three's core classes:

- `0j.ue6s6~41ai.js` - 369.4 KB
- `0sf7wt9kt23p4.js` - 495.4 KB

Both appear under the **identical filename** in the first-load chunk list of every route that touches three: `/`, `/intro`, `/camera-lab`, `/window-lab`, `/drei-lab` (and `/palette` picks up the smaller one). Identical filenames from Turbopack's content-addressed chunk hashing means these are genuinely one shared instance each, not coincidentally-same-sized duplicates - confirmed by diffing two other same-sized-but-unrelated chunks, which turned out to be unrelated app code (tile-culling vs. shader/settings-icon modules) that only matched by chance.

The most likely explanation: `StarryNightV2Model.tsx` (removed in `b4e9c83`, the commit just before the merge base) was a ~1200-line duplicate camera rig that shipped in the shared `Scene.tsx` / camera-model registry used by every three-consuming route. Whatever import shape it had appears to have fragmented Turbopack's automatic chunk-boundary heuristic across entry points; removing it let Turbopack converge all routes back onto one shared boundary for three's core modules.

## Secondary finding (not the cause, left as-is)

`node_modules/stats-gl` (a transitive dependency of `@react-three/drei`, used internally for `Stats`/`Perf` helpers we don't import) declares `"three": "^0.170.0"`. Because three is at `0.184.0` and npm/bun's caret range on a `0.x` version only matches the same minor (`0.170.x`), bun installs a private nested copy at `node_modules/stats-gl/node_modules/three@0.170.0`. This is a real duplicate **install**, but it never reaches the client bundle - no chunk in the build contains three@0.170's markers, so it's dead code, correctly tree-shaken. Not touched: it isn't in our own `package.json`, dedupe would require a bun-side override for a package we don't call, and there is no bundle-size symptom to justify one.

## Choice

No config change. `next.config.ts` is untouched - there is nothing to shared-chunk that Turbopack isn't already sharing. Verified `NEXT_OUTPUT_EXPORT=true bun run build` still produces a working `out/` (`index.html` plus `camera-lab/`, `window-lab/`, `drei-lab/`, `intro/` each with their own `index.html`). `bun run lint` and `bun run typecheck` both pass clean.

## Numbers (bun run build, first-load JS per route, `.next/diagnostics/route-bundle-stats.json`)

| Route | First-load JS | Three chunks |
|---|---|---|
| `/` | 2733.9 KB | 2 shared (`0j.ue…`, `0sf7…`) + 2 route-local small (94.4 KB, 45.7 KB) |
| `/intro` | 2289.6 KB | same 2 shared + 1 route-local small (36.2 KB) |
| `/camera-lab` | 2239.2 KB | same 2 shared + 1 route-local small (33.5 KB) |
| `/window-lab` | 1977.7 KB | same 2 shared + 1 route-local small (33.2 KB) |
| `/drei-lab` | 1611.4 KB | same 2 shared + 1 route-local small (33.5 KB) |
| `/palette` | 904.0 KB | 1 shared (`0j.ue…` only) |
| `/writing-lab`, `/plan`, `/tensor`, `/_not-found` | 1062.4 / 948.5 / 903.1 / 507.8 KB | none |

Before and after are the same numbers - nothing changed, because the described problem isn't present on this branch. If it resurfaces (e.g. a future camera-model addition re-fragments the chunk graph the way v2 apparently did), re-run this same measurement method: grep built chunks for `isVector3` AND `WebGLRenderer` together, cross-reference filenames against `route-bundle-stats.json`, and look for the same physical chunk name appearing under multiple routes vs. two same-sized-but-distinct chunks (diff them - same size is not proof of duplication).

## Why deferred, not adopted

There's no live problem to fix. Revisit if a future build (new lab route, new camera model, a three version bump) reintroduces per-route three duplication - the diagnosis method above is the fast path to confirm it before touching `next.config.ts`.
