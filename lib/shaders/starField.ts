// Star field shader — single Points cloud with per-star size + per-star
// twinkle phase. Twinkle uses (uTime, aPhase, aFreq) so it stays deterministic
// across viewers as long as masterSeed matches.

export const starFieldVertexShader = /* glsl */ `
  attribute float aSize;     // base size in pixels at depth = 1 unit
  attribute float aPhase;    // 0..1 — random phase offset per star
  attribute float aFreq;     // ~0.4..1.4 — per-star twinkle frequency
  attribute float aTwinkle;  // 0..1 — how strongly this star twinkles (0 = steady)
  // .x = random, .y = brightness rank (0 = brightest), .z = heightNorm (0=bottom, 1=zenith).
  attribute vec3 aIntroBaselines;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uStarIntroProgress;
  uniform int uStarIntroMode;

  varying float vBrightness;
  varying float vWake;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    // Distance-attenuated point size, scaled to DPR so dots stay crisp
    // at high pixel densities.
    float d = -mv.z;
    gl_PointSize = aSize * uPixelRatio * (300.0 / max(d, 1.0));

    // Twinkle = base 0.7 + 0.3 * sin(time*freq + 2pi*phase), gated by aTwinkle
    float t = sin(uTime * aFreq + aPhase * 6.2831853);
    vBrightness = mix(1.0, 0.7 + 0.3 * t, aTwinkle);

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

  void main() {
    // Round point with soft edge via gl_PointCoord.
    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv);
    if (r > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, r) * vWake;
    if (alpha <= 0.001) discard;
    // Slight HDR overshoot under ACES tone mapping for that crisp pinpoint look.
    vec3 col = vec3(1.0) * vBrightness * 1.4;
    gl_FragColor = vec4(col, alpha);
  }
`;
