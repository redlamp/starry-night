---
tags:
  - domain/sky
  - status/open
  - origin/external-research
---

# Night-Sky Reference — Real-World (for #26)

Research pass 2026-06-04 (agent-gathered, renderer-actionable). Companion:
[[night-sky-reference-stylized]].

## Skyglow over a city

- Horizon-anchored dome: Bortle 6 = grayish-white within ~35° of horizon;
  Bortle 7 = light gray across the whole sky; Bortle 8 = gray-to-orange.
  Render: vertical gradient, lit zone in the bottom ~30–40°, zenith darkest.
  <https://en.wikipedia.org/wiki/Bortle_scale>
- Color by lamp stock: sodium cities → orange (~3000 K); LED cities →
  blue-white. Distant clear-night glow trends red (Rayleigh strips blue).
  Default: warm orange-brown near horizon → desaturated blue-gray higher.
  <https://srussenschuck.com/color-balance-of-the-night-sky/>
- Star counts collapse: dark sky ~2,600–4,500 visible; Bortle 6–7 ~300–900;
  city core <100. NELM: B7 = 4.6–5.0, B8 = 4.1–4.5 → cull below mag ~4.5
  for a city look. <https://lovethenightsky.com/how-many-stars-can-i-see/>
- Milky Way is GONE from Bortle 7 up — omit for a city scene.
- What survives: moon, bright planets, Sirius/Vega/Orion-belt-class stars.

## Star rendering numbers

- Cumulative whole-sky counts: mag<0 ≈ 4 · ≤1 ≈ 13 · ≤2 ≈ 49 · ≤3 ≈ 176 ·
  ≤4 ≈ 525 · ≤5 ≈ 1,649 · ≤6 ≈ 5,126 — **~3× per magnitude band**. Halve per
  hemisphere. Use as the spawn distribution.
- Brightness follows 2.512× per magnitude (mag1 ≈ 100× mag6). Mostly-faint
  field + a handful of standouts is the correct read — uniform fields
  over-read as dense/bright.
- Color: nearly all stars read white-ish to the eye; saturated color is rare
  (Betelgeuse/Antares red, Rigel/Vega blue-white). Desaturate the kelvin tint
  for the bulk; reserve saturation for the ~dozen brightest.
- Twinkle is ELEVATION-dependent: strong near horizon (many airmasses),
  near-steady at zenith — scale amplitude ~1/sin(altitude). Planets don't
  twinkle (finite disk averages turbulence) — steady "planet" points are a
  cheap authenticity cue.

## Moon

- Constant ~0.5° apparent diameter — never scale by elevation (the horizon
  "huge moon" is perceptual; faking it is an aesthetic choice, not physics).
- 22° halo: ring radius 21.84°, sharp inner edge, reddish inner → bluish
  outer, dark gap between moon and ring; needs cirrus. DISTINCT from the
  close aerosol corona we already render — both can coexist.
- Full moon kills ~90% of naked-eye stars and tints the sky deep desaturated
  BLUE (reflected sunlight Rayleigh-scatters) — cool-blue dome around the
  moon layered over the warm pollution horizon.
- Airglow: green band brightest 10–15° above horizon — camera-only color;
  subtle option, not a feature.

## Recommendations distilled

1. Magnitude-weighted star field (~3×/band, 2.512× brightness law), capped
   ~mag 4.5.
2. Desaturate most stars; saturated kelvin only for the brightest dozen.
3. Elevation-driven twinkle; 1–3 steady planet points.
4. Sky gradient: cool dark zenith → warm ~3000 K horizon band (bottom
   30–40°).
5. Moon: constant 0.5°, optional true 21.84° halo ring layer; moonlit mode =
   cool-blue dome + hard star cut.
