---
tags:
  - domain/city-gen
  - status/adopted
  - scope/m3-plus
---

# Plan: Population-Node Fields for Suburban Roads (#49)

**Date:** 2026-06-07 · design-agent deep-think after three rejected suburban
mechanisms. Drives the #49 suburbs rebuild.

**Status: COMPLETE — #49 shipped 2026-06-08.** All five stages closed (3 by
construction, 5's rural-ring deliberately dropped — see below). Verified by
seed sweep + pod-cluster renders (`samples/verify49/`), gate1, and prod build.

## Diagnosis — why all three attempts read as wrong

All three (field-waviness spike, post-trace domain warp, collector grid +
branch grower) **keep the global lattice topology and try to disguise it**.
Real suburban fabric has four structural properties ours lacks:

1. **Hierarchy with sharp interior disconnection** (load-bearing): a real
   subdivision connects to the arterial frame at 1–2 collector mouths and is
   otherwise a sealed interior of loops/culs — you cannot drive straight
   across it. Our streamlines are through-lines by construction.
2. **Grid suppression except section-line arterials**: Phoenix = rigid 1-mile
   arterial grid, *zero* grid inside the mile squares. We kept a fine global
   street grid everywhere and merely widened/wobbled it — bearings stay
   globally coherent, so it still reads as grid.
3. **Curvature coherence around a local centre**: real crescents are
   concentric *about something* (loop centre, park, hill). The warp's global
   plane-waves and the branch grower's centreless constant-curvature arcs
   both fail this — hence the "AI slop" read.
4. **Connections as desire lines between places**: collectors run
   tangentially/diagonally between subdivision entrances, nodes, and the
   core. Our network has no concept of a destination.

## Recommendation — population-node radial fields (cross-faded seam)

- **Seed neighbourhood nodes** Poisson-disc in the suburban band (~450–650 m
  spacing dense-suburb → 900–1200 m rural; deterministic fixed-order scan,
  stream `::suburb::nodes`).
- **Per-node local radial basis** (existing `kind:"radial"` math: major
  eigenvector = concentric rings = crescents, minor = spokes = entries),
  tight size ≈ 0.6× node spacing, elliptical squash + θ jitter.
- **Trace suburb-band minor streets against the node field** (per-pod nested
  ring seeds), NOT the global field — the global street grid is simply not
  traced out there. Arterial spokes keep the existing gate/taper.
- **Connectors** = node→nearest-arterial, node→node (1–2 neighbours),
  node→core: the tangential/diagonal desire lines (stream
  `::suburb::connectors`).
- **Seam**: cross-fade `w_node = smoothstep(CORE_T, SUBURB_T, density)` — at
  core densities the field is bit-identical to today's (core byte-stable by
  construction). Hard switch is the fallback if tier-8 cost bites.
- **Density follow-through**: development clusters by node proximity —
  `keep = radialClark × lerp(0.05, 1, nodeProx)` in sub-core bands, replacing
  the flat 150 m hash read; pod centres filled, inter-pod gaps dark. Cell
  hash unchanged (no new draws) — only the threshold moves.
- **Rural option** (folded from alternatives): ring collector traced along a
  density isocontour (`radiusAt(threshold, θ)` already exists).
- Rejected alternatives: Voronoi-edge collectors (reintroduces planar-graph
  fragility per [[decision-tensor-field-roads]]; keep only its node-graph
  idea), pushing the warp harder (cannot fix topology).

## Perf (the #63 lesson — sample() is the hot loop)

Grid bases: 64 @ tier 3 / 256 @ tier 6 / ~441 @ tier 8; naive +500–800 node
bases is ~3× sample cost in the band. Mitigations: **spatial index over node
bases** (3×3 cell sum — O(local) per sample; leave the global field's
`sample()` untouched for byte-stability), per-band field switching (core
never touches the node field), node spacing tied to `genScale()`. Profile
with `startStreetsProfile` at tiers 3/6/8; merge gates on no regression.

## Staged plan (each stage: gate1 + /plan tier 4 + 6 + scene capture)

