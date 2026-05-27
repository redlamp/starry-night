// Star field shader — single Points cloud with per-star size + per-star
// twinkle phase. Twinkle uses (uTime, aPhase, aFreq) so it stays deterministic
// across viewers as long as masterSeed matches.

export const starFieldVertexShader = /* glsl */ `
  attribute float aSize;     // base size in pixels at depth = 1 unit
  attribute float aPhase;    // 0..1 — random phase offset per star
  attribute float aFreq;     // ~0.4..1.4 — per-star twinkle frequency
  attribute float aTwinkle;  // 0..1 — how strongly this star twinkles (0 = steady)

  uniform float uTime;
  uniform float uPixelRatio;

  varying float vBrightness;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    // Distance-attenuated point size, scaled to DPR so dots stay crisp
    // at high pixel densities.
    float d = -mv.z;
    gl_PointSize = aSize * uPixelRatio * (300.0 / max(d, 1.0));

    // Clip the dome's lower hemisphere: stars below the ground plane (world
    // y < 0) sit "under the earth" and must not show below the horizon. The
    // ground used to occlude them via depth test; the star field now renders
    // in its own depthless pass, so the clip is done here instead.
    float worldY = (modelMatrix * vec4(position, 1.0)).y;
    if (worldY < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
    }

    // Twinkle = base 0.7 + 0.3 * sin(time*freq + 2pi*phase), gated by aTwinkle
    float t = sin(uTime * aFreq + aPhase * 6.2831853);
    vBrightness = mix(1.0, 0.7 + 0.3 * t, aTwinkle);
  }
`;

export const starFieldFragmentShader = /* glsl */ `
  precision mediump float;

  varying float vBrightness;

  void main() {
    // Round point with soft edge via gl_PointCoord.
    vec2 uv = gl_PointCoord - vec2(0.5);
    float r = length(uv);
    if (r > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, r);
    // Slight HDR overshoot under ACES tone mapping for that crisp pinpoint look.
    vec3 col = vec3(1.0) * vBrightness * 1.4;
    gl_FragColor = vec4(col, alpha);
  }
`;
