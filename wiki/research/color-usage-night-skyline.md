---
tags:
  - domain/visual-language
  - domain/color
  - status/draft
  - scope/m1
  - origin/external-research
---

# Color Usage — Night City Skyline

Calibration reference for window / building / sky / streetlight colour. Inputs from real night-skyline imagery; intended to anchor future colour-balance work against reality, not just feel.

## Why this exists

Current implementation leans heavily warm-amber even in downtown office cores. User feedback (2026-05-22): "the lights all look rather warm to me." Reference imagery (Streets of Rage 1991) is actually warm-dominant too, but the warm is more *yellow* and less *orange*; cool sodium streetlights, fluorescent office cool, and TV / neon blue do appear and provide essential contrast.

This note exists so we stop tuning palette in isolation and start tuning against photographic ground truth.

## Suggested reference image sources

Pull a handful of these and save into `wiki/research/refs/skylines/` for direct sampling. Search terms that consistently surface useful night-skyline imagery:

- `NYC skyline aerial night` — financial district, midtown, east-river crossing
- `Manhattan night photography long exposure`
- `Tokyo Shibuya night skyscrapers aerial`
- `Tokyo Shinjuku night skyline`
- `Hong Kong night skyline aerial`
- `Chicago skyline night Lake Michigan`
- `Singapore Marina Bay night aerial`
- `Seoul skyline night`
- `London Canary Wharf night`
- `San Francisco financial district night`
- For the SoR-era look specifically: `1990s city night photography`, `Hopper Nighthawks`, `Stalenhag night cityscape`

For free / licence-clean source: Unsplash / Pexels / Wikimedia Commons.

A sample chart of 6-10 images, eyedropped for window colours, would be the single most useful calibration artefact.

## Real-world colour temperature distribution

In meaningful real cities, window-light colour distribution is roughly:

| Light source | Kelvin | Where it appears | % of lit windows (rough) |
|---|---|---|---|
| Incandescent residential | 2400-2900 K | Older residential, lobbies, restaurants, lamps | 15-25 % |
| Halogen / warm LED residential | 2700-3000 K | Modern residential, hotel rooms | 15-20 % |
| Neutral LED residential | 3000-3500 K | Newer residential, hallways | 10-15 % |
| Cool LED office / hallway | 3500-4000 K | Modern office, hospital, condo hall | 15-25 % |
| Cool fluorescent office | 4000-5000 K | Classic office, retail, schools | 15-25 % |
| Cool LED office (modern) | 5000-6000 K | Modern office tower, glass tower | 5-15 % |
| TV / monitor glow | ~6500 K | Residential interior at night | 3-8 % |
| RGB signage / neon | wide gamut | Commercial, downtown signage | 1-5 % |
| Sodium HPS streetlight | 1800-2200 K | Older urban streets, highways | streetlight only |
| LED streetlight (modern) | 3000-5000 K | Recent retrofits | streetlight only |

In a real night photo of a dense skyline, you should expect:

- Warm + neutral warm together account for ~50-60 % of lit windows
- Cool fluorescent + cool LED together account for ~30-40 %
- TV blue, RGB signage, accent cool reads at ~5-10 %
- Pure orange (sodium-yellow / candle-warm) is rare in modern cities — it's mostly a streetlight thing, not a window thing

Streets of Rage 1991 specifically exaggerated warm because (a) era-appropriate incandescent dominance, (b) limited Sega Genesis palette (yellow + cyan reads cleanly), (c) console artistic license. Our reference takes spirit but should not become a pure-orange field.

## What "warm" should look like in our render

Pixel-eyedropped from typical NYC midtown night photos:

| Window kind | Approx hex | Kelvin equivalent |
|---|---|---|
| Brightest warm (lobby, lamp close to window) | `#ffe0b0` | ~3500 K, high intensity |
| Standard warm residential | `#ffd590` | ~3000 K |
| Dim warm (deep room, distant bulb) | `#d49a55` | ~2400 K, mid intensity |
| Sodium streetlight cast on facade | `#e89030` | ~1900 K (streetlight only) |
| Cool LED office (modern) | `#cee0ff` | ~5500 K |
| Cool fluorescent older | `#dbe6e8` | ~4500 K |
| Neon white sign | `#e8f4ff` | ~6500 K |
| Bright cyan / blue signage accent | `#5a9cff` | gamut |
| TV blue glow | `#8aa8ff` | ~6800 K with dimming |

