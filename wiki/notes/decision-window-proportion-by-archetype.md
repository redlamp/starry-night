---
tags:
  - domain/3d
  - domain/visual-language
  - status/adopted
  - scope/m2
---

# Decision: Window Proportion by Archetype

**Date**: 2026-05-27
**Status**: adopted — resolved in a short grill-with-docs session.

Amends the scope boundary in [[decision-streets-first-city-generation]] and `CONTEXT.md`, which deferred *fenestration* as out-of-scope ("does not survive at orbit distance"). In practice windows read clearly at the current orbit camera, so an archetype-level form of fenestration — *window proportion* — is admitted to v1. Fine street-level detail (individual mullion patterns, ground-floor glazing, spandrels) stays deferred.

## Problem

Every building used the same global window-to-cell ratio (`uWindowWidth=0.3`, `uWindowHeight=0.5`) and the same grid pitch (`WINDOW_PITCH_M`, floor pitch). All buildings looked like the same curtain-wall regardless of style. We want window character to read per building: skyscrapers = large near-full glass, warehouses = wide short bays, older/heritage buildings = small punched windows.

## Decisions

1. **Driver — archetype base + age modifier.** Each of the 7 archetypes maps to a base window size + grid pitch. Buildings in *Heritage* districts (`building.district === "oldtown"`) get an age modifier (smaller, denser windows). Chosen over zone (too coarse) and archetype-only (doesn't encode "older").
2. **Vary both fraction and pitch.** Per-archetype glass-to-cell fraction *and* grid pitch (m/window) vary. Pitch feeds `colsPerFace`/`floors` at generation; fraction feeds the shader.
3. **Per-building jitter.** Small seeded ± variation on fraction + pitch so same-archetype neighbours differ — keeps the city organic, still deterministic.
4. **Split the panel.** *Anti-Aliasing* section keeps AA/LOD/occupancy. A new *Windows* section carries per-archetype window controls.
5. **Fraction live, pitch baked.** Per-archetype fraction is live-tunable via the panel (shader reads it per fragment by archetype index — selected with a constant-bounded loop, not dynamic uniform indexing, for GLSL ES 1.00 portability). Grid pitch ships as tuned code defaults (not a slider) to avoid rebuilding the city mesh + window atlas on every drag.

## Why it's reversible-but-notable

Reversible (rendering feature, no data migration), but it overturns a documented out-of-scope line, so a future reader seeing fenestration in v1 would otherwise wonder why. Hence this note.
