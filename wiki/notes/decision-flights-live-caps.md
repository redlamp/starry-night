---
tags:
  - domain/stack
  - status/adopted
---

# Decision: Flights + Helicopters Live "Max" Caps

**Date:** 2026-07-06. Related: [[decision-tile-cull-materialisation]].

Transport -> Flights gained live **Planes** (0-12) and **Helis** (0-10) count sliders. Helis at 0 turns helicopters off (replacing the old enabled switch). Defaults 4 planes / 1 heli.

## The cap is render-time, not gen-time

Both ambient counts were seed-baked with no runtime knob. Options for a slider:

1. **Regenerate on change** - rebuild the geometry with `count` units. Rejected: the memo recreates the `ShaderMaterial`, so a drag risks shader-recompile hitches; and helicopters' builder calls (cached) `generateCity`.
2. **Size-zero live cap (chosen)** - bake a FIXED pool per seed (`AMBIENT_PLANE_POOL = 12`, `AMBIENT_HELI_POOL = 10`), then cap visibility by zeroing the point size of units past the slider - a direct BufferAttribute write on the long-lived geometry, no rebuild, no recompile. Mirrors how the debug-spawn pool already mutates these buffers live. The slider range is seed-independent as a result.

Plane slots round-robin across corridors, so capping to the first N keeps the spread; the first two helicopters are downtown-biased, so a low cap keeps the ones in view. The airborne readout respects the cap. gate1 is unaffected - `generateCity` is untouched, and flights/helicopters ride their own rng chains, not part of the determinism gate.

Panel cleanup: three spawn buttons (Airliner / Cessna / Heli) on one row under a "Spawn" header; the corridor description blurb was removed.
