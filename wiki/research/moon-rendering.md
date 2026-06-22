---
tags:
  - domain/sky
  - status/open
  - origin/external-research
---

# Moon — Phase, Lock-to-Sky, and Believable Rendering

Research pass 2026-06-22 (three parallel agents: observational astronomy, real-time
rendering, foundational references). Companions: [[night-sky-reference-real]],
[[star-twinkle-scintillation]]. Motivation: the moon is a flat cream disc that (a)
isn't locked to the star field, (b) has no phase, and (c) doesn't read as *our* moon.
Goal: make it believable (not photoreal), keep it cheap, and tie phase to the user's
real-world date.

**Current state** (`components/scene/Moon.tsx`, `lib/shaders/moonHalo.ts`, `DEFAULT_MOON`):
a `meshBasicMaterial` sphere (uniform `#f7f1d8`, 32×32) + additive halo billboard, placed
each frame on a sky dome via `azimuthDeg / elevationDeg / distance`. No phase, no texture,
no lighting. **`meshBasicMaterial` ignores lights, so it physically cannot show a phase.**

## 1. The "not locked to the starfield" bug — root cause

The moon is positioned at **`orbit.centerX/centerZ`** — the camera's live *orbit pivot* —
while the **stars are a fixed dome at world origin**. Orbiting is fine, but **panning** moves
the pivot, so the moon translates while the stars don't → it drifts across the star field.
**Fix:** anchor the moon to the same fixed center as the stars. Best done structurally:
parent moon + its phase light + halo + stars into **one rotating "sky group" at world
origin**, drive only that group's rotation, and let the camera orbit independently inside it.

Per-night drift of the real moon against the stars is only **~0.5°/hr (~2° over a 4-hr
evening)** — imperceptible. So a moving **orbit is unnecessary**; rigid lock + correct phase
already reads as real. (Add a ~13.2°/day eastward offset only if a date scrubber ever spans
days.)

## 2. Phase — geometry and date math

- **Synodic month = 29.53059 days** (new→new). **Illuminated fraction `k = (1 − cos i)/2`**
  (`i` = phase/elongation angle; new `i=0`→k=0, quarter `90°`→0.5, full `180°`→1).
- **Terminator is a projected semi-ellipse** (minor axis ∝ `cos i`), degenerating to a straight
  line at the quarters. Do **not** slide a circular shadow across a disc (the common fake look).
  On a lit sphere the correct elliptical terminator falls out of the light direction for free.
- **Phase from date** (pure function → compute once, store the sun-direction vector; no
  `Date.now()` in the render path, so it honours the determinism contract — the date tie is a
  deliberate, isolated product choice, not seeded scene state):
  - **Synodic approximation** (dependency-free, ±~½–1 day — plenty): epoch JD `2451550.1`
    (2000-01-06 new moon) or Walker/Duffett-Smith epoch `2444238.5`; `age = (JD − epoch) mod
    29.53059`; `i = 360°·age/synodic`; `k = (1 − cos i)/2`. JD from JS: `2440587.5 +
    unixSeconds/86400`.
  - **SunCalc** (BSD-2, ~3 KB, Meeus Ch.48): `getMoonIllumination(date)` → `fraction`, `phase`
    (0–1), and the **bright-limb position angle** (terminator tilt) — better orientation realism;
    `getMoonPosition` adds altitude/azimuth (needs lat/lng, which we don't have — position stays
    art-directed).
- **Phase ↔ sky position are coupled** in reality (crescent low near dusk, full high at
  midnight). In our abstract eternal-night city the position is art-directed via sliders, so
  phase drives the **lighting**; position stays a slider (optionally seed a believable default
  from phase).

## 3. Rendering — what the literature says to build

**Reflectance: NOT Lambert.** The defining, repeatedly-stated fact (Hapke 1963; Jensen et al.
2001) is the full moon shows **no limb darkening** — equally bright edge to centre — which a
Lambert `N·L` term cannot reproduce (it darkens the limb → reads like a shaded billiard ball).
- **Cheap correct model: Lommel-Seeliger** `reflectance ∝ μ₀/(μ₀ + μ)` (`μ₀`=cos incidence,
  `μ`=cos emission). Naturally flat across the disc. Single-scattering, so it over-predicts the
  opposition surge — a *feature* for a stylized scene.
