export const windowVertexShader = /* glsl */ `
#include <fog_pars_vertex>

varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vNormal = normal;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const windowFragmentShader = /* glsl */ `
#include <fog_pars_fragment>

uniform sampler2D uWindowData;
uniform vec2 uGrid;             // cols, rows
uniform vec3 uFacadeColor;
uniform float uFacadeGlow;      // 0..1 self-emissive factor for facade
uniform float uWindowWidth;     // 0..1 fraction of cell
uniform float uWindowHeight;    // 0..1 fraction of cell
uniform float uEmissiveBoost;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
  vec3 facade = uFacadeColor * (1.0 + uFacadeGlow);

  // Top + bottom faces: solid facade color, no windows
  float upDot = abs(dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)));
  if (upDot > 0.5) {
    gl_FragColor = vec4(facade, 1.0);
    #include <fog_fragment>
    return;
  }

  vec2 cell = vUv * uGrid;
  vec2 cellId = floor(cell);
  vec2 cellLocal = fract(cell);

  vec2 sampleUv = (cellId + 0.5) / uGrid;
  vec4 state = texture2D(uWindowData, sampleUv);

  float halfW = uWindowWidth * 0.5;
  float halfH = uWindowHeight * 0.5;
  vec2 windowMin = vec2(0.5 - halfW, 0.5 - halfH);
  vec2 windowMax = vec2(0.5 + halfW, 0.5 + halfH);

  bool inWindow =
    cellLocal.x > windowMin.x && cellLocal.x < windowMax.x &&
    cellLocal.y > windowMin.y && cellLocal.y < windowMax.y;

  vec3 color = facade;
  if (inWindow && state.a > 0.5) {
    color = state.rgb * uEmissiveBoost;
  }

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;
