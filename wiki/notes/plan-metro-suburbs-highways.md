---
tags:
  - domain/city-gen
  - status/open
  - scope/m3-plus
  - origin/external-research
---

# Plan: Metro Scale + Suburbs + Highway Crossings

**Date:** 2026-06-02
**Drives:** #14 (city scale), #13 (highways/interchanges), + a new suburbs issue.
**Grounded in:** [[highway-network-references]], [[map-layout-references]], [[plan-city-scale-tiers]], [[city-planning-references]], [[decision-tensor-field-roads]].

## Vision

One coherent move, not three features: grow the city into a **metro with a radial
density gradient** — a bright dense core that fades through suburbs to undeveloped
fringe — and let freeways become the cross-town backbone with real interchanges
where they cross. Each idea reinforces the others:

- The density gradient is **research-true** (arterial spacing widens <1 mi core → 5 mi
  fringe), **perf-friendly** (sparse periphery ≠ 4× buildings when extent grows), and
  a **night-view win** (bright core, dim sprawl, dark gaps = the real city-from-a-plane
  look). User: *"it's okay to have undeveloped areas, as well as suburban areas."*
- Freeways **need** the larger extent to host a believable ~1 mi interchange cadence;
  at today's 3 km City tier only ~1–2 interchanges fit edge-to-edge.
- Freeway **crossings** (perpendicular / off-angle) are where interchanges live, and
  they sit naturally in the **periphery**, not downtown (cheap-land history; beltway×
  radial). User: *"something perpendicular or off-angle… outside the downtown area."*

## Three density bands (radial, seed-jittered — not a clean bullseye)

| Band | Character | Buildings | Roads | Lighting |
|---|---|---|---|---|
| **Urban core** | dense grid, tall archetypes | high density, small blocks | tight grid + arterials | continuous, bright |
| **Suburban ring** | curvilinear "kidney-bean" subdivisions | low density, big curvy blocks | **tighter-grain field + wider street spacing** | sparse |
| **Undeveloped fringe** | mostly empty, occasional cluster | very sparse / none | freeways + a few arterials only | dark, key points |

The transition follows the (irregular) **district** layout, not a perfect radius — so
the core→suburb→fringe fade reads organic. Density is a per-district scalar derived
from district centroid radius + seed jitter.

## Kidney-bean suburbs — the "tighter grain" nuance

User asked: can suburbs use a tighter-grain tensor field for organic roads? **Yes —
but pair two knobs that pull opposite ways:**

- **Field directional grain** (basis `size` ↓ / count ↑ / `waviness` ↑) → roads curve
  more per unit length. Want this **tighter/wavier** in suburbs → crescents & loops.
- **Street separation** (`ST_DSEP`) → want this **WIDER** in suburbs → fewer, bigger
  curvy blocks. Real suburbs are curvy *and* coarse (cul-de-sacs), not a dense tangle.

Tighten the *field*, loosen the *spacing*. Clean to implement: the field basis is
already spatially localized (`{kind, cx, cz, size, decay}` summed in
`lib/seed/tensorField.ts`), so **add extra high-waviness, small-`size` bases in the
periphery ring** — the core is untouched and determinism holds.

## Freeway crossings + interchanges (scale-independent geometry)

- Freeways = a few **long, large-radius polylines** spanning the metro: radial spokes
  ± a partial beltway. Mainline radius ≫ arterial (radius ∝ V²; see refs).
- **Detect crossings** between freeway polylines and between freeway×arterial.
  - freeway × freeway → **system interchange** (stack / cloverleaf+C-D), large module,
    **periphery-biased**.
  - freeway × arterial → **service interchange**, one ~1.5 km module at ~1 mi cadence.
- **Angle-aware**: the crossing skew picks/rotates the module (near-perpendicular →
  stack/cloverleaf; shallow → directional/trumpet). Parallel freeways do **not**
  interchange — only crossings do.
- Stylized simplifications (safe, from refs): select type by ROW+volume proxy; treat
  interchange as a single placeable module; circular arcs (no clothoids); 50:1–70:1
  merge taper drawn on ramps.

## Stages (cheap/novel first; perf spend gated)

| Stage | What | Cost | Verify |
|---|---|---|---|
| **0 Suburbs** | radial density gradient (core/suburb/undeveloped) + per-district curvilinear character (localized tight-grain bases + wider spacing + sparse lighting) | cheap, current 3 km | gate1 + visual |
| **1 Crossings** | freeway polylines (radial ± partial beltway) → detect crossings → angle-aware interchange modules, periphery-biased | cheap, scale-free | gate1 + top-down |
| **2 Perf** | Web-Worker gen + per-tile frustum culling ([[plan-city-scale-tiers]] roadmap #1–2) | real | profile |
| **3 Scale** | extent → **City-plus (~4 km, half≈2000)** — retune camera-as-multiples-of-half | medium | gate1 + visual |
| **4 Freeways@scale** | fold crossings in at scale + tiered night lighting (CFL/CIL/PIL, high-mast clusters at cores) | medium | visual |

Stages 0 and 1 are independent enough to build in parallel worktrees; they both touch
`cityGen.ts`, so expect a non-trivial merge at integration (acceptable, done deliberately).

## Decisions

- **Extent target: defaulted to City-plus (~4 km, half≈2000)** — keeps the intimate-
  skyline soul of the After Dark homage; full Metro (6 km) risks reading as flat noise
  at orbit distance. *Revisit with the user; reversible (single `CITY_HALF_EXTENT` knob
  + the `×k` derived-constant refactor in [[plan-city-scale-tiers]]).*
- **Perf gate before scaling:** do not grow extent past ~City-plus until the Worker +
  frustum-culling foundation lands (Stage 2). The density gradient cuts building count
  but not road/streetlight/atlas growth.

## Determinism contract (every gen stage)

No `Math.random`/`Date.now`/`performance.now` in scene state; all new randomness from
seeded `seedrandom` sub-streams. `bunx tsx scripts/gate1.ts` must end **GATE 1 PASS**
(byte-identical regen + no overlaps + district band) after each stage. Seeds are not
portable across extent/lattice changes (RNG draw count shifts) — not a violation; flag
if shareable-seed URLs are ever planned.

## Open questions carried from research (gate Stage 1/3, not Stage 0)

1. Metro freeway **count** + parallel-freeway spacing for a city of size N.
2. **System-interchange footprint** (m) per type as a placeable bounding box.

(Both flagged in [[highway-network-references]]; a focused follow-up research pass can
resolve them before Stage 1 lands its final numbers.)
