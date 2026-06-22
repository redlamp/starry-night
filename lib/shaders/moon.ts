// Moon body shader — a lit sphere using the LOMMEL-SEELIGER reflectance law
// (reflectance ∝ μ₀/(μ₀+μ)), NOT Lambert. The literature (Hapke 1963; Jensen et al.
// 2001; Fairbairn 2005) is firm that the full moon shows NO limb darkening — it's
// flat-bright to the edge — which Lambert's N·L can't do. L-S keeps the lit disc
// uniform and the phase/terminator fall out of the sun direction. The "sun" is a
// uniform DIRECTION (uSunDir, in view space), not a scene light, so it can't spill
// onto the city and we get the exact reflectance we want. Colours are authored in
// DISPLAY space and written raw (same convention as the moonHalo + cityInstanced
// shaders). See wiki/research/moon-rendering.md §3.

export const moonVertexShader = /* glsl */ `
  varying vec3 vNormalView;   // surface normal in view space
  varying vec3 vViewDir;      // direction to camera in view space
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz); // camera sits at the origin of view space
    gl_Position = projectionMatrix * mv;
  }
`;

export const moonFragmentShader = /* glsl */ `
  precision mediump float;

  uniform vec3 uSunDir;       // moon → sun, VIEW space, normalized (encodes the phase)
  uniform vec3 uColor;        // base albedo tint (display space)
  uniform float uBrightness;  // overall lit scale (carries the opposition surge near full)
  uniform float uEarthshine;  // faint dark-side fill (grows as the crescent thins)

  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormalView);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(vViewDir);

    float mu0 = max(dot(N, L), 0.0);   // cos incidence (sun)
    float mu  = max(dot(N, V), 0.0);   // cos emission (viewer)
    // Lommel-Seeliger: flat across the lit disc, bright to the limb (no limb darkening),
    // dark at the terminator where mu0 → 0.
    float ls = (mu0 + mu) > 0.001 ? mu0 / (mu0 + mu) : 0.0;

    // Earthshine: the unlit hemisphere glows faintly (Earth-reflected light) — the
    // "old moon in the new moon's arms." Strongest where the sun barely misses.
    float darkSide = 1.0 - smoothstep(0.0, 0.04, mu0);

    vec3 col = uColor * (uBrightness * ls + uEarthshine * darkSide);
    gl_FragColor = vec4(col, 1.0);
  }
`;
