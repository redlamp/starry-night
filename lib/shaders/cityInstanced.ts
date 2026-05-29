export const cityVertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

attribute vec2 aAtlasOffset;
attribute vec2 aAtlasSize;
attribute vec3 aGrid; // cols, rows, archetypeIdx (idx packed into .z to save an attribute slot)
attribute vec3 aFacadeColor;
attribute float aFacadeGlow;
attribute float aBuildingHash;
attribute float aDistrictIdx; // 0=downtown, 1=residential, 2=industrial, 3=oldtown
// Post-intro window breathing correlation per building:
//   0 = per-window (each cell independent — residential default)
//   1 = per-block  (a floor is split into 2..5 horizontal blocks, each block phases together)
//   2 = whole-floor (every cell on a floor shares one phase)
// Office archetypes pick from {0,1,2} per building so the city has a mix; the
// hand-wave / working-late "stragglers" override below keeps every mode dynamic.
attribute float aCorrelationMode;

varying vec2 vUv;
varying vec3 vNormalLocal;     // pre-instance normal — face direction in geometry-local space
varying vec3 vNormalWorld;     // instance-rotated normal — used for face-up detection in world space
varying vec2 vAtlasOffset;
varying vec2 vAtlasSize;
varying vec3 vGrid;
varying vec3 vFacadeColor;
varying float vFacadeGlow;
varying float vBuildingHash;
varying float vDistrictIdx;
varying float vCorrelationMode;
varying vec3 vBuildingCenter;  // world-space centre of this instance
// #25: vertical face id (0=+X, 1=-X, 2=+Z, 3=-Z), constant per face thanks to
// BoxGeometry's per-face normal duplication. Drives a per-face shift of which
// atlas pixels each vertical face samples so the 4 sides aren't identical.
varying float vFaceId;
void main() {
  vUv = uv;
  vNormalLocal = normal;
  vFaceId = 0.0;
  if (abs(normal.x) > 0.5) {
    vFaceId = normal.x > 0.0 ? 0.0 : 1.0;
  } else if (abs(normal.z) > 0.5) {
    vFaceId = normal.z > 0.0 ? 2.0 : 3.0;
  }

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
  vCorrelationMode = aCorrelationMode;
  vBuildingCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

export const cityFragmentShader = /* glsl */ `
#include <fog_pars_fragment>

uniform sampler2D uWindowAtlas;
uniform float uWinFracW[7];     // per-archetype window width fraction (advanced mode)
uniform float uWinFracH[7];     // per-archetype window height fraction (advanced mode)
uniform float uWindowMode;      // 0 = simple (one shared size), 1 = advanced (per-archetype)
uniform float uWinSimpleW;      // simple-mode shared window width fraction
uniform float uWinSimpleH;      // simple-mode shared window height fraction
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
uniform float uIntroCompleteAt; // sharedTime value when progress hit 1 (1e9 = never)
uniform float uBreathingPeriod; // base period of the on/off cycle, seconds
uniform float uOrthoBlend;      // 0 = perspective, 1 = orthographic; LOD bypass scales by (1-this)
uniform float uAaEdge;          // fwidth edge-AA multiplier (window-quality panel)
uniform float uLodNear;         // cells-per-pixel where distance wash starts
uniform float uLodRange;        // ramp width from uLodNear to full wash
uniform float uOccupancyBias;   // sine-threshold shift; higher = more windows lit
uniform float uChurn;           // fraction of windows that breathe over time

varying vec2 vUv;
varying vec3 vNormalLocal;
varying vec3 vNormalWorld;
varying vec2 vAtlasOffset;
varying vec2 vAtlasSize;
varying vec3 vGrid;
varying vec3 vFacadeColor;
varying float vFacadeGlow;
varying float vBuildingHash;
varying float vDistrictIdx;
varying float vCorrelationMode;
varying vec3 vBuildingCenter;
varying float vFaceId;
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

  vec2 cell = vUv * vGrid.xy;
  vec2 cellLocal = fract(cell);
  // #25 per-face uniqueness: shift cellId by (faceId*7, faceId*11) BEFORE all
  // per-cell math (atlas sample, hashes, breathing seed, intro wake). Using
  // the shifted id everywhere means each face has its own atlas pattern AND
  // its own independent on/off schedule — otherwise the same rows light up
  // at the same time on all 4 sides and the building still reads as identical.
  // Physical cellLocal stays unshifted so window position within a cell is
  // correct on every face. Coprime offsets (7, 11) keep the 4 patterns
  // distinct across typical grid sizes (3..20).
  vec2 cellId = floor(cell) + vec2(vFaceId * 7.0, vFaceId * 11.0);
  vec2 atlasCell = mod(cellId, vGrid.xy);
  vec2 cellCentreUv = (atlasCell + 0.5) / vGrid.xy;
  vec2 atlasUv = vAtlasOffset + cellCentreUv * vAtlasSize;
  vec4 state = texture2D(uWindowAtlas, atlasUv);

  // Per-archetype window fraction, selected by archetype index. A constant-
  // bounded loop (not dynamic uniform indexing) keeps this GLSL ES 1.00 safe.
  // Per-building jitter (deterministic) + Heritage age scale, then clamp.
  float fracW;
  float fracH;
  if (uWindowMode < 0.5) {
    // Simple mode: one shared window size — no per-archetype / age / jitter.
    fracW = uWinSimpleW;
    fracH = uWinSimpleH;
  } else {
    int archIdx = int(vGrid.z + 0.5);
    fracW = uWinFracW[0];
    fracH = uWinFracH[0];
    for (int k = 1; k < 7; k++) {
      if (k == archIdx) {
        fracW = uWinFracW[k];
        fracH = uWinFracH[k];
      }
    }
    // Heritage (oldtown, district index 3) gets smaller windows + per-building jitter.
    float ageScale = abs(vDistrictIdx - 3.0) < 0.5 ? 0.7 : 1.0;
    float winJit = 1.0 + (hash11(vBuildingHash * 1.7 + 5.0) - 0.5) * 0.3;
    fracW *= ageScale * winJit;
    fracH *= ageScale * winJit;
  }
  fracW = clamp(fracW, 0.05, 0.95);
  fracH = clamp(fracH, 0.05, 0.95);
  float halfW = fracW * 0.5;
  float halfH = fracH * 0.5;
  // Screen-space derivatives smooth the window/facade edge by ~1px regardless
  // of distance: crisp up close, anti-aliased at range.
  // fwidth on the CONTINUOUS grid coord, not fract(cell): fract jumps 1→0 at
  // every cell boundary so its derivative spikes there, blowing up the AA band
  // into a visible facade seam line at each window edge.
  float fwX = max(fwidth(cell.x) * uAaEdge, 0.001);
  float fwY = max(fwidth(cell.y) * uAaEdge, 0.001);
  // Cap the AA band at 90% of the half-window in BOTH projections. Uncapped, a
  // grazing facade (huge fwidth from foreshortening) widens the mask past the
  // cell and lights the whole panel — window + border. Capped, the window keeps
  // its size with a soft edge; genuine far-field wash is handled by the LOD.
  float aaX = min(fwX, halfW * 0.9);
  float aaY = min(fwY, halfH * 0.9);
  float wMaskX =
    smoothstep(0.5 - halfW - aaX, 0.5 - halfW + aaX, cellLocal.x) *
    (1.0 - smoothstep(0.5 + halfW - aaX, 0.5 + halfW + aaX, cellLocal.x));
  float wMaskY =
    smoothstep(0.5 - halfH - aaY, 0.5 - halfH + aaY, cellLocal.y) *
    (1.0 - smoothstep(0.5 + halfH - aaY, 0.5 + halfH + aaY, cellLocal.y));
  float wMask = wMaskX * wMaskY;
  bool inWindow = wMask > 0.01;

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
        // 3 Hz — calmer than the original 8 Hz and matches the typical scan
        // rate of a real TV at this perceived distance.
        float tick = floor(uTime * 3.0);
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

    // Post-intro breathing. Each window picks a slow sine; vCorrelationMode
    // decides whether the phase is per-window, per-block (2..5 horizontal
    // blocks per floor), or whole-floor. A small fraction of cells are
    // "stragglers" (someone working late with a desk lamp) and stay lit
    // regardless of the floor / block phase.
    float lifeSeed;
    if (vCorrelationMode > 1.5) {
      // Whole-floor cohort.
      lifeSeed = hash11(cellId.y + vBuildingHash * 13.0);
    } else if (vCorrelationMode > 0.5) {
      // Per-block cohort. Block count 2..5 derived from the building hash.
      float blockCount = floor(2.0 + mod(vBuildingHash * 0.317, 4.0));
      float blockId = floor(cellId.x / max(1.0, vGrid.x) * blockCount);
      lifeSeed = hash11(cellId.y + blockId * 7.0 + vBuildingHash * 13.0);
    } else {
      // Per-window (residential default).
      lifeSeed = hash11(cellId.x + cellId.y * 17.0 + vBuildingHash + 7.0);
    }
    float period = max(1.0, uBreathingPeriod + lifeSeed * uBreathingPeriod * 2.0);
    float phase = lifeSeed * 6.2831853;
    float life = sin(uTime / period * 6.2831853 + phase);
    // Default: rooms snap on/off like a wall switch (tight smoothstep band).
    // A small fraction (~10%) use a wide band — these are the dimmer-switch
    // cells that fade in and out. TV cells (atlas alpha 128) always stay on so
    // their existing per-frame flicker logic remains the only motion in them.
    bool isTv = state.a > 0.2 && state.a < 0.7;
    // Binary wall-switch occupancy — every room snaps on/off at the sine's zero
    // crossing, no fade. uOccupancyBias shifts the threshold so a higher value
    // leaves more windows lit at any instant (fewer rooms dark / "dimming").
    // Only uChurn fraction of windows actually cycle over time; the rest freeze
    // at sin(phase) so the city is mostly static with a few rooms changing —
    // that is what keeps the per-frame flicker down. At litBias=1 nothing
    // crosses the threshold so there is no toggling at all.
    float breatheSeed = hash11(cellId.x * 5.7 + cellId.y * 3.1 + vBuildingHash + 71.0);
    float occLife = (breatheSeed < uChurn) ? life : sin(phase);
    float occupancy = isTv ? 1.0 : step(0.0, occLife + uOccupancyBias);
    // Working-late stragglers: a few cells per building stay lit even when
    // their cohort goes dark. Independent per-cell hash so a cell can be both
    // a straggler and a dimmer.
    float strugglerSeed = hash11(cellId.x * 1.7 + cellId.y * 23.0 + vBuildingHash + 19.0);
    if (strugglerSeed < 0.06) {
      occupancy = max(occupancy, 0.9);
    }
    float postIntroSec = max(0.0, uTime - uIntroCompleteAt);
    float postIntroMix = clamp(postIntroSec / 5.0, 0.0, 1.0);
    lit *= mix(1.0, occupancy, postIntroMix);

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

    // Derivative-based LOD: when one fragment covers a sizeable chunk of an
    // atlas cell, NearestFilter sampling of the binary alpha encoding produces
    // Moiré speckle. We need to actively BYPASS per-cell sampling at distance,
    // not just tint over it, since the per-cell lit color is what flips.
    // Cells spanned per pixel, from the CONTINUOUS grid coord. fwidth on the
    // stepped atlasUv (sampled at cell centres) is ~0 inside a cell and spikes
    // at boundaries, so it neither engages LOD on cell interiors (lingering
    // moiré) nor measures footprint cleanly (seam glow). fwidth(cell) is exactly
    // the cells-per-pixel rate and is smooth across the facade.
    // min, not max: a grazing facade has one foreshortened axis with huge
    // cells/pixel while the other stays resolved. max would force a full wash on
    // grazing alone (whole panel glows); min only engages when the window is
    // sub-resolved in BOTH dimensions, i.e. genuinely far.
    float relSpan = min(fwidth(cell.x), fwidth(cell.y));
    // 0 below 0.12 (close, crisp), 1 above 0.45 (far / grazing, smooth glow).
    // Disabled in ortho — fwidth(atlasUv) is uniform across the ortho frustum
    // so the LOD path would mask the entire scene; ortho also doesn't have the
    // perspective-grazing Moiré that motivated the bypass in the first place.
    // relSpan is cells-per-pixel: ~0.2 = a 5px window (start fading), ~0.6 =
    // sub-Nyquist ~1.5px (full glow). Stays 0 for near/mid windows so they keep
    // crisp per-cell detail.
    float lod = clamp((relSpan - uLodNear) / max(uLodRange, 0.001), 0.0, 1.0) * (1.0 - uOrthoBlend);

    // Smooth distant approximation: facade + warm glow that doesn't depend on
    // per-cell atlas state at all. Brightness scales with vFacadeGlow so the
    // layered (front/mid/back) buildings keep their relative read.
    vec3 distantGlow =
      facade +
      vec3(1.0, 0.78, 0.5) * uEmissiveBoost * 0.22 * (0.5 + vFacadeGlow);

    // Up close (lod=0): full per-cell render.
    // Far (lod=1): wMask is zero'd so no per-cell sampling reaches output;
    // distantGlow takes over via wake. Speckle source gone.
    vec3 nearColor = mix(facade, lit, wake * wMask);
    vec3 farColor = mix(facade, distantGlow, wake);
    color = mix(nearColor, farColor, lod);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;
