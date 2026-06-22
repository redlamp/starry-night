// Star field shader — single Points cloud. Twinkle is an atmospheric-scintillation
// model: band-limited noise → log-normal brightness, amplitude ∝ (sec z)^1.5, with a
// chromatic flash for low/bright stars. Deterministic on (aSparkleSeed, uTime) so it
// matches across viewers for a given masterSeed. See
// wiki/research/star-twinkle-scintillation.md.

export const starFieldVertexShader = /* glsl */ `
  attribute float aSize;       // base size in pixels at depth = 1 unit
  attribute float aPhase;      // 0..1 - random phase offset per star
  attribute float aFreqRand;   // 0..1 - per-star position inside the live period range
  attribute float aTwinkle;    // 0..1 - twinkle amplitude (brightness-weighted)
  attribute float aSparkleSeed;// 0..1 - seed for occasional impulse sparkle
  attribute vec3 aColor;       // RGB stellar-class colour, desaturated for dim
  attribute float aBase;       // per-star base intensity (#26 magnitude flux law)
  attribute float aHalo;       // 1 = hero star/planet: tight core + wide Van Gogh halo
  // .x = random, .y = brightness rank (0 = brightest), .z = heightNorm (0=bottom, 1=zenith).
  attribute vec3 aIntroBaselines;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uStarIntroProgress;
  uniform int uStarIntroMode;
  uniform float uTwinkle;       // twinkle amplitude (sigma scale); 0 = steady
  uniform float uTwPeriodMin;   // per-star noise timescale range, seconds (lerp by aFreqRand)
  uniform float uTwPeriodMax;
  uniform float uTwChroma;      // chromatic-flash strength (0 = none) — low + bright stars only

  varying float vBrightness;
  varying float vWake;
  varying vec3 vColor;
  varying float vHalo;

  // 1D hash for sparkle impulse buckets.
  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  // 1D value noise: smooth-interp between per-integer random levels. Seed
  // decorrelates stars that share a period.
  float vnoise(float x, float seed) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i + seed), hash11(i + 1.0 + seed), u);
  }

  // Fractal value-noise, ~zero-mean: three octaves ADDED (not averaged — averaging
  // regresses to the mean and flattens the swing). Approximates band-limited noise
  // with a flat-then-rolloff spectrum, the shape real scintillation has. Raw std
  // ≈ 0.35; callers multiply by ~2.8 to get a ~unit-std gaussian-ish signal.
  float fbmTwinkle(float t, float seed) {
    return (vnoise(t,       seed       ) - 0.5)
         + (vnoise(t * 2.3, seed + 11.0) - 0.5) * 0.6
         + (vnoise(t * 4.7, seed + 23.0) - 0.5) * 0.35;
  }

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    // Distance-attenuated point size, scaled to DPR so dots stay crisp
    // at high pixel densities.
    float d = -mv.z;
    gl_PointSize = aSize * uPixelRatio * (300.0 / max(d, 1.0));

    // Scintillation model (see wiki/research/star-twinkle-scintillation.md):
    // band-limited noise → LOG-NORMAL brightness, amplitude ∝ (sec z)^1.5, plus a
    // small chromatic flash for low + bright stars. All deterministic on
    // (aSparkleSeed, uTime), so it honours the no-Math.random()/no-Date.now() rule.

    // Per-star noise timescale (the "rate ms" range): faster = livelier flicker.
    float period = mix(uTwPeriodMin, uTwPeriodMax, aFreqRand);
    float t = uTime / max(period, 0.02) + aPhase;
    float seed = aSparkleSeed * 131.0;

    // Airmass from altitude: sinAlt = 2·heightNorm − 1, sec z = 1/sinAlt, clamped
    // near the horizon so it doesn't blow up. σ ∝ (sec z)^1.5 (variance ∝ (sec z)^3):
    // horizon stars twinkle far harder than the zenith — the strongest "looks real"
    // cue. σ capped at 1 (saturation regime). 0.11 calibrates σ≈0.1 at zenith,
    // twinkle=1.
    float sinAlt = clamp(2.0 * aIntroBaselines.z - 1.0, 0.12, 1.0);
    float airmass = 1.0 / sinAlt;
    float sigma = clamp(uTwinkle * aTwinkle * 0.11 * pow(airmass, 1.5), 0.0, 1.0);

    // Log-normal luminance multiplier, mean-preserving: exp(σ·g − σ²/2), g ~ N(0,1).
    // The exp right-tail gives the occasional bright flare a real star shows; capped
    // so an additive/ACES flare can't blow to white.
    float g = fbmTwinkle(t, seed) * 2.8;             // ~unit-std band-limited gaussian
    float lum = min(exp(sigma * g - 0.5 * sigma * sigma), 2.5);

    // Chromatic flash: three decorrelated per-channel noises, gated to low + bright
    // stars (dispersion grows with airmass; colour vision needs a bright star) and
    // bounded by the star's own spectrum via aColor (a red star can't flash a colour
    // it doesn't emit).
    float chromaGate = uTwChroma
      * smoothstep(1.6, 4.0, airmass)                // only low stars
      * smoothstep(0.85, 1.25, aBase);               // only bright stars
    vec3 cn = vec3(
      fbmTwinkle(t * 1.3, seed + 31.0),
      fbmTwinkle(t * 1.3, seed + 53.0),
      fbmTwinkle(t * 1.3, seed + 79.0)
    ) * 2.8;
    vec3 colorFlash = max(vec3(0.0), 1.0 + chromaGate * cn * aColor * 0.6);

    // Base intensity carries the 2.512x/magnitude flux ratio (#26): faint stars dim
    // in LIGHT, not just point size — the field reads mostly-faint with a few standouts.
    vBrightness = lum * aBase;
    vColor = aColor * colorFlash;
    vHalo = aHalo;

    // Intro wake-mask. Pick baseline by mode, cap at 0.7 then add tiny
    // per-star jitter (<=0.15) so the smoothstep saturates before
    // uStarIntroProgress = 1.0 - every star ends fully lit at intro end.
    float baseline = 0.0;
    if (uStarIntroMode == 0) {
      baseline = aIntroBaselines.x;
    } else if (uStarIntroMode == 1) {
      baseline = aIntroBaselines.y;
    } else if (uStarIntroMode == 2) {
      baseline = aIntroBaselines.z;          // horizon-first: low altitude wakes first
    } else {
      baseline = 1.0 - aIntroBaselines.z;    // zenith-first: high altitude wakes first
    }
    float threshold = baseline * 0.7 + aPhase * 0.15;
    vWake = smoothstep(threshold, threshold + 0.08, uStarIntroProgress);
  }
`;

export const starFieldFragmentShader = /* glsl */ `
  precision mediump float;

  varying float vBrightness;
  varying float vWake;
  varying vec3 vColor;
  varying float vHalo;

  void main() {
    // Round point with soft edge via gl_PointCoord.
    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv);
    if (r > 0.5) discard;
    // Hero stars/planets (#26, the Van Gogh read): a tight incandescent core
    // wrapped in a wide, faint halo - radiance faked by outward gradation, not
    // raw brightness. Ordinary stars keep the plain soft disc.
    float plain = smoothstep(0.5, 0.15, r);
    float core = smoothstep(0.17, 0.04, r);
    float halo = smoothstep(0.5, 0.08, r) * 0.22;
    float shape = mix(plain, core + halo, vHalo);
    float alpha = shape * vWake;
    if (alpha <= 0.001) discard;
    // Per-star colour x twinkle x ACES headroom. vBrightness can exceed 1 on a
    // log-normal flare - additive blending + tone mapping handles the overshoot.
    float boost = mix(1.4, 1.7, vHalo * core); // the core itself burns hotter
    vec3 col = vColor * vBrightness * boost;
    gl_FragColor = vec4(col, alpha);
  }
`;
