---
tags:
  - domain/city-gen
  - status/open
  - origin/external-research
---

# Plan: City Scale Tiers (Issue #14)

**Date:** 2026-05-31
**Source:** multi-agent research workflow (real-world city footprints + scale-coupled constant inventory + perf scaling). Feeds GitHub issue #14 "Much larger cities + real-size reference." Related: [[decision-tensor-field-roads]], [[decision-1-unit-equals-1-meter]].

## TL;DR

One knob drives city size: `CITY_HALF_EXTENT = 750` (`lib/seed/topology.ts:37`). 2× extent = 4× area ≈ 4× instances. The current scene (1500 m across, ~1,640 buildings) reads as a **single mid-size CBD**, not a city. **Recommended target: the "City" tier (`half = 1500`, 3 km across)** — the smallest size that reads as a real, horizon-filling metro core. Draw calls stay at 7 at every tier (instancing holds); the only sharp edge is synchronous generation time.

## Scale tiers

| Tier | `CITY_HALF_EXTENT` | Across | Area | Real-world anchor | Character |
|---|---|---|---|---|---|
| Town | 400 | 800 m | 0.64 km² | small-town core, ~5×5 blocks | a few blocks, open horizon |
| **District** *(current)* | 750 | 1500 m | 2.25 km² | SF CBD (1.3 km²), Chicago Loop (4.1) | single downtown core |
| **City** ⭐ recommended | 1500 | 3000 m | 9 km² | NYC CBD (5.7 km²), approaching Downtown LA | horizon-filling — reads as a real city |
| Metro | 3000 | 6000 m | 36 km² | multi-CBD metro core | region, not a skyline |

Block / street / lane dimensions stay **fixed** across tiers (Manhattan ~79 m blocks, Portland ~80 m, real lane widths). Bigger tiers get *more* blocks, not coarser ones.

## Per-tier counts + perf (`k = half/750`, measured 10-seed avg)

| | Town (k=0.53) | District (k=1) | **City (k=2)** | Metro (k=4) |
|---|---|---|---|---|
| Buildings | ~450 | ~1,640 | **~6,500** | ~26,000 |
| Cars (cap 5,000) | ~110 | ~410 | ~1,640 | ~6,560 → clamped |
| Window cells | ~20k | ~74k | ~300k | ~1.2M |
| Window atlas | <1 MB | 1 MB | ~4 MB | ~16 MB (guard MAX_TEXTURE_SIZE) |
| Draw calls (city) | 7 | 7 | **7** | 7 |
| `generateCity` cold | ~70 ms | ~172 ms | **~600–700 ms** | ~2.5–3.5 s |
| Perf vs 60fps | none | baseline | gen freeze; GPU ok on dev GPU | not viable as-is (3s freeze + 26k unculled boxes) |

## Scaling recipe ("scale up by factor k")

1. `CITY_HALF_EXTENT ×= k` — most generation constants are already derived from it and follow for free (topology arc/offset multipliers; tensor `span`/basis `size`/plaza radius; tensorStreets `bounds`; `NET_MIN_AREA_FRACTION`; gate1 in-bounds slack; PlanView mapping).
2. **Convert these to derived (`×k`, round to int)** — currently hardcoded, must track extent to hold visual grain:
   - `tensorField.N` (`= round(4·k)`) — grid lattice density; else grain coarsens.
   - `tensorStreets.MAX_PTS` (`= round(420·k)`) — road length cap; else roads truncate mid-trace past half≈840.
   - `district.NET_GRID_STEPS` (`= round(200·k)`) — **the one real correctness risk**: left fixed, raster cells coarsen, the 1-cell `NET_WALL_PAD` wall weakens, flood-fill leaks across arterials → districts merge → gate1 fails.