Note: most "warm" residential windows in real photos eyedrop closer to a *pale peach / cream* than to *orange / amber*. The amber / orange tilt happens at lower intensities (dim windows, far rooms) and in older sodium-lit areas.

## Where our current palette skews wrong

Per `lib/seed/lightingGen.ts` + `lib/color/kelvin.ts`:

| Bucket | Range | Comment |
|---|---|---|
| Dim warm | 1800-2200 K @ intensity 0.3 | Way too low. 1800 K = matchstick / candle. Most residential dim is closer to 2400 K. |
| Standard warm | 2300-2700 K @ intensity 0.55 | Too orange for "standard residential." Modern residential is 2700-3000 K. |
| Bright warm | 2800-3200 K @ intensity 0.9 | OK upper end, but at intensity 0.9 it dominates the frame. Maybe 0.75. |
| Office cool | 5000-5800 K @ intensity 0.7 | Right ballpark for modern LED. Just needs more buildings using it. |
| Neon highlight | 6500-7200 K @ intensity 0.95 | OK. Sparingly placed. |
| TV flicker | 6500 K @ intensity 0.55 | OK. |

Two structural problems beyond per-bucket tuning:

1. **Most archetypes route to residential moods**, and residential moods set `officeRatio` to 0 or near-zero. So even though office buildings exist in downtown, the population of residential windows visually outweighs them.
2. **Bright warm intensity 0.9 punches above its weight.** A small number of bright-warm windows visually drown the larger population of cool / dim windows. ACES tone mapping compresses highlights, but emissive at >1 boost still pulls eyes.

## Recalibration plan (proposed, not yet applied)

### Palette shifts

1. Standard warm: **2300-2700 K → 2700-3100 K**
2. Dim warm: **1800-2200 K → 2200-2600 K** (raise intensity to 0.4)
3. Bright warm: keep 2800-3200 K but **intensity 0.9 → 0.75**
4. Office cool: keep 5000-5800 K
5. Neutral white residential (**new bucket**): 3300-3800 K at 0.55 intensity — sit between warm and cool in mood pool

### Mood distribution

6. Add a `neutral-white` mood for residential — about 20 % of residential buildings get neutral 3300-3800 K dominant, with occasional warm + occasional cool. Reads as modern apartment LEDs.
7. Allow more *interleaving* — currently `warm` mood strictly kills office; permit small (5-10 %) office cool in `warm` mood too (because real residential floors have one cool stairwell, one TV room).

### City-wide distribution

8. Once office cool intensity is right, bias `downtown` district more strongly to office archetypes (it already is, but push further).
9. Add a "mixed-use" zone biaser where downtown abuts residential — some buildings get residential moods, some get office moods regardless of archetype.

### Streetlights

10. Streetlight colour currently `#ffc060` — slightly too cool / less amber than HPS sodium. If we want sodium-era look, push to `#ffaa44` (2000 K). If modern LED, keep current.
11. Variation: 80 % sodium amber + 20 % LED cool-white (4000 K) gives a real city mix.

## Calibration workflow (suggested)

1. Pull 4-6 reference photos into `wiki/research/refs/skylines/`
2. For each, eyedrop ~10 window pixels (mix of bright + dim + warm + cool)
3. Convert each sample to approximate kelvin via Tanner Helland reverse or visual match against our `kelvinToColor()`
4. Build a histogram: kelvin × intensity, weighted by visible pixel count
5. Compare against our `pickKelvin()` distribution
6. Tune ranges until histograms overlap

This is a 30-60 minute side task once the imagery is collected. It would produce a defensible palette that survives later reviews.

## Related notes

- [[decision-streets-of-rage-direction]] — visual style anchor that *informs* but should not *bind* the palette
- [[streets-of-rage-intro]] — the original 1991 palette breakdown
- [[building-sizes-real-world-references]] — the matching sizing reference
- [[city-planning-references]] — district structure that drives where which palette appears

## Files this touches

- `lib/color/kelvin.ts` — kelvin → RGB approximation
- `lib/seed/lightingGen.ts` — `pickKelvin`, `pickMood`, `applyMood`, profile per archetype, mood ranges
- `components/scene/Streetlights.tsx` — streetlight colour (if we add sodium / LED variation)
- `components/scene/Building.tsx` — `uEmissiveBoost` uniform (currently 1.1 — affects how hot warm appears under ACES)
