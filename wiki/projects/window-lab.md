# Window Lab

`/window-lab` — a standalone bench for trying window/building render
constructions "untethered from the existing solutions" (user, 2026-07-03).
Born from #82: the production shader's fixes kept trading one artifact for
another, so the lab isolates the rendering question from the city.

## Bench

- Deterministic specimen rack reproducing the three #82 regimes: graze wall /
  mid cluster / far forest, plus a suburbs group. Two slots (A at x=0, B at
  x=+900) render the same rack side by side; approach registry = add a file +
  one entry in `approaches/index.ts`.
- Shareable state via `?a=&b=&pose=` (+ `ta=`/`tb=` texture views); camera
  presets per regime; perf HUD; ground outlines.
- **Texture-layer dropdowns** (per slot): final render / cell atlas / window
  field — see how the textures compose. Mirrored in the main app as
  Debug → Windows layers, where the field view is render-mode-aware (classic
  grayscale mask ↔ hybrid blue analytic field: the gray↔blue flip is a
  one-look check that the mode toggle reaches the GPU). This view is what
  cracked [[window-lod-moire-diagnosis]] rounds 4–5.
- **TextureInspector** (atlas / kind-map / SDF, ½×–16× NN zoom) and
  **TextureHoverTip** (per-face sources, side labels, dblclick focus tween).
- Colour parity contract: bakes reproduce the shader's raw-framebuffer write
  (sRGB decode × emissive boost, clamped) via shared `bakeCommon.collectCells`
  — slot B must not overstate lit area or hue.

## Approaches and findings

| # | Approach | Finding |
|---|----------|---------|
| 1 | Current shader (production miniaturised, pinned defaults) | The control. Now carries `aMeanLit` + `uRenderMode` so it tracks production's hybrid mode. |
| 2 | Baked facade + mips (plain textures, trilinear + aniso) | Confetti-free at distance but grey/muddy — linear mip averaging of warm-on-dark is physically right, perceptually wrong; ~53 MB at city scale. Far-field reference for coverage, not colour. |
| 3 | Baked SDF (per-axis pane distances, RG texture) | Crisp at any zoom from 16 px/cell; exact square corners by construction (two 1D fields intersected — a combined field bows corners, the classic SDF-text problem). +50 % bake memory; minification approximate. |
| 4 | Atlas + SDF (1 texel per window + analytic field) | **The winner**: ~340× memory reduction vs 16 px bakes; near field crisp (analytic mask), far field ≈ coverage. Sketch of the production hybrid — no field texture at all since pane rects are per-building. |

## Outcome

Approach 4's construction shipped to production 2026-07-03 in two waves: the
morning port (hybrid mode: `paneCoverage()` box-filter mask + `aMeanLit` far
field, tagged `v2026.07.03`) and the evening far-field v2 (the flat mean
replaced by approach 4's OTHER half — a trilinear-mipped twin of the packed
atlas, so the LOD-on far field shows the real lit pattern box-filtered).
Details: [[window-lod-moire-diagnosis]] rounds 4–5 + "Far field v2",
[[decision-shader-varying-precision]], [[decision-window-lod-headroom]] (the
window LOD now defaults off — reserved for a future complex near shader).
The baked routes (2/3) stay in the lab as references; the lab itself remains
the sandbox for future window/facade experiments.

## Gotchas collected

- drei `CameraControls` ref attaches after parent effects (R3F mounts Canvas
  children late) — pose presets need a state-ref, not a useRef.
- An unbound instanced attribute reads (0,0,0,1): a rack importing the
  production shader without `aMeanLit` silently blackens hybrid paths.
- Lab uniforms (`uFrac`) dodge the varying-ulp family entirely — one reason
  the lab never reproduced round 5's grain; production's per-instance
  attributes are the difference.
