// Star field shader — single Points cloud with per-star size + per-star
// twinkle phase. Twinkle uses (uTime, aPhase, aFreq) so it stays deterministic
// across viewers as long as masterSeed matches.

export const starFieldVertexShader = /* glsl */ `
  attribute float aSize;       // base size in pixels at depth = 1 unit
  attribute float aPhase;      // 0..1 — random phase offset per star
  attribute float aFreq;       // ~0.4..1.4 — per-star twinkle frequency
  attribute float aTwinkle;    // 0..1 — twinkle amplitude (brightness-weighted)
  attribute float aSparkleSeed;// 0..1 — seed for occasional impulse sparkle
  attribute vec3 aColor;       // RGB stellar-class colour, desaturated for dim
  attribute float aBase;       // per-star base intensity (#26 magnitude flux law)
  // .x = random, .y = brightness rank (0 = brightest), .z = heightNorm (0=bottom, 1=zenith).
  attribute vec3 aIntroBaselines;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uStarIntroProgress;
  uniform int uStarIntroMode;

  varying float vBrightness;
  varying float vWake;
  varying vec3 vColor;

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

    // Twinkle = sine wave 0.5..1.0 swing, amplitude per-star (aTwinkle).
    // Bright stars (aTwinkle near 1) modulate strongly; dim stars stay near 1.
    float t = sin(uTime * aFreq + aPhase * 6.2831853);
    float baseTwinkle = mix(1.0, 0.5 + 0.5 * (0.5 + 0.5 * t), aTwinkle);

    // Occasional sparkle: every ~2.5s bucket, roll a per-star hash. If it
    // crosses the threshold the star briefly spikes; exp-decay across the
    // bucket lifetime. Only stars with aTwinkle > 0.5 are eligible so the
    // sparkles read as bright-star scintillation.
    float bucketLen = 2.5;
    float bucket = floor(uTime / bucketLen + aSparkleSeed * 97.0);
    float bucketAge = fract(uTime / bucketLen + aSparkleSeed * 97.0);
    float roll = hash11(bucket * 13.7 + aSparkleSeed * 41.0);
    float eligible = step(0.5, aTwinkle);
    float sparkle = eligible * step(0.97, roll) * exp(-bucketAge * 9.0) * 1.6;

    // Base intensity carries the 2.512×/magnitude flux ratio (#26): faint
    // stars dim in LIGHT, not just point size — the field reads mostly-faint
    // with a few standouts, like a real city sky.
    vBrightness = (baseTwinkle + sparkle) * aBase;
    vColor = aColor;

    // Intro wake-mask. Pick baseline by mode, cap at 0.7 then add tiny
    // per-star jitter (≤0.15) so the smoothstep saturates before
    // uStarIntroProgress = 1.0 — every star ends fully lit at intro end.
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

  void main() {
    // Round point with soft edge via gl_PointCoord.
    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv);
    if (r > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, r) * vWake;
    if (alpha <= 0.001) discard;
    // Per-star colour × twinkle × ACES headroom. vBrightness can exceed 1 on
    // sparkle frames — additive blending + tone mapping handles the overshoot.
    vec3 col = vColor * vBrightness * 1.4;
    gl_FragColor = vec4(col, alpha);
  }
`;
