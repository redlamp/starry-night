---
tags:
  - domain/3d
  - domain/visual-language
  - status/adopted
  - scope/m2
  - origin/external-research
---

# Plan: Grid-First City-Generation Rework

Implementation plan of record for [[decision-grid-first-city-generation]]. Drafted + judged via the `plan-grid-first-rework` workflow (2026-05-30). Landed as **flag-gated stages** behind a single pure `lib/seed/lattice.ts`, each independently shippable, each green on `gate1`, with `/plan` as the old-vs-new A/B harness.

## The load-bearing invariant (why Stage 0 exists)

Every generator keys its RNG as `seedrandom(\`${masterSeed}::...\`)` (topology.ts:185, district.ts:245, arterials.ts:43, cityGen.ts:602/729/767/793, silhouette.ts:47). So the `gridFirst` flag **cannot** be a `::gridfirst` sentinel appended to the seed — that would shift every RNG stream and make flag-ON a *different city*, silently invalidating the `/plan` A/B comparison. **Stage 0** derives `baseSeed = stripGridFirst(rawSeed)` before any key derivation and reads the flag from the raw string, proven by a gate1 assert that `generateCity(s)` and `generateCity(s+'::gridfirst')` share identical topology + district-seed positions.

Cross-cutting hard gate, **every** stage: `gate1` runs on both flag states, and flag-OFF stays byte-identical to a snapshot of pre-rework `arch/city-planning` HEAD.

## Accepted decisions

- **Flag transport** — stripped sentinel → clean `baseSeed`; no param threading, no key collision. Remove `genConfig` once the rework is default.
- **Drift default ±20°** — tunable knob exposed on `/plan`, not a hard gate (aesthetic). A-fallback = drift→0 (shared lattice) if orbit reads flat.
- **L∞ tie-break** — deterministic first-index-wins now; seeded jitter only if `/plan` shows stair-stepped seams.
- **`minDist` re-tune** — keep `half*0.13`; re-tune reactively, but run the full 20-seed gate at Stage 1 sign-off and treat a `[6,26]` district-count trip as blocking.
- **Seam-adjacency assert** — true Voronoi adjacency from the classify grid (cheap, already computed), not a distance proxy.
- **Settings** — single registry; **Revert** added (see work item S).

## Standing acceptance criterion (gen stages 1–7)

Any new tunable knob: (a) gets a panel control, (b) **registers in the settings registry** so Save / Copy / Reset / Revert all include it, (c) gets a `/plan` layer or readout if spatial.

## Work items

### S — Settings: Save / Copy / Reset + **Revert** via a single registry *(early)*

- Add `revertToSaved()` to `sceneStore.ts` — load last `SavedConfig` into state.
- Replace the three hand-maintained parallel field lists (`resetCamera` :584-606, `saveCurrentAsDefault` :608-628, `SavedConfig` type :184-244) with **one registry** (`{ key, default, persist }` per field); Reset / Save / Revert / Copy all derive from it.
- **Reset** = system defaults (`DEFAULT_*`), ignoring saved-local. **Revert** = last saved-local. **Save** = write local. **Copy** = serialize registry fields to clipboard.
- Optional: rename `resetCamera` → `resetAll` for clarity.
- *Verify*: round-trip test (save → mutate → revert restores; reset ignores saved-local). *Ships standalone*: pure settings infra, no scene change.

### P — `/plan`: flow layout + configurable count + new layers + A/B *(early)*

- `app/plan/page.tsx`: replace fixed `grid-cols-*` (:85) with **flex-wrap flow**; make `SEED_COUNT` (:14) a control (>16 allowed).
- Add new layers to `PlanLayers` + `PlanView` (seam streets, legacy diagonals, grid lines, zones) and render **both flag states** for old-vs-new A/B.
- *Verify*: renders N tiles, flag toggle shows old vs new. *Ships standalone*: harness only.

### 0 — Lattice scaffold + sound flag transport *(no behaviour change)*

- New pure `lib/seed/lattice.ts`: `computeLattice(masterSeed)` → θ₀ (off the dominant highway tilt) + center-anchored orientation field, anchored to `CITY_CENTER`/`CITY_HALF_EXTENT` (topology.ts:36-37). `stripGridFirst` / `gridFirst` in `genConfig`.
- *Verify*: `computeLattice` JSON-equal across runs; neighbour-delta < driftMag·1.5; the BLOCKER assert (identical topology + seed positions across the flag). No generator branch wired.

### 1 — Remove the starburst + Chebyshev L∞ seams in the city frame

