// GenTrace draw-on + cascade fade. Each segment vertex carries its line's
// batch-arrival time (aBirth, sharedTime seconds) and its fraction along the
// line (aFrac); fragments past the drawn fraction discard, so every accepted
// streamline strokes on over uDrawDur instead of popping. uFade (1 − cascade
// progress) dims the whole blueprint as the real network sweeps over it.
export const genTraceVertexShader = `
attribute vec3 aColor;
attribute float aBirth;
attribute float aFrac;
varying vec3 vColor;
varying float vBirth;
varying float vFrac;
void main() {
  vColor = aColor;
  vBirth = aBirth;
  vFrac = aFrac;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const genTraceFragmentShader = `
uniform float uTime;
uniform float uDrawDur;
uniform float uOpacity;
uniform float uFade;
varying vec3 vColor;
varying float vBirth;
varying float vFrac;
void main() {
  float drawn = clamp((uTime - vBirth) / uDrawDur, 0.0, 1.0);
  if (vFrac > drawn) discard;
  gl_FragColor = vec4(vColor, uOpacity * uFade);
}
`;
