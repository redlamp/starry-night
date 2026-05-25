export const cityVertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

attribute vec2 aAtlasOffset;
attribute vec2 aAtlasSize;
attribute vec2 aGrid;
attribute vec3 aFacadeColor;
attribute float aFacadeGlow;
attribute float aBuildingHash;
attribute float aDistrictIdx; // 0=downtown, 1=residential, 2=industrial, 3=oldtown

varying vec2 vUv;
varying vec3 vNormalLocal;     // pre-instance normal — face direction in geometry-local space
varying vec3 vNormalWorld;     // instance-rotated normal — used for face-up detection in world space
varying vec2 vAtlasOffset;
varying vec2 vAtlasSize;
varying vec2 vGrid;
varying vec3 vFacadeColor;
varying float vFacadeGlow;
varying float vBuildingHash;
varying float vDistrictIdx;
varying vec3 vBuildingCenter;  // world-space centre of this instance

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
  vDistrictIdx = aDistrictIdx;
  vBuildingCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

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

// Intro / wake-up uniforms.
//   uIntroProgress: 0..1 sweep value (0 = all windows dark, 1 = all lit)
//   uIntroMode:     0=random, 1=district, 2=outside-in, 3=far-to-near, 4=inside-out
//   uIntroCamPos:   world-space camera position snapshot used by mode 3
//   uIntroCityCenter:    world-space city centre used by modes 2 / 4 as the radial axis
//   uIntroMaxRadius: largest horizontal distance from centre to any building, normaliser
uniform float uIntroProgress;
uniform int uIntroMode;
uniform vec3 uIntroCamPos;
uniform vec3 uIntroCityCenter;
uniform float uIntroMaxRadius;

varying vec2 vUv;
varying vec3 vNormalLocal;
varying vec3 vNormalWorld;
varying vec2 vAtlasOffset;
varying vec2 vAtlasSize;
varying vec2 vGrid;
varying vec3 vFacadeColor;
varying float vFacadeGlow;
varying float vBuildingHash;
varying float vDistrictIdx;
varying vec3 vBuildingCenter;

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

  // The intro should fill every window: cells that are atlas-unlit at night
  // still light up during the wake-up sweep using a default warm color. The
  // existing flicker / twinkle behaviour stays scoped to the atlas-lit subset
  // (alpha encoding 128 = TV-blue, 255 = steady).
  if (inWindow) {
    float seed = hash11(cellId.x + cellId.y * 17.0 + vBuildingHash);

    vec3 lit;
    if (state.a > 0.2) {
      bool isTv = state.a < 0.7;
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
      lit = state.rgb * uEmissiveBoost * brightness;
    } else {
      // Atlas-unlit cells get a default warm tungsten — slightly dimmer than
      // the average atlas-lit window so the "all on" state still reads as a
      // city rather than a billboard.
      lit = vec3(1.0, 0.82, 0.55) * uEmissiveBoost * 0.55;
    }

    // Per-window intro wake mask. Baseline coefficients capped at 0.7 so that
    // baseline (≤ 0.7) + jitter (≤ 0.15) keeps threshold ≤ 0.85; smoothstep
    // saturates well before uIntroProgress = 1, guaranteeing every window is
    // fully lit at intro end.
    float baseline = 0.0;
    if (uIntroMode == 0) {
      baseline = seed * 0.7;
    } else if (uIntroMode == 1) {
      baseline = (vDistrictIdx / 3.0) * 0.7;
    } else if (uIntroMode == 2) {
      vec2 d = vBuildingCenter.xz - uIntroCityCenter.xz;
      float r = clamp(length(d) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
      baseline = (1.0 - r) * 0.7;
    } else if (uIntroMode == 3) {
      float farD = distance(vBuildingCenter, uIntroCamPos);
      float r = clamp(farD / max(1.0, uIntroMaxRadius * 2.0), 0.0, 1.0);
      baseline = (1.0 - r) * 0.7;
    } else {
      vec2 d = vBuildingCenter.xz - uIntroCityCenter.xz;
      float r = clamp(length(d) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
      baseline = r * 0.7;
    }
    float threshold = baseline + seed * 0.15;
    float wake = smoothstep(threshold, threshold + 0.08, uIntroProgress);

    color = mix(facade, lit, wake);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;