- Behind flag: drop the radial arterial spokes (`arterials.ts:78-91`); swap Voronoi metric squared-L2 → L∞ in the θ₀ frame at all three sites (`district.ts:106`, `:129`, `:281`); arterials become heavy grid lines + promoted seam runs.
- *Highest-impact, smallest diff.* *Verify*: full 20-seed gate flag-ON at sign-off; `[6,26]` district count blocking.

### 2 — Center-anchored orientation field → per-district grid grain

- Replace independent per-district random rotation (`cityGen.ts:606`) with `lattice.orientationAt(centroid)` **+** a per-character residual jitter drawn from `districtRng()` in the **same slot** (draw count unchanged).
- *Verify*: building COUNT + sorted building-ID set identical across the swap (proves the draw slot was preserved).

### 3 — Continuous seam streets + <4-cell clamp

- Pure `seamSegments(field, lattice)` in `district.ts`: walk the classify grid (guard the `-1` case), coalesce adjacency boundaries into seam polylines (~12-16m). Local streets dead-end (T) into them — never line-match. Mandatory <4-cell clamp keeps small districts' boundary cells.
- *Verify*: isolated `seamSegments` determinism + full CityData determinism (clamp changes survivors → centroids → characters) + no-isolated-fragment continuity (cross-hatch guard).

### 4 — Legacy diagonals (0–3)

- Seed from `${baseSeed}::diagonals`; each endpoint snapped to the nearest lattice intersection; fed into the same `roads[]` corridor array. Slotted here — they snap to real grid intersections, which exist only after Stages 1–3.
- *Verify*: diagonals cross the grid only at real intersections (no dangling stub); dedupe vs promoted seam-arterials.

### 5 — Zone field + sidewalk-setback street wall

- Per-block zone field anchored to road hierarchy (commercial on arterials/center, industrial on highways/edges, residential interiors, mixed transitions; per-district gradient + mild city-wide center boost).
- Replace the corridor standoff (`cityGen.ts:350`, `margin=width/2+5` ≈ 12-19m) with a per-zone ~2-8m sidewalk setback (transition-zone setback a tunable knob from the start) → street wall.
- *Verify*: pre-budget a per-zone setback FLOOR clearing gate1's 0.3m OBB tolerance; split gate1 corridor by tier (include seams); seam-straddling-pair overlap assert. (Re-validate #7 road-facing snap, which fires more often.)

### 6 — Zone-driven hybrid fill (existing 7 archetypes only)

- Block-fill dispatcher keyed by `zoneAt`: commercial = perimeter street-wall + interior towers; residential = lot rows (legacy `fillStripe` becomes this branch); industrial = 1-3 big parcels. Stacked podium-tower from existing boxes. Seeded from the existing `${baseSeed}::layout::${district.id}` stream.
- *Zero GPU/shader diff.* *Verify*: full overlap/corridor/determinism on the richer fill, 7-archetype set untouched.

### 7 — Flatiron / wedge archetype (downtown only) — the lone GPU-touching stage

- One new shape: 4-sided trapezoidal wedge for downtown triangular seam lots; append to `ARCHETYPE_ORDER` at index 7 (0-6 unchanged for atlas stability). Three coupled edits: (1) bump `cityInstanced.ts` `uWinFracW/H[7]→[8]` and `k<7`→`k<8`; (2) own `BufferGeometry` in `InstancedCity.tsx` (the scaled unit box can't be a trapezoid); (3) explicit-corners field on `Building` + branch gate1's `projectOBB` (`gate1.ts:23`, rectangle-only) + `footprintInDistrict` to the 4 real corners.
- *Verify*: wedge appears only in downtown zones; `ARCHETYPE_ORDER.length === uniform-array length`. Last + fully additive so a slip never blocks Stage 6.

## Sequencing

`S` + `P` land alongside `0` (infra/harness). Then `1 → 2 → 3 → 4 → 5 → 6 → 7`. Stage 1 is the recommended first tracer-bullet *visible* win (after Stage 0 makes the harness trustworthy).

## Biggest risks

1. Flag-transport RNG-key collision (Stage 0 mitigates).
2. Stage 2 draw-slot shift (count + sorted-ID assert).
3. Stage 5 setback collapse removing overlap slack (pre-budget setback floor; split gate1 corridor by tier incl. seams).
4. Stage 7 = three coupled GPU edits, not bookkeeping.
5. L∞ thin/plateau cells (`minDist` re-tune reactively; count-guard blocking).
6. Cross-consumer desync among the 9+ recomputers (per-generator determinism assert).

## References

- [[decision-grid-first-city-generation]], [[decision-streets-first-city-generation]] (grammar still in force)
- [[voronoi-diagrams]], [[taxicab-geometry]]