- Optional **opposition/backscatter** term (Jensen's `B(α,g)`, `g≈0.6`) + **opposition surge**
  (full ≈ **10× brighter than half** — push lit-side emissive > 1.0 at full for ACES bloom, dim
  sharply off-full).

**Recommended build (smallest delta from current):**
1. `meshBasicMaterial` → a **lit sphere**: `meshLambertMaterial` as a quick first cut, then a
   **custom Lommel-Seeliger fragment shader** for the no-limb-darkening look.
2. **NASA CGI Moon Kit albedo** (SVS 4720, public domain, credit "NASA's SVS") — downsize the 2K
   to **1K (or 512)** for a small sky moon; `colorSpace = SRGBColorSpace`; near side faces the
   camera by default in Three.js sphere UVs; north up. Normal/displacement maps are unnecessary at
   this size.
3. **One `DirectionalLight`** for the moon; set its **direction in VIEW/screen space** from the
   phase angle (full = lit toward camera, new = away) while the moon's **position** lives in the
   rotating sky frame — decoupling "where it is" from "how it's lit" is the real relationship.
4. **Earthshine**: faint fill on the dark hemisphere that **grows as the crescent thins**
   (Jensen ≈ `0.19 × lit-earth fraction`; for us a small constant ramp `~0.04 + 0.08·(1−k)`).
   Cheap, and it's what makes a thin crescent read as real ("old moon in the new moon's arms").
5. **Horizon reddening**: warm/dim the moon at low elevation (atmospheric extinction), white/
   blue-grey high — mirror the star-chroma horizon tint.
6. **Halo**: keep the additive billboard but **scale its intensity with illuminated fraction**
   (thin crescent → little halo; full → blooms).

**Performance:** all negligible — a 48×48 sphere + one 1K texture + one directional light + one
draw call; or a shader disc (cheaper, no light) with an analytic half-ellipse terminator if ever
GPU-starved. Both far under budget.

## 4. Current slider assessment (vs research)

| Param | Current | Finding |
|---|---|---|
| **distance** | `4500·CITY_SCALE = 9000` | **Stale bug**: was tuned to the *old* `stars.radius` (also 9000); the star-radius change to `3200·CITY_SCALE = 6400` left the moon floating *beyond* the star shell. Should track `stars.radius` (sit on the dome). |
| **radiusRatio** | `0.02` → ~1.6–2.3° angular | **Oversized** — real moon is ~0.5°. Deliberate artistic enlargement is common (and the After Dark homage favours a present moon); flag, your call. |
| **elevationDeg** | `1` (≈ on horizon) | Fine, art-directed — and pairs well with planned horizon-reddening (a low moon *should* be warm/orange). |
| **azimuthDeg** | `20` | Fine, art-directed. |
| **moonHalo** | `radiusMul 2.5, intensity 1.1` (constant) | Should **scale with illuminated fraction** (a thin crescent has almost no halo). |

## 4b. Implying viewing location via moon orientation (feature)

Phase (illuminated **fraction**) is **global** — identical worldwide on a given night, so it
carries zero location info. But the moon's **orientation** (crescent tilt, lit side, face
rotation) is strongly **latitude/hemisphere-dependent**, governed by the **parallactic angle q**:

```
tan q = sin H / (cos δ · tan φ − sin δ · cos H)      // H = hour angle, δ = moon dec, φ = latitude
```

- **The one load-bearing formula:** render the disc rotated by **`χ − q`** = bright-limb position
  angle (SunCalc `getMoonIllumination().angle`) minus parallactic angle (SunCalc
  `getMoonPosition().parallacticAngle`). This single term yields the correct crescent tilt,
  the N↔S hemisphere flip, **and** the time-of-night roll — no special-casing.
- **Cues, by legibility:** (1) **tropical boat-moon (horns up) vs polar vertical backwards-C** —
  strongest, instantly readable; (2) **hemisphere flip** — waxing crescent lit on the *right* (N)
  vs *left* (S), maria/"face" ~180° rotated (the "rabbit"); (3) overhead vs low-skimming **arc**
  (`altitude_culmination = 90° − |φ − δ|`) — subtler, reinforces.
- **Stylized "place-as-a-knob" (no clock needed for orientation):** drive tilt from the
  ecliptic-horizon angle ≈ **`90° − |φ|`** (steep→boat near equator, shallow→vertical near poles),
  flip lit-side + face by **`sign(φ)`**, and rotate the maria texture to match. The agent's advice:
  **pin each "place" to its evocative extreme** rather than the true date-variable tilt — it reads
  more clearly in a stylized scene.
- **Continent → latitude** (distinct orientation bands): equator/Congo 0° (boat, near-zenith arc);
  Sahara/Mediterranean ~30°N; N. Europe ~50°N (upright, right-lit); Scandinavia/Alaska ~65°N
  (vertical C, low arc); Patagonia ~55°S (vertical, left-lit, inverted face).
- **Caveat:** SunCalc's README labels angle outputs in degrees but the JS historically returns
  **radians** — unit-test before wiring `χ − q`; keep χ and q in the same units.

