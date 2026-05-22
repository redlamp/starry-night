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
uniform float uTime;            // seconds since page load, shared across all buildings
uniform float uBuildingHash;    // per-building hash, decorrelates flicker patterns

varying vec2 vUv;
varying vec3 vNormal;

// Cheap 1D hash. Deterministic; same input always same output.
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

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

  // alpha encodes lit state:
  //   0.0   = unlit
  //   ~0.5  = TV-blue lit (always flickers)
  //   1.0   = steady lit (rare classic twinkle on a small subset)
  if (inWindow && state.a > 0.2) {
    bool isTv = state.a < 0.7;

    // Per-window deterministic hash decorrelated by uBuildingHash
    float seed = hash11(cellId.x + cellId.y * 17.0 + uBuildingHash);

    float brightness = 1.0;

    if (isTv) {
      // TV: rapid noisy flicker. Step the hash input at ~8 Hz so brightness changes choppily.
      float tick = floor(uTime * 8.0);
      float n = hash11(tick + seed * 100.0);
      brightness = 0.4 + n * 0.6;
    } else if (seed < 0.04) {
      // Classic twinkle: mostly steady, occasional brief dim.
      // Per-window phase + slow sine; dim only when sine peaks past a high threshold.
      float phase = seed * 50.0;
      float pulse = sin(uTime * 0.6 + phase);
      brightness = pulse > 0.88 ? 0.25 : 1.0;
    }

    color = state.rgb * uEmissiveBoost * brightness;
  }

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;
