---
tags:
  - domain/visual-language
  - status/adopted
  - scope/m1
  - origin/external-research
---

# Decision: Streets of Rage as direct visual anchor

**Date**: 2026-05-21

## Context

PRD §3 listed Streets of Rage as one of several references alongside Stalenhag, Hopper, Ghost in the Shell, Berkeley Systems Starry Night. User decided to commit Streets of Rage 1991 intro screen as the *direct, primary* reference for v1 color, shape, and layout — not just one of many influences.

Reference image lives at [[streets-of-rage-intro]].

## What this commits us to

- **Sky**: deep navy `#0a1838`, not pure black. PRD §8 open question on sky color resolved.
- **Three depth layers**: foreground silhouette / mid teal tower / distant back. Reduces from earlier "5 rows" implementation to three meaningful strata.
- **Building palette by row, not by archetype alone**:
  - Front: near-black `#0a0a14`
  - Mid: teal-cyan `#3a7da0`–`#4a9bb8` with body glow
  - Back: dark navy `#10151f`
- **Windows are warm-only** for now: amber/yellow `#f0c060` family, dim amber, occasional TV-blue flicker. The "office cool" cyan I had earlier is dropped from v1 — it doesn't match the source. Reintroduced later as a style variant if it earns its place.
- **Streetlights and road dashes** confirmed as backlog items that will pay off once visible. Bottom 20-25% of frame should become a street layer in a future milestone.

## What this does NOT commit us to

- Sprite-art pixel rendering. We stay 3D low-poly. The Streets of Rage reference informs *colour, layering, density, and composition* — not the pixel-art rendering style.
- Symmetric tiling. SoR tiles for horizontal scroll. Our city is a finite seeded skyline; symmetry isn't required, but mirrored composition is welcome.
- 16-bit fidelity constraints. We can use ACES bloom-friendly emissives that the original couldn't have.

## How to apply

- Update PRD §3 to flag Streets of Rage as the primary direct reference (others remain as supporting influences)
- Change sky background colour
- Rework lightingGen palette to drop OFFICE_COOL, expand warm family
- Building facade colour becomes row-aware (front/mid/back)
- Add `glowIntensity` notion to mid-row buildings so the facade itself contributes light
- Streetlights + road = backlog tickets, scoped after still-frame approves

## Open

- How strong should the mid-tower "body glow" be? Subtle ambient emissive vs visible bloom-friendly value. Iterate during M1 review.
- Front-row should be near-pure silhouette; consider near-zero window count on front-row archetypes.
- Symmetry: keep procedural irregularity or bias toward mirrored composition? Default to procedural irregularity, revisit after still review.
