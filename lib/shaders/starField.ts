// Star field shader — single Points cloud with per-star size + per-star
// twinkle phase. Twinkle uses (uTime, aPhase, aFreqRand) so it stays deterministic
// across viewers as long as masterSeed matches.

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
  uniform float uTwinkle;       // global twinkle multiplier (0 = steady, 1 = default)
  uniform float uTwPeriodMin;   // twinkle period range, seconds (per-star lerp by aFreqRand)
  uniform float uTwPeriodMax;
  uniform int uTwWave;          // twinkle curve: 0 sine, 1 triangle, 2 noise, 3 flicker

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

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    // Distance-attenuated point size, scaled to DPR so dots stay crisp
    // at high pixel densities.
    float d = -mv.z;
    gl_PointSize = aSize * uPixelRatio * (300.0 / max(d, 1.0));

    // Twinkle = per-star sine dipping the brightness toward a floor. depth =
    // per-star amplitude (aTwinkle) scaled by the global uTwinkle slider, so it
    // ranges from dead-steady (uTwinkle 0) through the default look (1) to deep
    // blinking (the trough can undershoot 0 → star winks fully off) at higher
    // settings. osc is the 0..1 swing; brightness = 1 at the peak, 1 - 0.9*depth
    // at the trough.
    // Per-star period in seconds, placed inside the live [min,max] range by its
    // baked random. cyc = elapsed cycles (+ per-star phase); osc is the 0..1
    // brightness curve over the cycle, selected by uTwWave. A single sine read as
    // smooth synchronised undulation, so the noise curves break the regularity.
    float period = mix(uTwPeriodMin, uTwPeriodMax, aFreqRand);
    float cyc = uTime / max(period, 0.05) + aPhase;
    float osc;
    if (uTwWave == 0) {
      osc = 0.5 + 0.5 * sin(cyc * 6.2831853);        // sine — smooth
    } else if (uTwWave == 1) {
      osc = abs(2.0 * fract(cyc) - 1.0);             // triangle — linear ramps
    } else {
      // value noise in time: smooth-interp between per-cycle random levels, two
      // octaves for irregularity. Aperiodic-feeling scintillation, not a pulse.
      float seed = aSparkleSeed * 131.0;
      float i0 = floor(cyc);
      float f0 = fract(cyc);
      float u0 = f0 * f0 * (3.0 - 2.0 * f0);
      float n1 = mix(hash11(i0 + seed), hash11(i0 + 1.0 + seed), u0);
      float c2 = cyc * 2.0;
      float i1 = floor(c2);
      float f1 = fract(c2);
      float u1 = f1 * f1 * (3.0 - 2.0 * f1);
      float n2 = mix(hash11(i1 + seed + 7.0), hash11(i1 + 1.0 + seed + 7.0), u1);
      float n = n1 * 0.65 + n2 * 0.35;
      // flicker (3): bias bright with occasional sharp dips; noise (2): raw.
      osc = (uTwWave == 3) ? (1.0 - pow(1.0 - n, 4.0)) : n;
    }
    float depth = aTwinkle * uTwinkle;
    float baseTwinkle = 1.0 - depth * 0.9 * (1.0 - osc);

    // Occasional sparkle: every ~2.5s bucket, roll a per-star hash. If it
    // crosses the threshold the star briefly spikes; exp-decay across the
    // bucket lifetime. Only stars with aTwinkle > 0.5 are eligible so the
    // sparkles read as bright-star scintillation.
    float bucketLen = 2.5;
    float bucket = floor(uTime / bucketLen + aSparkleSeed * 97.0);
    float bucketAge = fract(uTime / bucketLen + aSparkleSeed * 97.0);
    float roll = hash11(bucket * 13.7 + aSparkleSeed * 41.0);
    float eligible = step(0.5, aTwinkle);
    float sparkle = eligible * step(0.97, roll) * exp(-bucketAge * 9.0) * 1.6 * uTwinkle;

    // Base intensity carries the 2.512x/magnitude flux ratio (#26): faint
    // stars dim in LIGHT, not just point size - the field reads mostly-faint
    // with a few standouts, like a real city sky.
    vBrightness = (baseTwinkle + sparkle) * aBase;
    vColor = aColor;
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
    // Per-star colour x twinkle x ACES headroom. vBrightness can exceed 1 on
    // sparkle frames - additive blending + tone mapping handles the overshoot.
    float boost = mix(1.4, 1.7, vHalo * core); // the core itself burns hotter
    vec3 col = vColor * vBrightness * boost;
    gl_FragColor = vec4(col, alpha);
  }
`;
