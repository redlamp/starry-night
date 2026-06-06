// Road reveal cascade (docs/specs/2026-06-05-road-reveal-cascade.md), two
// phases on one master progress:
//   [0, uScoutEnd)  — scout glint: before any road draws, a bright point races
//                     the highway path on the dark ground (aReveal doubles as
//                     the path parameter, so no extra geometry); tiers with
//                     uScoutSpan = 0 stay fully hidden.
//   [uScoutEnd, 1]  — cascade: progress remapped to the remaining window;
//                     fragments past the wavefront discard, a short band
//                     behind the front lightens toward white ("construction
//                     tip"). Roads render toneMapped:false flat colour, so the
//                     tip is a colour lerp, not an HDR boost. The tip retires
//                     early (gone by ~92% of the cascade window) so closing
//                     stragglers draw in quietly; a finished network is
//                     exactly the flat tier colour.
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
uniform float uScoutEnd;  // master-progress fraction spent on the scout glint
uniform float uScoutSpan; // max aReveal the glint sweeps; 0 = tier has no scout
varying float vReveal;
void main() {
  if (uProgress < uScoutEnd) {
    if (uScoutSpan <= 0.0) discard;
    float scoutT = (uProgress / uScoutEnd) * uScoutSpan;
    float band = uTipWidth * 2.0;
    float d = abs(vReveal - scoutT);
    if (d > band) discard;
    float g = 1.0 - smoothstep(0.0, band, d);
    gl_FragColor = vec4(mix(uColor * 0.2, vec3(1.0), g), 1.0);
    return;
  }
  float t = clamp((uProgress - uScoutEnd) / max(1.0 - uScoutEnd, 1e-4), 0.0, 1.0);
  if (vReveal > t) discard;
  float tip = 1.0 - smoothstep(0.0, uTipWidth, t - vReveal);
  tip *= 1.0 - smoothstep(0.80, 0.92, t);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), tip * 0.85), 1.0);
}
`;
