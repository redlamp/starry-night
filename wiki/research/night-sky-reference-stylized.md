---
tags:
  - domain/sky
  - status/open
  - origin/external-research
---

# Night-Sky Reference — Stylized + the Original (for #26)

Research pass 2026-06-04 (agent-gathered). Companion:
[[night-sky-reference-real]].

## The original After Dark "Starry Night" (primary source: `evangreen/starryn` C recreation)

- **Flat black sky, no gradient.** Atmosphere = sparse stars + warm window
  pixels, nothing else. <https://github.com/evangreen/starryn>
- **Stars accrete 12/update and never twinkle** — the iconic beat is the slow
  fill, not animation. (Our intro reveal is the spiritual descendant.)
- **Top-weighted density**: `StarY = rand² × Height` — quadratic clustering
  toward the sky top, thinning to the skyline.
- **Star color** `RGB(rand%180, rand%180, rand%256)` — cool blue-white bias,
  zero warm stars; warmth lives in the windows (`RGB(248,241,3)`).
- One red flasher on the tallest building (1700 ms); skyline pans on a 5-min
  loop; shooting stars rare (≤ every 25 s, ~1 s, 4 px taper).

## Stylized games

- **Outer Wilds**: no skybox — per-star camera-facing billboards, per-star
  size/color/twinkle, HDR bloom. = our additive point-sprite approach.
  <https://www.youtube.com/watch?v=Ipl7EVDsExk>
- **BotW/TotK**: stars fade in by subtracting per-pixel skylight — drive star
  opacity from a sun-elevation/dayFactor uniform, never hard-switch.
- **Layered procedural stars** (GDQuest/Godot convention): 2–3 stacked layers
  at different scales/densities, top layer twinkles most — depth without
  parallax.
- **Minecraft shader packs**: stars / milky-way band / aurora / comets as
  SEPARATE toggleable layers with independent brightness — tune without
  re-authoring.
- **Firewatch**: fog color from a 1D gradient LUT by distance, not physical
  scattering — highest-leverage stylization move for horizon haze.
  <https://medium.com/gametextures/the-tech-art-direction-of-firewatch-f10c30f6b7be>

## Film / painting

- **Van Gogh**: hero stars = tight incandescent core + wide low-alpha halo;
  radiance faked by outward color gradation. Complementary colors JUXTAPOSED
  (cool ultramarine sky vs yellow stars), not blended — keeps night vibrant.
  Swirls are statistically real Kolmogorov turbulence → curl-noise-warped
  band if we ever add one. <https://physics.aps.org/articles/v12/45>
- **Ghibli**: night is luminous violet-blue, never black — darkest value
  should be saturated indigo, warmth from scattered window lights.
- **Pixar principle**: low-key but high-chroma; emissive >1.0 + ACES carries
  the luminosity, the sky base stays mid-dark saturated.

## Three.js techniques (published)

- **Interleaved Gradient Noise dither** (1-liner) on the sky gradient to kill
  8-bit banding — the #1 risk for smooth dark gradients.
  <https://blog.frost.kiwi/GLSL-noise-and-radial-gradient/>
- Three-stop vertical gradient via smoothstep on view-dir Y.
- Procedural stars: thresholded layered noise on the sphere, density via a
  `1/density` power; twinkle = `sin(uTime·speed + seed)` — determinism-safe.
  <https://discourse.threejs.org/t/starry-shader-for-sky-sphere/7578>
- Custom fog via `onBeforeCompile` (replace fog chunks): mix near/far fog
  colors by factor, optional noise-perturbed depth for drifting haze —
  relevant to #54. <https://snayss.medium.com/three-js-fog-hacks-fc0b42f63386>
- Optional Bayer/blue-noise post dither for an overt retro register honoring
  the pixel original.

## Synthesis (next sky iteration)

Original DNA to keep: cool sparse top-weighted stars + warm windows + slow
reveal + rare shooting star. Upgrades: (1) dithered 3-stop indigo gradient
(never pure black), (2) HDR star sprites + a few Van Gogh halo heroes,
(3) magnitude-weighted density ([[night-sky-reference-real]]), (4) horizon
haze from a 1D ramp (ties into #54), (5) warm-vs-cool juxtaposition with
emissive >1.0 under ACES.
