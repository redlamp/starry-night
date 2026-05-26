// Ground haze — atmospheric band that sits low against the horizon.
//
// Implemented as the inner surface of a sphere centred on the city, rendered
// back-faces only so the camera looks "through" it from inside. Alpha is a
// vertical gradient that peaks near the horizon line (uBottomY) and fades to
// zero by uTopY, so the haze reads as a low band regardless of camera angle.

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
    // 1 at the horizon, fades to 0 at uTopY. Anything below uBottomY also fades.
    float t = smoothstep(uTopY, uBottomY, vWorldPos.y);
    float floor = smoothstep(uBottomY - 80.0, uBottomY, vWorldPos.y);
    float alpha = t * floor * uIntensity;
    gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 1.0));
  }
`;
