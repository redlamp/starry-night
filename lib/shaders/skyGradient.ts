// Sky gradient — large inside-out sphere rendered in the star pass, before the
// stars themselves. Vertical gradient based on the view direction's Y from the
// dome centre: fog colour at the horizon dissolving up to a darker zenith
// tone. Closes the colour step between the fogged ground at the disc edge and
// the sky background above by bringing fog colour up into the sky.

export const skyGradientVertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const skyGradientFragmentShader = /* glsl */ `
  precision mediump float;

  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform float uHorizonBlend;

  varying vec3 vDir;

  void main() {
    float t = smoothstep(0.0, uHorizonBlend, vDir.y);
    vec3 col = mix(uHorizonColor, uZenithColor, t);
    gl_FragColor = vec4(col, 1.0);
  }
`;
