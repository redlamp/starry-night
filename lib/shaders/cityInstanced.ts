export const cityVertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

attribute vec2 aAtlasOffset;
attribute vec2 aAtlasSize;
attribute vec2 aGrid;
attribute vec3 aFacadeColor;
attribute float aFacadeGlow;
attribute float aBuildingHash;

varying vec2 vUv;
varying vec3 vNormalLocal;     // pre-instance normal — face direction in geometry-local space
varying vec3 vNormalWorld;     // instance-rotated normal — used for face-up detection in world space
varying vec2 vAtlasOffset;
varying vec2 vAtlasSize;
varying vec2 vGrid;
varying vec3 vFacadeColor;
varying float vFacadeGlow;
varying float vBuildingHash;

void main() {
  vUv = uv;
  vNormalLocal = normal;

  // Instance includes scale + rotation. For face-up detection we only care about
  // direction in world space (after instance rotation, before camera). Strip scale.
  mat3 instMat3 = mat3(instanceMatrix);
  vec3 scaleVec = vec3(length(instMat3[0]), length(instMat3[1]), length(instMat3[2]));
  mat3 instRot = mat3(instMat3[0] / scaleVec.x, instMat3[1] / scaleVec.y, instMat3[2] / scaleVec.z);
  vNormalWorld = normalize(instRot * normal);

  vAtlasOffset = aAtlasOffset;
  vAtlasSize = aAtlasSize;
  vGrid = aGrid;
  vFacadeColor = aFacadeColor;
  vFacadeGlow = aFacadeGlow;
  vBuildingHash = aBuildingHash;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

export const cityFragmentShader = /* glsl */ `
#include <fog_pars_fragment>

uniform sampler2D uWindowAtlas;
uniform float uWindowWidth;
uniform float uWindowHeight;
uniform float uEmissiveBoost;
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormalLocal;
varying vec3 vNormalWorld;
varying vec2 vAtlasOffset;
varying vec2 vAtlasSize;
varying vec2 vGrid;
varying vec3 vFacadeColor;
varying float vFacadeGlow;
varying float vBuildingHash;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  vec3 facade = vFacadeColor * (1.0 + vFacadeGlow);

  // Top + bottom faces: solid facade — detect via the geometry-local normal
  // (works regardless of instance rotation since BoxGeometry top/bottom faces
  // always have local normal ±Y).
  float upDotLocal = abs(vNormalLocal.y);
  if (upDotLocal > 0.5) {
    gl_FragColor = vec4(facade, 1.0);
    #include <fog_fragment>
    return;
  }

  vec2 cell = vUv * vGrid;
  vec2 cellId = floor(cell);
  vec2 cellLocal = fract(cell);

  // Atlas sample: pick the centre pixel of cell (cellId+0.5), normalise by grid,
  // scale by this building's atlas slice size, then offset to the slice origin.
  vec2 cellCentreUv = (cellId + 0.5) / vGrid;
  vec2 atlasUv = vAtlasOffset + cellCentreUv * vAtlasSize;
  vec4 state = texture2D(uWindowAtlas, atlasUv);

  float halfW = uWindowWidth * 0.5;
  float halfH = uWindowHeight * 0.5;
  bool inWindow =
    cellLocal.x > 0.5 - halfW && cellLocal.x < 0.5 + halfW &&
    cellLocal.y > 0.5 - halfH && cellLocal.y < 0.5 + halfH;

  vec3 color = facade;

  // alpha encoding (matches lightingGen):
  //   0    = unlit
  //   128  = TV-blue lit (always flickers)
  //   255  = steady lit (rare classic twinkle on a small subset)
  if (inWindow && state.a > 0.2) {
    bool isTv = state.a < 0.7;
    float seed = hash11(cellId.x + cellId.y * 17.0 + vBuildingHash);

    float brightness = 1.0;
    if (isTv) {
      float tick = floor(uTime * 8.0);
      float n = hash11(tick + seed * 100.0);
      brightness = 0.4 + n * 0.6;
    } else if (seed < 0.04) {
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