3. Raise `district.NET_MAX/MIN_DISTRICTS` **and** the `gate1` `6..26` band together (lockstep, or gate1 fails).
4. **Re-express the camera/scene block as multiples of `half`** — it is fully decoupled today (imports nothing from `topology.ts`), so nothing auto-reframes:
   - `DEFAULT_ORBIT.radius` (≈3.2·half), `DEFAULT_ORTHO_SIZE` (≈0.32·half), `TOP_DOWN_RADIUS`/`TOP_DOWN_ORTHO_SIZE`, `ORBIT_RADIUS_MAX`, `DEFAULT_FOG.near/far`, `DEFAULT_HAZE.radius`, `DEFAULT_STARS.radius`/`DEFAULT_MOON.distance`, `Scene` `far`.
   - Enforce the ordering chain `orbit.radius < stars.radius / moon.distance < Scene.far`.
5. **Keep fixed** (physical / human-scale): all block + street dims (`GRAMMAR`), road/lane widths (16/9/28), `ART_DSEP`/`ST_DSEP` separations, archetype dims/pitch/heights, streetlight spacings, `DSTEP`, dimensionless falloffs/waviness/kelvins/FAILURE_RATE.
6. Bump `traffic.MAX_CARS` only as GPU budget allows (self-limits at ~Metro).

## Performance / LOD roadmap

Draw calls are a non-issue at every tier (the PRD's instancing bet pays off). The real walls, in order:

1. **Synchronous generation time** → move `generateCity` + atlas pack to a **Web Worker** (pure + seed-deterministic, ports cleanly). Turns the freeze into a background spinner. Single highest-leverage change; gates a comfortable City default. Overlaps issue #44.
2. **No frustum culling** (every city mesh sets `frustumCulled = false`) → split per-archetype InstancedMesh into per-tile InstancedMeshes so off-screen tiles drop. Biggest GPU win at Metro; draw calls 7 → 7×visible-tiles (still ≪50).
3. **No instance-level LOD** → beyond a distance, swap BoxGeometry for a billboarded quad using the existing `distantGlow` math. The fragment-side `relSpan` LOD (`cityInstanced.ts:356`) already proves the far field needs no per-window detail; extend it to the vertex stage.
4. **Atlas height guard** — clamp to `MAX_TEXTURE_SIZE`, spill to a second page at Metro.

City needs only #1 to ship cleanly. Metro needs #1–#4.

## Risks / open questions

- **Seeds are not portable across tiers.** Changing `N`/`MAX_PTS`/`NET_GRID_STEPS` changes the number of RNG draws → same seed yields a different city per tier. Not a determinism *violation* (all consumers re-derive consistently, nothing persisted), but flag if shareable-seed URLs are planned.
- **Mid-spec laptop (PRD §4.1 target) untested at City** — all GPU verdicts are on a 3080 Ti. ~6,500 unculled boxes is the risk; measure before locking City, or ship worker + frustum culling proactively.
- **`MAX_CARS = 5000` self-limits** at Metro (~6,560 wanted). Confirm capped density still reads well.
- **Streetlight emitter bug** (found during this research) — `emitRoadLights` emitted 0 lights on tensor roads (per-segment loop never fired at ~4 m segments). **Fixed 2026-05-31** via arc-length accumulation; lights now ~3,000/seed.

## Suggested sequence

1. ✅ Fix streetlight emitter (done).
2. Web Worker gen extraction (gates City; overlaps #44).
3. Derived-constants refactor (the `×k` group + camera-as-multiples-of-`half`) — makes scale a single knob.
4. Flip default to City (`half = 1500`) + retune + verify gate1 + visual.

## Sources (real-world dimensions)

- Commissioners' Plan of 1811 (Manhattan blocks): en.wikipedia.org/wiki/Commissioners'_Plan_of_1811
- City block size comparisons (Portland/Seattle/Tucson/SLC/Manhattan): en.wikipedia.org/wiki/City_block
- Barcelona Eixample / superblock (113 m blocks, 400 m superblocks): urbanland.uli.org/planning-design/barcelonas-experiment-superblocks
- Central business district areas + FAR: en.wikipedia.org/wiki/Central_business_district
- Largest US CBDs (NYC 2.2 sq mi, LA ~6 sq mi): offices.net/news/top-ten-largest-cbds-in-the-usa/
- Demographia US CBD land-area dataset: demographia.com/db-cbd2000.pdf

*Perceptual "reads as a real city ≈ 2.5–5 km across" threshold is derived from the grid + CBD figures above, not a single cited study.*
