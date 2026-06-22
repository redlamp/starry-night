// Moon body shader — STYLIZED (not photoreal). A flat-toned lit disc with a sharp,
// graphic terminator, to fit the low-poly / dithered-homage aesthetic. The lit value
// comes from one sun-direction dot (uSunDir, view space, encodes the phase); a
// uTermStyle uniform then maps it three ways: crisp 2-tone, 1-bit ordered dither, or
// cel steps. No limb darkening falls out for free (the lit hemisphere is flat). The
// "sun" is a uniform direction (not a scene light → no spill onto the city). Colours
// are DISPLAY-space, written raw (same convention as the halo / cityInstanced
// shaders). See wiki/research/moon-rendering.md §3.

export const moonVertexShader = /* glsl */ `
  varying vec3 vNormalView;   // surface normal in view space
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const moonFragmentShader = /* glsl */ `
  precision mediump float;

  uniform vec3 uSunDir;      // moon → sun, VIEW space, normalized (encodes the phase)
  uniform vec3 uColor;       // flat lit tone (display space)
  uniform float uBrightness; // lit scale (carries the opposition surge near full)
  uniform int uTermStyle;    // 0 = crisp 2-tone, 1 = ordered dither, 2 = cel steps
  uniform float uSharpness;  // 0..1 terminator edge crispness (higher = sharper)

  varying vec3 vNormalView;

  // Array-free ordered (Bayer) dither thresholds, recursive 2 → 4. Returns [0,1).
  float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  void main() {
    vec3 N = normalize(vNormalView);
    float mu0 = dot(N, normalize(uSunDir)); // cos incidence; terminator at mu0 = 0
    float edge = mix(0.30, 0.015, clamp(uSharpness, 0.0, 1.0));
    float s = smoothstep(-edge, edge, mu0);  // soft lit fraction 0..1

    float lit = s; // crisp 2-tone (a thin AA edge from the smoothstep)
    if (uTermStyle == 1) {
      // 1-bit ordered dither across the band; threshold biased into (0,1) so a
      // fully-dark or fully-lit cell never strays a pixel (glsl-ordered-dither note).
      float th = bayer4(gl_FragCoord.xy) * 0.96 + 0.02;
      lit = step(th, s);
    } else if (uTermStyle == 2) {
      lit = floor(clamp(s, 0.0, 0.999) * 3.0) / 2.0; // cel: 0, 0.5, 1
    }

    // Unlit side reads pure black (no earthshine) — the lit dithered shape carries
    // the moon against the sky.
    vec3 col = uColor * uBrightness * lit;
    gl_FragColor = vec4(col, 1.0);
  }
`;
