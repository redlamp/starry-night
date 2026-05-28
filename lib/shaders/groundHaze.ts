// Ground haze — virtual ground / horizon fill.
//
// Inner surface of a sphere centred on the city, back-faces only so the camera
// looks "through" it from inside. Alpha is a vertical gradient: fully opaque
// for any world Y at or below uBottomY (lower hemisphere acts as a soft
// virtual ground that fills the view below the geometric horizon), fading to
// zero by uTopY (sky shows through above). The real ground disc draws over
// the haze in the main scene, so close-up ground stays sharp.

export const groundHazeVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const groundHazeFragmentShader = /* glsl */ `
  precision mediump float;

  uniform vec3 uColor;
  uniform float uTopY;
  uniform float uBottomY;
  uniform float uIntensity;

  varying vec3 vWorldPos;

  void main() {
    // 1 at and below uBottomY, fades to 0 at uTopY. smoothstep clamps to 1
    // for inputs past the lower edge, so the entire lower hemisphere stays
    // fully opaque without an extra floor fade.
    float t = smoothstep(uTopY, uBottomY, vWorldPos.y);
    float alpha = t * uIntensity;
    gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 1.0));
  }
`;
