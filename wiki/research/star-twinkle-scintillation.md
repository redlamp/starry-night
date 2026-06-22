---
tags:
  - domain/sky
  - status/open
  - origin/external-research
---

# Star Twinkle — Atmospheric Scintillation (physics, rendering, model spec)

Research pass 2026-06-22 (three parallel agents: physics, implementation/shaders,
foundational white papers). Companions: [[night-sky-reference-real]],
[[night-sky-reference-stylized]]. Motivation: the v1 twinkle (per-star sine, ~0.25–1.7 Hz)
read as slow synchronised *undulation*, not scintillation. Goal: a model that "looks
accurate to a starry night seen in nature" and stays cheap.

**Verdict up front: keep the chassis, replace the signal.** The current architecture
(seeded per-star attributes → vertex shader → single `THREE.Points` draw call → one shared
`uTime` uniform) is the *correct, performant* design and is essentially what the realism
reference (Stellarium) uses. Everything wrong is in the *signal* we drive through it
(waveform, spectrum, amplitude law, missing colour) — additive fixes, not a teardown.

## 1. What twinkling actually is

Scintillation = **high-altitude** (~10–15 km, jet-stream) refractive-index turbulence
focusing starlight into a drifting bright/dark "flying-shadow" pattern on the ground.
Distinct from *seeing* (near-ground wavefront tilt → blur). Scintillation is the 2nd-derivative
(curvature/focusing) effect and needs propagation distance to form, so it is `h²`-weighted by
altitude. A star is a point source (<0.05″); the whole image passes one coherent column → it
modulates coherently → twinkles.

- **Cause / scales:** Kolmogorov spectrum `Φ_n(κ) ∝ C_n² κ^(−11/3)`; Fried parameter
  `r₀ ≈ 10 cm` @500 nm (`∝ λ^(6/5)`); Fresnel-zone granularity `r_F = √(λh) ≈ 7 cm`.
- **Temporal (the big v1 miss):** frozen-flow pattern blown across the eye by high-altitude
  wind (20–50 m/s) — **wind speed is the twinkle clock**. Power spectrum is **flat to a knee
  of a few–~16 Hz, then rolls off as `f^(−11/3)`**; physical energy reaches ~50–100 Hz.
  Correlation time **τ₀ ≈ 6 ms**. The eye (flicker-fusion + ~50–100 ms persistence)
  low-passes this to **~6–7 visible twinkles/sec**, perceived swings in the **~10–30 Hz** band.
  *Twinkle is fast and broadband, not a 1 Hz pulse.*
- **Statistics:** intensity is **log-normal** (weak/Rytov regime). Use a multiplicative
  modulation `×= exp(X − s²/2)` (mean-preserving), not symmetric additive noise — this gives
  the asymmetric dimming + occasional flare the eye expects.
- **Amplitude vs elevation:** scintillation index `σ_I² ∝ (sec z)³` (up to `(sec z)⁴` for
  longitudinal wind; long-exposure empirical fit ≈ 3.5). Naked-eye `σ_I ≈ 0.1–0.3`. Horizon
  stars twinkle **~8×+ harder** (in variance) than the zenith — the single strongest "looks
  real" cue, and it matters for a cityscape skyline.
- **Chromatic flashing (real, worth adding):** atmospheric dispersion smears a low star into a
  tiny spectrum (`∝ tan z`: ~1.4″ at 45°, ~2.4″ at 30°, ~0 overhead), and the R/G/B sub-images
  scintillate **semi-independently** → the colour you see shifts moment to moment. Kornilov
  2011: at naked-eye apertures colour scintillation is **~0.1 in power / ~0.3 in amplitude** of
  the total — measurable, not artistic licence. Strongest for **bright, low, blue-white** stars
  (Sirius, Vega, Rigel); warm stars only flash red↔amber↔white. **The flash gamut is bounded by
  the star's own colour temperature** (a star can't flash a colour it doesn't emit). Faint stars
  stay grey (seen by colour-blind rods, scotopic).