1. ✅ **Node field, off by default** (`suburbField.ts` + basis index, w=0 —
   byte-identical output; profile baseline). *(2026-06-07)*
2. ✅ **Pod tracing in the band** (replace suburban minor-street pass; retire
   warp + branch grower + suburb collector ramp). *(2026-06-07 — band stop at
   sub 0.28, not the planned cross-fade: pods sep-test against the thinning
   grid at the seam, no tensor blending needed. Buildings thinned in-band
   until Stage 4 redistributes them onto pods.)*
3. ✅ **Connectors** — DONE BY CONSTRUCTION (Stage 2): `buildSubdivisions`
   anchors each pod spine to existing roads (AnchorIndex, 2nd mouth,
   branch-tip snap within 80 m) + the gap filler routes unserved pod land to
   the nearest pod street. Pods reach the arterial frame; gate1's
   corridor/connectivity asserts pass; the seed-sweep render shows pods tied
   into the grid edge. A separate tangential desire-line router was
   deliberately NOT built — it reintroduces the planar-graph fragility
   [[decision-tensor-field-roads]] warns against, for a payoff the anchoring
   already delivers. Closed. *(2026-06-08)*
4. ✅ **Density coupling** — node-proximity in `buildDevelopmentMask`
   (`keep = keepProbForDensity × lerp(0.05,1,nodeProx)`, ramped in across the
   seam by `suburbAmount` so the dense belt + core are untouched; cell hash
   unchanged → core byte-stable). Building fill re-samples the SAME node set
   the streets used (byte-identical list). Buildings ~19-21k → ~15-17k as
   inter-pod / inter-hamlet stragglers go dark; pods + rural hamlets read as
   distinct clusters (`samples/verify49/podClusterPng.ts`). gate1 + determinism
   PASS. *(2026-06-08)*
5. ✅ **Per-tier spacing + per-seed variety** — DONE & VERIFIED. Node spacing is
   density-tied (`SPACING_ANCHORS`, scales with the radial field across tiers —
   tight inner, sparse rural on every seed). Per-seed variety confirmed by the
   4-seed sweep: grid orientation (axis-aligned vs ~45°), arterial topology
   (curved sweeps, kinked detours), and the central feature all differ — not
   samey rerolls. The **rural ring-collector was deliberately DROPPED** (not
   deferred): a road traced along a density isocontour is by construction a
   concentric ring — the exact "Star Wars death star / lots of circles" read
   the user rejected twice. Closed. *(2026-06-08)*

## Follow-ups (out of #49 scope — file as new issues if pursued)

- **Rural hamlet collector** — if the rural rim ever reads disconnected
  in-scene, a BROKEN/organic collector linking a few rim hamlets (NOT a ring,
  NOT a clean isocontour) could tie them in. Subtle to get right; only chase if
  the live scene shows stranded hamlets.
- **`ST_BAND_STOP` tuning** — the seed sweep shows the orthogonal grid still
  owns most of the disc; pods are a rim garnish. The grid yields to pods at
  sub 0.28 (≈ density 0.42 ≈ r ≈ 1.6 km). Lowering it hands more of the
  mid-band to pod fabric — the highest-leverage knob for *more suburban
  character*, but it shifts the grid↔pod hand-off, so it needs a gate1 + render
  pass. Higher payoff than a rural ring if pushing suburban feel further.

Files: new `lib/seed/suburbField.ts`; `tensorStreets.ts` (replace suburban
pass, connector router); `density.ts` (nodeProx in dev mask);
`cityGen.ts` (node list cached beside roads, mask threading);
`PlanView.tsx` (node/connector debug overlay). New streams: `::suburb::nodes`,
`::suburb::connectors`. Hard constraints: gate1 PASS, core look stable,
RoadPoly contract, sketch (#40) bypass, worker-rebuildable from (seed, extent).

Relates: [[plan-metro-suburbs-highways]], [[decision-density-gradient-model]],
[[decision-tensor-field-roads]], [[highway-network-references]].
