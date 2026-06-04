// Sky gradient — large inside-out sphere rendered in the star pass, before the
// stars themselves. #26 research pass shape (wiki/research/night-sky-reference-*):
//   - THREE stops (horizon → mid → zenith) so the zenith can stay a saturated
//     indigo ("never pure black" — Ghibli/Van Gogh read) while the horizon
//     still meets the fog colour.
//   - A warm CITY SKYGLOW band hugging the bottom of the dome (Bortle-style
//     light-pollution dome: brightest at the horizon, gone by ~uGlowHeight).
//   - Interleaved-Gradient-Noise dither (±0.5 LSB) so the smooth dark ramp
//     doesn't band on 8-bit displays — the #1 artifact risk for night skies.

export const skyGradientVertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const skyGradientFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uHorizonColor;
  uniform vec3 uMidColor;
  uniform vec3 uZenithColor;
  uniform float uHorizonBlend; // y where the horizon-to-mid blend completes
  uniform vec3 uGlowColor;     // warm light-pollution skyglow
  uniform float uGlowHeight;   // y extent of the skyglow band
  uniform float uGlowStrength; // 0 = off

  varying vec3 vDir;

  // Interleaved Gradient Noise - cheap screen-space dither.
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    float y = vDir.y;
    // horizon -> mid -> zenith
    vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, uHorizonBlend, y));
    col = mix(col, uZenithColor, smoothstep(uHorizonBlend, 1.0, y));
    // warm skyglow dome at the bottom (full strength at/below the horizon)
    float glow = (1.0 - smoothstep(0.0, uGlowHeight, max(y, 0.0))) * uGlowStrength;
    col = mix(col, uGlowColor, glow);
    // +/-0.5 LSB dither kills banding on the dark ramp
    col += (1.0 / 255.0) * ign(gl_FragCoord.xy) - (0.5 / 255.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;