- **Why planets/Moon don't twinkle:** angular size, not brightness. A ~10 cm cell at ~10 km
  subtends ~2″; objects above the **~2–3″** threshold are a mosaic of decorrelated point shadows
  that average out. Mars 3.5–25″, Venus 10–66″, Jupiter 30–50″, Moon ~1800″ — all steady.
  (Our planets are already forced steady — correct. Exception: any object flickers when *very*
  low / high-airmass.)

## 2. How it's rendered in practice

- **Realism reference — Stellarium** (GPL, `StelSkyDrawer.cpp`): twinkle is altitude-weighted,
  **dim-only**, **luminance-only (it does NOT pulse star size)**, and off without atmosphere.
  Formula: `luminance *= (1 − altFactor · userAmount · rand)`, `altFactor = min(1, 1 − 0.9·sin(alt))`.
  Caveat: it uses a per-frame `getRandF()` (non-deterministic, frame-rate-coupled) — **we must
  swap that for analytic noise on `(seed, uTime)`** to honour the determinism contract.
  <https://github.com/Stellarium/stellarium/blob/master/src/core/StelSkyDrawer.cpp>
- **Cheap faithful primitive:** band-limited noise (one-pole low-pass τ≈10 ms over white noise →
  flat→`f^(−11/3)`; add a slow ~1–2 Hz pole), **or** a sum of 3 incommensurate sines
  (e.g. 1×/2.3×/4.7×) with seed-keyed phase — pure per-vertex ALU, deterministic.
- **Colour flash:** three decorrelated R/G/B signals (120°-offset phases), gated by airmass ×
  brightness. Per-channel — *not* a shared hue rotation.
- **Avoid (out-of-architecture):** full-screen ray-marched starfields (Star Nest / Casual
  Effects — per-pixel, "twinkle" is just anti-alias jitter); PSF-textured billboards + baked
  diffraction spikes (tiffnix/Celestia — needs textured quads, fill-rate heavy, reads as
  "telescope photo" for a naked-eye sky). Diffraction spikes, if ever wanted, belong only on the
  few brightest stars.
- **Perf:** per-vertex analytic modulation at 24k points is effectively free (one vertex/star,
  single draw call); analytic sum-of-sines beats a noise-texture fetch (no bandwidth,
  deterministic, infinitely scrollable in time). Watch-outs: under ACES + additive blending,
  **dim-only** matters (brightening clips bright stars to white and shimmers); keep a floor so a
  star never blinks fully off and then bloom-pops.

## 3. Foundational white papers

**Physics — "if you read only 3":**
1. **Dravins, Lindegren, Mezey & Young 1997, "Atmospheric Intensity Scintillation of Stars. I"**,
   PASP 109, 173 — *the* most relevant paper; high-speed photometry → temporal statistics + power
   spectrum + confirms log-normal. Open via ADS.
   <https://ui.adsabs.harvard.edu/abs/1997PASP..109..173D/abstract>
2. **Osborn, Föhring, Dhillon & Wilson 2015, "Atmospheric Scintillation in Astronomical
   Photometry"**, MNRAS 452, 1707 — clean modern open formulas (amplitude / elevation / aperture).
   <https://arxiv.org/abs/1506.06921>
3. **Roddier 1981, "The Effects of Atmospheric Turbulence in Optical Astronomy"**, Progress in
   Optics 19, 281 — conceptual backbone: r₀, Fresnel filter, frozen flow. (Paywalled; formulas
   restated in Osborn 2015.)

Also: **Tatarski 1961** *Wave Propagation in a Turbulent Medium* (foundational, free scan on
Internet Archive); **Young 1967** (the `σ² ∝ (cos z)^−3 · D^−4/3 · t^−1` scintillation-noise
formula); **Kornilov 2011** MNRAS 417, 1105 (chromatic scintillation quantified); **Dravins II
1997** PASP 109, 725 (wavelength dependence). Caveat: the literature measures through telescopes
(apertures ≥ several cm); the naked eye is *smaller* → strongest-scintillation regime, so
extrapolating toward stronger, more chromatic flicker than the published telescope curves is
justified, not a contradiction.

**Graphics — "if you read only 3":**
1. **Jensen, Durand, Stark, Premože, Dorsey & Shirley 2001, "A Physically-Based Night Sky
   Model"**, SIGGRAPH 2001 — the night-sky baseline (magnitude→radiance, temperature→colour);
   stars are static (no twinkle), so it's the framework a twinkle term sits on top of. Open PDF.
   <https://graphics.stanford.edu/~henrik/papers/nightsky/nightsky.pdf>
