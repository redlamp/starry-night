// Road reveal cascade (docs/specs/2026-06-05-road-reveal-cascade.md): fragments
// past the wavefront are discarded; a short band behind the front lightens
// toward white as the "construction tip". Roads render toneMapped:false flat
// colour, so the tip is a colour lerp, not an HDR boost. The tip retires as
// progress reaches 1 so a finished network is exactly the flat tier colour.
export const roadRevealVertexShader = `
attribute float aReveal;
varying float vReveal;
void main() {
  vReveal = aReveal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const roadRevealFragmentShader = `
uniform vec3 uColor;
uniform float uProgress;
uniform float uTipWidth;
varying float vReveal;
void main() {
  if (vReveal > uProgress) discard;
  float tip = 1.0 - smoothstep(0.0, uTipWidth, uProgress - vReveal);
  tip *= 1.0 - smoothstep(0.95, 1.0, uProgress);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), tip * 0.85), 1.0);
}
`;
