// Moon halo — billboard quad around the moon with radial-falloff alpha.
// Additive blending so it lifts the surrounding star field. Stays in world
// space (rotated to face camera per-frame) so size scales with distance like
// the moon itself.

export const moonHaloVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const moonHaloFragmentShader = /* glsl */ `
  precision mediump float;

  uniform vec3 uColor;
  uniform float uInnerRadius; // 0..0.5 — radius where falloff begins (full opacity inside)
  uniform float uIntensity;   // multiplier on emissive output

  varying vec2 vUv;

  void main() {
    float d = distance(vUv, vec2(0.5));
    if (d > 0.5) discard;

    // Two-zone falloff: solid-ish core to uInnerRadius, soft fade to the edge.
    float core = 1.0 - smoothstep(0.0, uInnerRadius, d);
    float halo = pow(1.0 - smoothstep(uInnerRadius, 0.5, d), 2.0);
    float a = clamp(core + halo * 0.65, 0.0, 1.0);

    gl_FragColor = vec4(uColor * uIntensity, a);
  }
`;