2. **Ritschel et al. 2009, "Temporal Glare"**, EG 2009 — real-time GPU *time-varying* eye-PSF
   glare; nearest prior art to animated twinkle/sparkle.
   <http://people.compute.dtu.dk/jerf/papers/TemporalGlare.pdf>
3. **Kakimoto et al. 2005, "Glare Generation Based on Wave Optics"**, CGF 24(2) — diffraction
   spikes/corona via `|FFT(aperture)|²`, if we ever want principled glare on the brightest stars.
   <http://nishitalab.org/user/nis/cdrom/pg/glare_m.pdf>

Practitioner end-to-end implementation (not peer-reviewed but excellent): **tiffnix,
"Rendering star fields in 3D"** — magnitude→luminance, B–V/temperature→RGB blackbody, PSF
sprites (covers everything *except* twinkle). <https://tiffnix.com/star-rendering>

## 4. Current system vs the target (gap analysis)

Current (`lib/shaders/starField.ts`, `components/scene/StarField.tsx`): per-star `aPhase`,
`aFreqRand`, `aTwinkle`, `aSparkleSeed`; live uniforms `uTwinkle` (depth 0–3),
`uTwPeriodMin/Max` (the `rate ms` range), `uTwWave` (sine / triangle / noise / flicker).
Elevation weight `aTwinkle = (0.35 + s·0.65)·(0.55 + 0.45·(1−heightNorm)^1.3)`. Planets steady.

| Property | Real sky | v1 now | Fix |
|---|---|---|---|
| Waveform | band-limited noise, **log-normal** | sine / contrast value-noise | white→one-pole LP (τ≈10 ms), `×= exp(X − s²/2)` |
| Spectrum | flat → `f^(−11/3)`, knee few–16 Hz; visible ≲30 Hz | 0.25–1.7 Hz (too slow/narrow) | knee ~16 Hz; τ₀≈6–10 ms |
| Amplitude vs elev | `σ_I² ∝ (sec z)³` | ad-hoc `(1−heightNorm)^1.3` | drive variance by `(sec z)³` |
| Modulated quantity | luminance + colour, **not size** | luminance ✓ | keep luminance; never pulse size |
| Colour flash | 3 decorrelated channels, gated `tan z` × brightness, gamut ≤ star temp | none | add (horizon + bright only) |
| Planets/Moon | steady (size averaging) | steady ✓ | keep; re-enable only very low |

The existing UI knobs map cleanly onto the better model: **`rate ms` → wind-speed / timescale**,
**`wave` → spectrum shape**, **`twinkle` → amplitude (`σ_I`)**. So it's an upgrade of the same
controls, not new surface.

## 5. Target model (actionable spec)

Per-star, all deterministic on `(seed, uTime, elevation, brightness)`, all per-vertex:

1. **Brightness:** band-limited Gaussian `g` (one-pole LP τ≈10 ms over hashed white noise on
   `uTime·windSpeed`, + a slow ~1–2 Hz pole), mapped log-normal: `bright *= exp(σ·g − σ²/2)`.
2. **Amplitude:** `σ² = σ₀²·(sec z)³`, `σ₀` from the `twinkle` knob (`σ_I ≈ 0.1–0.3` nominal);
   optionally cap `σ_I²≈1` (saturation). Dim-biased + floor under ACES/additive.
3. **Speed:** single linear `windSpeed` multiplier on the time axis (the `rate ms` knob,
   nominal ~20–30 m/s feel).
4. **Colour:** three decorrelated channel signals; `colourAmp ∝ clamp(tan z) × brightnessGate`;
   perturb around the star's base (temperature) colour, gamut-bounded; ~10–30 Hz with mild smoothing.
5. **Object gate:** stars full; planets/Moon off (already); re-enable only at very low altitude.

Open questions to settle on implementation: exact `σ₀` default + saturation cap; whether to keep
all four `wave` presets or collapse to "noise (broadband) + amount"; whether colour flash ships in
v1 or as a follow-up (issues [[night-sky-reference-real]] / #26 / #75 / #76).