So: **phase fraction from the real date; orientation tilt/flip from a chosen latitude.** Position
stays art-directed. This is the "art-directed + location flavor" path (recommended over a full
date+location ephemeris, which would also dictate position and may frame the moon awkwardly).

## 5. Foundational references

**Astronomy / phase math — "if you read only 3":**
1. **Meeus, *Astronomical Algorithms*** (2nd ed., 1998), Ch. 47 (position, truncated ELP-2000/82,
   ~10″), Ch. 48 (illuminated fraction `k=(1+cos i)/2` + bright-limb angle), Ch. 49 (phase times).
   <https://celestialprogramming.com/meeus-elp82.html> (runnable Ch.47 extract)
2. **Walker, *moontool*** (public-domain C, after Duffett-Smith) — the most-copied phase code;
   exact constants (`synmonth 29.53058868`, `epoch 2444238.5`).
   <https://www.fourmilab.ch/moontoolw/README>
3. **SunCalc** (BSD-2) — drop-in JS implementing Meeus Ch.48 (fraction, phase, bright-limb angle).
   <https://github.com/mourner/suncalc> · higher accuracy: astronomy-engine (MIT, ±1′)
   <https://github.com/cosinekitty/astronomy>

**Rendering — "if you read only 3":**
1. **Jensen, Durand, Dorsey, Stark, Shirley, Premože 2001, "A Physically-Based Night Sky Model"**
   (SIGGRAPH 2001) — the keystone: lunar BRDF (Hapke–Lommel-Seeliger, "no limb darkening"),
   earthshine as a 2nd light (const ≈0.19), phase/position appendix (<8′ over five centuries),
   avg albedo C=0.072. <https://graphics.stanford.edu/~henrik/papers/nightsky/nightsky.pdf>
2. **Hapke 1963**, "A theoretical photometric function for the lunar surface" (JGR 68) — *why* the
   regolith backscatters → no limb darkening + opposition surge.
   <https://agupubs.onlinelibrary.wiley.com/doi/abs/10.1029/JZ068i015p04571>
3. **Fairbairn 2005, "The Lommel-Seeliger Law"** (JRASC 99) — the cheap, correct-shape model
   `μ₀/(μ₀+μ)`. <https://ui.adsabs.harvard.edu/abs/2005JRASC..99...92F/abstract>

**Texture data:** NASA SVS **CGI Moon Kit** (SVS 4720) — LROC WAC albedo + LOLA normals, public
domain (credit NASA SVS). <https://svs.gsfc.nasa.gov/4720>

## 6. Implementation plan (staged)

**Phase 0 — lock + distance fix (small, high value):** parent moon + (future) light + halo +
stars into one rotating sky group at world origin; anchor to the fixed centre not the orbit
pivot; reconcile `moon.distance` to track `stars.radius`. Fixes the drift + the stale-distance bug.

**Phase 1 — phase + lit rendering (the core "our moon"):** lit sphere (Lambert first cut →
Lommel-Seeliger shader) + NASA 1K albedo; one directional light whose direction is set in view
space from the phase angle; phase from date (synodic approx or SunCalc); suppress limb darkening;
opposition emissive boost near full.

**Phase 2 — realism touches + location:** earthshine fill (grows as crescent thins; *done in
Phase 1*); horizon reddening by elevation; **halo→phase fix** (below); **location feature** — a
"place"/latitude control that rotates the disc + maria by `χ − q` (or the stylized `90°−|φ|` +
`sign(φ)`) to imply where you're viewing from; optional arc-altitude cue.

**Known issue — halo vs phase (raised 2026-06-22):** the halo is a full circular additive glow
centred on the moon; Phase 1 scales its *intensity* by the illuminated fraction, but on a crescent
it still haloes the dark limb, which reads wrong. The glow should emanate from the **lit portion** —
follow the bright limb and fade across the terminator (e.g. weight the halo by the same sun
direction `uSunDir` the body shader uses, or bias/clip the billboard toward the lit side), not
encircle the whole disc. Fix alongside the texture/location work.

**Decisions (resolved 2026-06-22):** **full pass**; **oversized** angular size kept (slider-tunable);
**SunCalc** chosen (BSD-2) — the location/orientation feature needs its bright-limb + parallactic
angles, which hand-rolled synodic can't provide; **phase fraction from real date, orientation from a
chosen latitude, position stays art-directed** ("art-directed + location flavor", not a full
date+location ephemeris). Location is chosen via a **curated place picker** (evocative places → representative latitudes →
distinct moon orientations; a raw latitude is the underlying value). Still to pick during build:
Lommel-Seeliger custom shader vs `meshLambert` quick cut.
