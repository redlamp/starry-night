// Car head/tail-light points. Position is computed entirely on the GPU from the
// shared clock — each car slides along its baked segment via fract(uTime·speed +
// phase) — so there is zero per-frame CPU and the motion is deterministic for a
// seed. Rendered additively as soft round glows; fog off so they stay crisp.

export const trafficVertexShader = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSizeScale;

attribute vec3 aA;     // travel-start (lane-offset world point)
attribute vec3 aB;     // travel-end
attribute float aPhase;
attribute float aSpeed; // segment-fractions per second
attribute vec3 aColor;
attribute float aSize;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float t = fract(uTime * aSpeed + aPhase);
  vec3 p = mix(aA, aB, t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Fade in/out at the segment ends so the loop wrap doesn't pop.
  vAlpha = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.92, 1.0, t));
  vColor = aColor;
  // Fixed apparent size (correct under the default orthographic projection;
  // points stay legible dots in perspective too). uSizeScale tunes globally.
  gl_PointSize = clamp(aSize * uPixelRatio * uSizeScale, 1.0, 16.0);
}
`;

export const trafficFragmentShader = /* glsl */ `
uniform float uIntensity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float glow = smoothstep(1.0, 0.0, r2); // soft round falloff
  // Hot core + glow, pushed above 1.0 so ACES gives it a little bloomy HDR pop.
  gl_FragColor = vec4(vColor * uIntensity * (0.35 + 0.65 * glow), vAlpha * glow);
}
`;
