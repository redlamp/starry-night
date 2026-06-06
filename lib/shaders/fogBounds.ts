// Fog-bounds marker walls: open cylinders that fade from solid at the ground
// to transparent at the top, so the bracket reads as a boundary curtain
// instead of a hard line. Height factor comes from object-space Y (geometry is
// a unit-ish cylinder centred at y=0), keeping the gradient independent of UV
// layout.
export const fogBoundsVertexShader = `
uniform float uHeight;
varying float vH; // 0 at the wall base, 1 at the top
void main() {
  vH = clamp(position.y / uHeight + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const fogBoundsFragmentShader = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vH;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - vH));
}
`;
