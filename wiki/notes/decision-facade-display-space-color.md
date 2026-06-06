---
tags:
  - domain/3d
  - domain/visual-language
  - status/adopted
---

# Decision: Facade Colour — Display-Space Authoring + Tunable Variance

**Date**: 2026-06-07
**Status**: adopted — root-caused, fixed, made live-tunable; defaults user-tuned live.

Companion to [[decision-correlated-window-lighting]]: that note covers how windows light; this one covers the wall behind them.

## Problem

The depth-system work (2026-06-06 morning, `0e19f2c`) replaced the Z-layer facade bands with per-building HSL jitter — but the variance was invisible at night. Sampling the capture: **every wall pixel measured (1,2,6), bit-identical to the sky.** The morning session widened the lightness range as a fix; it could not have worked at any width.

## Root cause: a colour-space mismatch, not a tuning problem

The city `ShaderMaterial` writes `gl_FragColor` **raw** — it includes neither `tonemapping_fragment` nor `colorspace_fragment`, so the renderer's ACES + sRGB output conversion never touches it. `facadeColorFor` authored colours in sRGB and converted them to linear (`setHSL(…, SRGBColorSpace)`) — correct for built-in materials, wrong here: the linear values (0.004–0.014) hit the screen directly as 1–4/255.

## Decisions

1. **Author facade colours in display space** (`setHSL` with no conversion). What's stored in the attribute is what reaches the screen.
2. **Skewed lightness** — `lightMin + (lightMax−lightMin)·r^1.4`: dark-glass majority, pale-concrete tail.
3. **Live-tunable, zero rebuild.** Sliders rewrite the per-instance colour **source** arrays (the tile-major copies that #55 cull compaction reads from — see [[decision-tile-cull-materialisation]]) and blank the cull signatures so the next frame recompacts. ~N `setHSL` calls per change; no atlas, no geometry, no regen.
4. **Hue = two families + a weighted coin.** `warmShare` (default 0.3) picks warm masonry vs cool blue-glass; hue rolls inside that family's degree window (defaults 18–40° / 198–234°). Panel sliders use hue-spectrum-painted tracks (degrees, pick-by-eye). Known v1 limits: no wrap-around across 0°, family count fixed at two — revisit if brick-reds or a third family (green-glass) are wanted; weighted palette stops is the upgrade path.
5. **Lights kill switch** (`uLightsOn`, Windows sub-header) zeroes `windowOn` in the shader, darkening per-cell windows AND far-LOD glow — the facade-debug view. Deliberately **not persisted** (and Reset turns it back on) so a forgotten toggle can't leave the city dark next session.
6. **Defaults are whisper-subtle** (sat 0.02–0.08, light 0.02–0.06, user-tuned live 2026-06-07): silhouettes lift off the sky; walls don't read as coloured. The louder look is one slider-pull away; reference stills of the vibrant round live in `samples/curated/2026-06-06-facade-variance-vibrant-*.png`.
7. **`window.__sceneStore` is exposed in capture mode** (`?capture=1`, CaptureBoot) so verification scripts can drive any store setting at runtime — used to prove the recolor and hue paths headlessly.

## Lesson

Any colour fed to the city shader must be authored **display-space** — "fixing" code by converting to linear reproduces the invisible-variance bug. Recorded as an architectural rule in the project `CLAUDE.md`. More generally: when a tuning change has no visible effect, measure the actual output pixels before tuning harder.

## Consequences

- Rendering-only: no gen inputs touched, gate1 golden unaffected; per-building colours derive from the existing `windowSeed`.
- `Slider`/`RangeSlider` gained optional `trackStyle` / `indicatorClassName` props (hue spectrum tracks).
- The debug tint palettes (`TINT_*` in InstancedCity) are still `new THREE.Color(hex)` = linear — they're deliberately loud, so it hasn't mattered, but they're technically darker than authored.
