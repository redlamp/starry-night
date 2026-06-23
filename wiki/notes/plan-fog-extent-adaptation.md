---
tags:
  - domain/sky
  - status/open
  - scope/m2
---

# Plan — Fog/Haze Adapt to Extent + Focal Distance (#54)

Agent-scoped 2026-06-23. Companion: GitHub #54.

## Immediate bug (user repro 2026-06-23): fog keys off CITY CENTRE, not the focal/target

At ~1693 from an **off-centre** skyscraper cluster, the buildings are fully fogged. `FogTicker`
computes `d = |camera.position → CITY_CENTER|` and sets the fog brackets as fractions of `d`
(linear: `near = d·fog.near`, `far = d·fog.far`; exp2: density solved for a fixed amount at the
centre). So when the camera sits near the centre but looks out at a far off-centre cluster, fog is
calibrated to the *small* centre distance and the cluster (beyond `far`) fogs out.

**Fix (do first):** key `d` off the camera→**focal/orbit-target** distance (what you're actually
looking at), not `CITY_CENTER`. The orbit target / focal point is available (orbit.centerX/Z or the
camera lookAt / `cameraLive`). Verify with the exact repro (1693 from the off-centre cluster → cluster
no longer fogged).

## Broader extent adaptation (the rest of #54)
Derive one **displayed extent** = `CITY_TIERS[citySize] × cityShapeScale` (resolve `auto` shape;
`square` = uncropped) that the LOOK layer keys off; world BOUNDS (ground disc, star dome, far clip)
stay on the gen tier.
- **Fog** (`FogTicker.tsx`): keep the camera-distance anchor (now focal-distance), but express fog
  far as a margin past the displayed radius so the far edge of the city stays visible regardless of
  tier; rebalance exp2 density to the far displayed edge (not the centre).
- **Haze** (`GroundHaze.tsx`): radius from the displayed extent, not `citySize` (a cropped Metro
  currently hazes far beyond the visible skyline). Keep vertical extents (`topY/bottomY`) unscaled (#47).
- **Sky-dome glow**: leave (direction-space, already scale-independent).
- Lock the City baseline visually identical (regression gate). Overlaps **#56** (camera-follows-crop)
  — bundle so fog + camera distance tune against the same captures.

## Files
`components/scene/FogTicker.tsx` (focal-distance + extent margin), `components/scene/GroundHaze.tsx`
(radius from displayed extent), `lib/state/sceneStore.ts` (`displayedRadius` selector; `DEFAULT_FOG`).
Leave `Ground.tsx`, `SkyGradient.tsx`, far-clip (world bounds). cityInstanced display-space colour
exception untouched (fog/haze colours are CSS strings / dedicated shaders).

## Verification
Multi-tier visual: Truck Stop / City / Metro + a cropped case, at near/default/far camera; plus the
exact off-centre-cluster repro. Regression: default tier+seed before/after visually identical.
