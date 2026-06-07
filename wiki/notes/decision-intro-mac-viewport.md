---
tags:
  - domain/intro
  - status/adopted
---

# Decision: Intro Mac Viewport — Stage, Model, Screen Pipeline

**Date:** 2026-06-07 · **Branch:** `intro/exploration` · **Route:** `/intro`

## Context

The intro concept: the city app displayed *on the screen of a Macintosh* in an
'80s product-photoshoot studio — and a "snow globe" effect where orbiting the
Mac shows the city from the matching angle, as if the city were physically
inside the case. Built as a self-contained exploration (`components/intro/`),
sharing the global store/seed/generation cache with the main app.

## Decisions

### Model: Daz "Macintosh 128K Computer (1984)", CC BY-NC 4.0

- Shootout against the Deutsches Museum photogrammetry scan (CC BY-SA).
  The scan's worn plastic was beautiful but its single fused mesh (computer +
  keyboard + mouse, screen baked in with reflections) made it unusable for a
  live screen. The Daz model has a **dedicated screen mesh**
  (`Computer_Screen_0`) and separable peripherals.
- Attribution kept in three layers: visible credit on `/intro`,
  `public/models/CREDITS.md`, and embedded in the GLB's `asset.copyright`.
  BY-NC is fine while the project stays non-commercial.
- A second, source-faithful instance ("stock") stands stage right via deep
  scene clone (shared geometry/materials — an Object3D can't have two parents).
- **Parked 2026-06-07** (`SHOW_REFERENCE_MAC = false`): the stock Mac is
  hidden for now, returning as the before/after yardstick when the
  material + compression work resumes. Restore is a one-line flip; the
  focus/dblclick machinery is kept intact. The molding-finish material pass
  ([#74](https://github.com/redlamp/starry-night/issues/74)) and GLB
  compression ([#73](https://github.com/redlamp/starry-night/issues/73))
  should land together so the optimized asset reflects the final look.

### Mac case finish: textured matte molding (#74, research)

The real 128K/Plus case had a fine pebble/orange-peel molding texture that
made the beige read matte and "dry" — absent on the Daz model (and not
wanted on the mouse/keyboard). Plan: a procedural `onBeforeCompile` patch on
the case meshes (`Computer_Computer_0`, `Computer_Blackplastic_0`) —
noise-driven roughness micro-variation + subtle normal grain + a soft
grazing-angle sheen — rather than authored maps. Needs reference-photo
research on the actual finish. Tracked in #74.

### Screen render chain: native-res multi-pass, process-then-filter

`city (512×342, MSAA) → colour-depth pass (1-bit dither w/ levels, greyscale,
mac-256, full) → halation pass → glass material`, all FBOs at the Mac's native
512×342. Two load-bearing rules learned the hard way:

- **Process-then-filter:** quantize/dither at native res, then let mipmapped
  minification average the *processed* raster. Dithering per canvas pixel
  against an undersampled source is a moiré generator no filter can fix.
- **Bayer strict inequality:** `step(d, lv)` is `>=`, so the dither matrix's
  zero cell paints one white pixel per tile on pure black — use
  `step(d + ε, lv)`.

The glass keeps the model's own material/texture; the raster composites over
it with a **screen blend** (black pixels show the tube, lit pixels add) via
`onBeforeCompile` injection, with raster UVs as a second vertex attribute.
Same display-space-raw contract as [[decision-facade-display-space-color]] —
the raster shader carries no tone-map/colorspace chunks.

### Glow: halation in-chain now, bloom quality-gated

Phosphor self-emission via emissive injection (`crtCol × uGlow`), and a
halation pass (7×7 gaussian gather at raster res) for in-tube light scatter —
cost is **content-resolution-bound**, identical on mobile. Full-frame bloom
(`@react-three/postprocessing`, HDR threshold) exists behind a slider for the
over-the-bezel glow but scales with display pixels — gate it behind quality
tiers before mobile ship. Scanlines run at **display sampling time** (the row
gaps are sub-texel, so they can't bake into the 342-row FBO) with an
`fwidth`-based fade that dissolves them before they can moiré when
undersampled; tuning vs reference photos tracked in
[#71](https://github.com/redlamp/starry-night/issues/71).

### Snow-globe coupling: orientation-derived orbit angles

The city camera (orthographic, street-parallel at rest — the original module's
flat-skyline look) orbits the city pivot 1:1 with the studio camera's orbit.
Angles derive from the studio camera's **look direction**, not its position,
so the coupling survives orbit-target changes (the dual-Mac gallery). The rig
walks `previousRoot` to the page root — it sits three render-portals deep.
User screen adjustments (hover = orbit/pan/zoom) become the new coupling
foundation on release; double-click the screen glides it home.

### Gestures

Double-click: a Mac → focus + orbit-tween to its frontal pose; the stage →
reset to the focused Mac; the working Mac's screen → reset the city camera.
Gotcha that cost a debugging session: **R3F pointer events fire on every
object along the ray** — the Mac dblclick also hit the backdrop behind it,
firing the stage reset that killed the focus tween. Foreground clickables
must `stopPropagation()`.

## Code

`app/intro/page.tsx`, `components/intro/*` (IntroApp, IntroScene, MacModel,
ScreenCity, studioCamera, viewMode, stageCursor), `scripts/captureIntro.ts`
(screenshot verification harness, port 7828).
