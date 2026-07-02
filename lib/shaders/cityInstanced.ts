export const cityVertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

attribute vec2 aAtlasOffset;
attribute vec2 aAtlasSize;
attribute vec3 aGrid; // cols, rows, archetypeIdx (idx packed into .z to save an attribute slot)
attribute vec3 aFacadeColor;
attribute float aFacadeGlow;
attribute float aBuildingHash;
// Packed per-instance scalars — keeps us under the hard ~16 vertex-attribute
// cap (GL_MAX_VERTEX_ATTRIBS). Components:
//   x = district idx        (0=downtown, 1=residential, 2=industrial, 3=oldtown)
//   y = breathing correlation (0=per-window, 1=per-block, 2=whole-floor; office
//       archetypes pick {0,1,2} per building so the city has a mix)
//   z = depth band          (0=front, 1=mid, 2=back) — drives the depth tint mode
//   w = population          (people-equivalent, p95-normalised 0..1 — pop tint)
attribute vec4 aMisc;
// Debug-view tint (Slice A): the parcel's plan colour (matches DistrictShells).
attribute vec3 aDebugDistrictColor;

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
varying vec3 vDebugDistrictColor;
varying float vLayerIdx;
varying float vBuildingHeight;  // world height (instance scale.y), for the height tint ramp
varying float vPopulation;      // people-equivalent 0..1, for the population tint ramp
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
  vDistrictIdx = aMisc.x;
  vCorrelationMode = aMisc.y;
  vLayerIdx = aMisc.z;
  vPopulation = aMisc.w;
  vBuildingCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vDebugDistrictColor = aDebugDistrictColor;
  vBuildingHeight = scaleVec.y; // instance Y scale == building height

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

export const cityFragmentShader = /* glsl */ `
#include <fog_pars_fragment>

uniform sampler2D uWindowAtlas;
uniform float uWinFracWMin[7];  // per-archetype window ranges (advanced mode) —
uniform float uWinFracWMax[7];  //   each building rolls ONE seeded width and ONE
uniform float uWinFracHMin[7];  //   seeded height inside its archetype's
uniform float uWinFracHMax[7];  //   [min, max] brackets (independent rolls)
uniform float uWindowMode;      // 0 = simple (one shared size), 1 = advanced (per-archetype)
uniform float uWinSimpleWMin;   // simple-mode window width range
uniform float uWinSimpleWMax;
uniform float uWinSimpleHMin;   // simple-mode window height range
uniform float uWinSimpleHMax;
uniform float uEmissiveBoost;
uniform float uTime;

// Intro / wake-up uniforms (After-Dark model).
//   uIntroMode:        0=random, 1=district, 2=outside-in, 3=far-to-near, 4=inside-out
//   uIntroCamPos:      world-space camera position snapshot used by mode 3
//   uIntroCityCenter:  world-space city centre used by modes 2 / 4 as the radial axis
//   uIntroMaxRadius:   largest horizontal distance from centre, normaliser
//   uIntroStartTime:   sharedTime when intro fired — wake = startTime + baseline * duration
//   uIntroDuration:    full cascade duration, seconds (each cell picks t0 in [0, duration])
//   uOffCycle:         seconds a cell stays ON after wake (per-cell jitter ±30%)
//   uRetrigger:        seconds a cell stays OFF between ONs (per-cell jitter ±30%)
uniform int uIntroMode;
uniform vec3 uIntroCamPos;
uniform vec3 uIntroCityCenter;
uniform float uIntroMaxRadius;
uniform float uIntroStartTime;
uniform float uIntroDuration;
uniform float uOffCycle;
uniform float uRetrigger;
uniform float uCycleJitter; // 0..1 amplitude on per-window cycle randomness
uniform float uStagger;     // share of correlated floors that switch on in banks
uniform float uCurtainShare; // share of correlated office towers with full-glass facades
uniform float uCurtainWidth; // pane fill on curtain towers; 1.0 = seamless one-window floors
uniform float uLightsOn;    // 1 = normal; 0 = every window dark (facade debug switch)
uniform float uOrthoBlend;      // 0 = perspective, 1 = orthographic; LOD bypass scales by (1-this)
uniform float uAaEdge;          // fwidth edge-AA multiplier (window-quality panel)
uniform float uLodNear;         // cells-per-pixel where distance wash starts
uniform float uLodRange;        // ramp width from uLodNear to full wash

// Debug building tint (Slice A). uDebugMode: 0 off, 1 district(parcel),
// 2 land-use, 3 archetype, 4 depth band, 5 height, 6 population. uDebugTint =
// mix amount (0 → scene byte-identical to off). Palettes are flat distinct
// debug colours.
uniform float uDebugMode;
uniform float uDebugTint;
uniform float uMaxHeight;
uniform vec3 uLandusePalette[4];
uniform vec3 uArchetypePalette[7];
uniform vec3 uDepthPalette[3];
// Slice B wireframe: when on, output a flat bright stroke colour (no fog) so the
// edges read against the dark night background instead of the near-black facade.
uniform float uWireframe;
uniform vec3 uWireColor;

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
varying vec3 vDebugDistrictColor;
varying float vLayerIdx;
varying float vBuildingHeight;
varying float vPopulation;
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// Per-instance debug tint colour by category. Palette indexing uses constant-
// bounded loops (not dynamic uniform indexing) to stay GLSL ES 1.00 safe, same
// pattern as the per-archetype window-fraction lookup.
vec3 debugTintColor() {
  if (uDebugMode < 1.5) {
    return vDebugDistrictColor;                      // 1: district parcel (plan palette)
  } else if (uDebugMode < 2.5) {                     // 2: land-use type
    int idx = int(vDistrictIdx + 0.5);
    vec3 c = uLandusePalette[0];
    for (int k = 1; k < 4; k++) { if (k == idx) c = uLandusePalette[k]; }
    return c;
  } else if (uDebugMode < 3.5) {                     // 3: archetype
    int idx = int(vGrid.z + 0.5);
    vec3 c = uArchetypePalette[0];
    for (int k = 1; k < 7; k++) { if (k == idx) c = uArchetypePalette[k]; }
    return c;
  } else if (uDebugMode < 4.5) {                     // 4: depth band (front/mid/back)
    int idx = int(vLayerIdx + 0.5);
    vec3 c = uDepthPalette[0];
    for (int k = 1; k < 3; k++) { if (k == idx) c = uDepthPalette[k]; }
    return c;
  } else if (uDebugMode < 5.5) {
    // 5: height — blue (low) → green → amber → red (tall)
    float t = clamp(vBuildingHeight / max(uMaxHeight, 1.0), 0.0, 1.0);
    vec3 c = mix(vec3(0.15, 0.30, 0.90), vec3(0.20, 0.95, 0.60), smoothstep(0.0, 0.4, t));
    c = mix(c, vec3(1.0, 0.85, 0.20), smoothstep(0.35, 0.75, t));
    c = mix(c, vec3(1.0, 0.25, 0.20), smoothstep(0.70, 1.0, t));
    return c;
  }
  // 6: population — the heat-map's inferno ramp (indigo → magenta → orange →
  // pale yellow) so the building tint and the ground overlay read as one scale.
  float t = clamp(vPopulation, 0.0, 1.0);
  vec3 c = mix(vec3(0.13, 0.07, 0.29), vec3(0.47, 0.11, 0.43), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(0.93, 0.41, 0.15), smoothstep(0.30, 0.70, t));
  c = mix(c, vec3(0.99, 0.91, 0.64), smoothstep(0.65, 1.0, t));
  return c;
}

// Complete per-cell window state at an arbitrary point on the facade grid:
// rgb = the lit colour (atlas tint x emissive boost x TV/band brightness),
// a   = windowOn (wake + duty cycle + fractional-band segment gating).
// Extracted from main so the anisotropic supersample (#82) can average it at
// several points along a sub-resolved screen axis — every per-cell decision
// (atlas state, hashes, cycle clocks) lives HERE and nowhere else. cellF is the
// continuous grid coord of the sample point; bandFade is the precomputed
// sub-resolution fade for the band-pane brightness jitter.
vec4 windowCellState(vec2 cellF, float bandFade) {
  float rowCoherent = step(1.5, vCorrelationMode);
  float fracFloor = rowCoherent * (1.0 - step(2.5, vCorrelationMode)); // mode 2 exactly
  vec2 cellId = floor(cellF) + vec2(vFaceId * 7.0, vFaceId * 11.0 * (1.0 - rowCoherent));
  vec2 atlasCell = mod(cellId, vGrid.xy);
  vec2 cellCentreUv = (atlasCell + 0.5) / vGrid.xy;
  vec4 state = texture2D(uWindowAtlas, vAtlasOffset + cellCentreUv * vAtlasSize);
  bool isBand = state.a > 0.7 && state.a < 0.9;
  bool isTv = state.a > 0.2 && state.a < 0.7;
  float isCurtain = 0.0;
  if (rowCoherent > 0.5 && vGrid.z > 4.5 && isBand &&
      hash11(vBuildingHash * 4.1 + 67.0) < uCurtainShare) {
    isCurtain = 1.0;
  }

  // Correlated band cells share their timing: a whole-floor band uses one
  // clock for the row on EVERY face (jx = 0); fractional bands AND curtain
  // floors key per face, so each side wakes and cycles on its own. Per-window
  // cells keep per-cell timing via the column term.
  float faceClock = max(fracFloor, isCurtain);
  float jx = isBand ? vFaceId * 31.0 * faceClock : cellId.x;
  float seed = hash11(jx + cellId.y * 17.0 + vBuildingHash);

  vec3 lit;
  if (state.a > 0.2) {
    float brightness = 1.0;
    if (isTv) {
      // 3 Hz — matches the typical scan rate of a real TV at this distance.
      float tick = floor(uTime * 3.0);
      float n = hash11(tick + seed * 100.0);
      brightness = 0.4 + n * 0.6;
    } else if (isBand) {
      // Static per-pane luminance jitter (±18%) so a lit floor reads as glass
      // panels over one interior; fades toward its mean as panes go
      // sub-resolved (bandFade, fixed constants — see main).
      brightness = 0.82 + 0.36 * hash11(cellId.x * 9.1 + cellId.y * 4.3 + vBuildingHash + 151.0);
      brightness = mix(brightness, 1.0, bandFade);
      brightness *= 1.0 + 0.15 * isCurtain;
    }
    lit = state.rgb * uEmissiveBoost * brightness;
  } else {
    // Atlas-unlit cells: default warm tungsten for the wake-up sweep — dimmer
    // than the average lit window so full-lit moments still read as a city.
    lit = vec3(1.0, 0.82, 0.55) * uEmissiveBoost * 0.55;
  }

  // After-Dark wake-and-cycle. Step 1: order cells by intro mode, pick a
  // per-cell wake time in [0, uIntroDuration]. Step 2: after wake, alternate
  // ON (uOffCycle ±30%) / OFF (uRetrigger ±30%) with per-cell jitter so the
  // city doesn't pulse in unison. TV cells skip the cycle once they wake.
  float baseline = 0.0;
  if (uIntroMode == 0) {
    baseline = seed;
  } else if (uIntroMode == 1) {
    baseline = vDistrictIdx / 3.0;
  } else if (uIntroMode == 2) {
    vec2 d = vBuildingCenter.xz - uIntroCityCenter.xz;
    float r = clamp(length(d) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
    baseline = 1.0 - r;
  } else if (uIntroMode == 3) {
    float farD = distance(vBuildingCenter, uIntroCamPos);
    float r = clamp(farD / max(1.0, uIntroMaxRadius * 2.0), 0.0, 1.0);
    baseline = 1.0 - r;
  } else {
    vec2 d = vBuildingCenter.xz - uIntroCityCenter.xz;
    float r = clamp(length(d) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
    baseline = r;
  }
  float wakeJitter = hash11(jx * 1.31 + cellId.y * 11.7 + vBuildingHash + 41.0);
  float onJitter = hash11(jx * 5.7 + cellId.y * 3.1 + vBuildingHash + 71.0);
  float offJitter = hash11(jx * 1.7 + cellId.y * 23.0 + vBuildingHash + 19.0);
  float t0 = clamp(baseline, 0.0, 1.0) * uIntroDuration +
             wakeJitter * min(uIntroDuration * 0.04, 4.0);
  float wakeTime = uIntroStartTime + t0;

  // Switch-bank stagger: a share (uStagger) of correlated floors light up in
  // 2..4 column banks, 0.6–1.6 s apart — banks of switches down the hall.
  if (isBand && hash11(cellId.y * 23.0 + vBuildingHash + 211.0) < uStagger) {
    float banks = 2.0 + floor(hash11(cellId.y * 3.3 + vBuildingHash + 61.0) * 2.999);
    float bank = floor(floor(cellF.x) / max(1.0, ceil(vGrid.x / banks)));
    if (hash11(cellId.y * 7.7 + vBuildingHash + 97.0) < 0.5) bank = banks - 1.0 - bank;
    wakeTime += bank * (0.6 + hash11(cellId.y * 5.1 + vBuildingHash + 23.0));
  }

  float windowOn;
  if (uTime < wakeTime) {
    windowOn = 0.0;
  } else if (isTv) {
    windowOn = 1.0;
  } else {
    // (1 - jitter) .. (1 + jitter) — at jitter=0 every window cycles in
    // lockstep; at jitter=1 multipliers span 0..2.
    float onSec = max(0.5, uOffCycle * (1.0 - uCycleJitter + onJitter * uCycleJitter * 2.0));
    float offSec = max(0.5, uRetrigger * (1.0 - uCycleJitter + offJitter * uCycleJitter * 2.0));
    // Curtain ribbons hold their light 4x longer — trading floors and cleaning
    // crews, not apartment lamps.
    if (isCurtain > 0.5) onSec *= 4.0;
    float elapsed = uTime - wakeTime;
    float period = onSec + offSec;
    float phase = mod(elapsed, period);
    windowOn = phase < onSec ? 1.0 : 0.0;
  }

  // Fractional-floor band: only a per-(face, floor) SEGMENT of the row lights —
  // length and position hashed independently per face. Curtain floors are
  // exempt (a curtain ribbon spans its whole face).
  if (fracFloor > 0.5 && isBand && isCurtain < 0.5) {
    float col = floor(cellF.x);
    float u1 = hash11(vFaceId * 3.7 + cellId.y * 13.1 + vBuildingHash + 101.0);
    float u2 = hash11(vFaceId * 9.3 + cellId.y * 5.7 + vBuildingHash + 137.0);
    float litCount = floor(pow(u1, 1.6) * (vGrid.x + 0.999));
    float start = floor(u2 * (vGrid.x - litCount + 1.0));
    if (col < start || col > start + litCount - 1.0) windowOn = 0.0;
  }

  return vec4(lit, windowOn);
}

void main() {
  // Wireframe (Slice B): flat stroke, no window math, no fog. Colour matches the
  // building tint mode — blue default (uWireColor) when no mode is active, else
  // the active mode's per-instance colour, so the wireframe reads like the tint.
  if (uWireframe > 0.5) {
    vec3 wireC = uDebugMode > 0.5 ? debugTintColor() : uWireColor;
    gl_FragColor = vec4(wireC, 1.0);
    return;
  }

  vec3 facade = vFacadeColor * (1.0 + vFacadeGlow);

  // Top + bottom faces: solid facade — detect via the geometry-local normal
  // (works regardless of instance rotation since BoxGeometry top/bottom faces
  // always have local normal ±Y).
  float upDotLocal = abs(vNormalLocal.y);
  if (upDotLocal > 0.5) {
    vec3 topc = facade;
    if (uDebugTint > 0.0001) topc = mix(topc, debugTintColor(), uDebugTint);
    gl_FragColor = vec4(topc, 1.0);
    #include <fog_fragment>
    return;
  }

  vec2 cell = vUv * vGrid.xy;
  vec2 cellLocal = fract(cell);
  // Cells-per-pixel PER AXIS from the CONTINUOUS grid coord (see the LOD block
  // below for why not atlasUv). relSpan (min) drives the isotropic distance
  // wash: sub-resolved in BOTH axes = genuinely far.
  float spanX = fwidth(cell.x);
  float spanY = fwidth(cell.y);
  float relSpan = min(spanX, spanY);
  // Anisotropic sub-resolution (#82): a grazing facade collapses ONE axis
  // (several cells per pixel column) while the other stays resolved, so the
  // min-gated wash never engages and per-cell state renders as stripe/churn
  // noise. Per-axis ramps drive (a) the window-mask cell-mean below and (b) the
  // footprint-averaged cell state in the lit path. Fixed constants like the
  // band-jitter fade — this is aliasing control, not a detail knob, so the LOD
  // sliders can't reintroduce it. Ortho has uniform derivatives and no grazing
  // perspective; scale out like the wash does.
  float lodAnisoX = smoothstep(0.3, 0.9, spanX) * (1.0 - uOrthoBlend);
  float lodAnisoY = smoothstep(0.3, 0.9, spanY) * (1.0 - uOrthoBlend);
  // Band-pane brightness jitter fade (2026-07-02): reads as interior depth up
  // close, aliases into speckle under ~4px panes — fade toward the mean on the
  // WORST axis (max: a grazed band is sub-resolved along the row even when
  // floors stay resolved).
  float bandFade = smoothstep(0.15, 0.35, max(spanX, spanY));
  // #25 per-face uniqueness: shift cellId by (faceId*7, faceId*11) BEFORE all
  // per-cell math (atlas sample, hashes, breathing seed, intro wake). Using
  // the shifted id everywhere means each face has its own atlas pattern AND
  // its own independent on/off schedule — otherwise the same rows light up
  // at the same time on all 4 sides and the building still reads as identical.
  // Physical cellLocal stays unshifted so window position within a cell is
  // correct on every face. Coprime offsets (7, 11) keep the 4 patterns
  // distinct across typical grid sizes (3..20).
  // Correlated-floor buildings (mode 2 fractional / mode 3 whole-floor) skip
  // the per-face Y shift so a floor samples the SAME atlas row on all four
  // faces — a lit floor wraps the corners as one slab instead of breaking at
  // every edge. X keeps its shift (band rows are uniform across the row, so
  // it has nothing to desync there).
  float rowCoherent = step(1.5, vCorrelationMode);
  vec2 cellId = floor(cell) + vec2(vFaceId * 7.0, vFaceId * 11.0 * (1.0 - rowCoherent));
  vec2 atlasCell = mod(cellId, vGrid.xy);
  vec2 cellCentreUv = (atlasCell + 0.5) / vGrid.xy;
  vec2 atlasUv = vAtlasOffset + cellCentreUv * vAtlasSize;
  vec4 state = texture2D(uWindowAtlas, atlasUv);
  // Correlated band cell (atlas alpha ≈ 0.78): part of a row painted as one
  // lit unit. Sampled here (redundantly with windowCellState — same cached
  // texel) because the curtain FRACTION override below feeds the mask, which
  // is main's job; timing/colour per-cell logic lives in windowCellState.
  bool isBand = state.a > 0.7 && state.a < 0.9;

  // Per-archetype window fraction, selected by archetype index. A constant-
  // bounded loop (not dynamic uniform indexing) keeps this GLSL ES 1.00 safe.
  // Width AND height each roll ONE seeded value per building inside the
  // panel's [min, max] ranges — vBuildingHash is per-instance, so every window
  // on a building shares the size while neighbours differ. Independent hashes
  // decorrelate the two dimensions. Deterministic (seeded hash, no time input).
  float wRoll = hash11(vBuildingHash * 2.3 + 13.0);
  float hRoll = hash11(vBuildingHash * 3.7 + 29.0);
  float fracW;
  float fracH;
  if (uWindowMode < 0.5) {
    fracW = mix(uWinSimpleWMin, uWinSimpleWMax, wRoll);
    fracH = mix(uWinSimpleHMin, uWinSimpleHMax, hRoll);
  } else {
    int archIdx = int(vGrid.z + 0.5);
    float wMin = uWinFracWMin[0];
    float wMax = uWinFracWMax[0];
    float hMin = uWinFracHMin[0];
    float hMax = uWinFracHMax[0];
    for (int k = 1; k < 7; k++) {
      if (k == archIdx) {
        wMin = uWinFracWMin[k];
        wMax = uWinFracWMax[k];
        hMin = uWinFracHMin[k];
        hMax = uWinFracHMax[k];
      }
    }
    fracW = mix(wMin, wMax, wRoll);
    fracH = mix(hMin, hMax, hRoll);
    // Heritage (oldtown, district index 3) gets smaller windows. The old
    // hard-coded per-building height jitter is gone — variance in both
    // dimensions now comes from the range rolls.
    float ageScale = abs(vDistrictIdx - 3.0) < 0.5 ? 0.7 : 1.0;
    fracW *= ageScale;
    fracH *= ageScale;
  }
  fracW = clamp(fracW, 0.05, 1.0);
  fracH = clamp(fracH, 0.05, 1.0);
  // RNG rolls land INSIDE a [min, max] range, never on its endpoint — so a
  // range topping out near 1.0 would otherwise never produce one truly
  // seamless facade. Snap rolls ≥ 0.98 to exact 1.0: with the spire width
  // ceiling at its 0.99 default, the top slice of rolls becomes organic
  // full-bleed towers. Runs BEFORE the curtain override below, so the
  // crt-width knob (0.99 default) keeps its hairline panes instead of
  // snapping to seamless.
  fracW = fracW >= 0.98 ? 1.0 : fracW;
  fracH = fracH >= 0.98 ? 1.0 : fracH;
  // Curtain wall: on a seeded share of correlated OFFICE buildings (archetype
  // 5 office-block / 6 spire — never warehouses), the correlated BAND floors
  // render as curtain glass: width pinned to uCurtainWidth (hairline panes at
  // the 0.99 default; one continuous window at exactly 1.0), height high with
  // a slim spandrel. FLOORS, not buildings — the tower's other floors keep
  // their punched windows, so a curtain tower reads as a normal facade with
  // occasional glass ribbons (an all-glass building read as a neon tube,
  // 2026-06-06). Live uniforms; override the panel ranges for those cells.
  float isCurtain = 0.0;
  if (rowCoherent > 0.5 && vGrid.z > 4.5 && isBand &&
      hash11(vBuildingHash * 4.1 + 67.0) < uCurtainShare) {
    isCurtain = 1.0;
    // 1 in 5 curtain towers goes FULL curtain — exact 1.0 — so true curtains
    // occur occasionally without touching the knobs (an rng roll alone never
    // lands exactly on 1.0). The rest take the crt-width knob.
    float fullRoll = hash11(vBuildingHash * 8.3 + 147.0);
    fracW = fullRoll < 0.2 ? 1.0 : uCurtainWidth;
    fracH = mix(0.72, 0.92, hash11(vBuildingHash * 6.7 + 31.0));
    // Corner piers: the outermost column on each face keeps a reduced pane,
    // terminating each face's ribbon at a visible structural pier instead of
    // letting the glass wrap the corner as one continuous window.
    float pierCol = floor(cell.x);
    if (pierCol < 0.5 || pierCol > vGrid.x - 1.5) fracW = min(fracW, 0.78);
  }
  float halfW = fracW * 0.5;
  float halfH = fracH * 0.5;
  // Screen-space derivatives smooth the window/facade edge by ~1px regardless
  // of distance: crisp up close, anti-aliased at range.
  // fwidth on the CONTINUOUS grid coord, not fract(cell): fract jumps 1→0 at
  // every cell boundary so its derivative spikes there, blowing up the AA band
  // into a visible facade seam line at each window edge.
  float fwX = max(spanX * uAaEdge, 0.001);
  float fwY = max(spanY * uAaEdge, 0.001);
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
  // Full-bleed panes: the smoothstep pair pins the window edge ON the cell
  // boundary, so even at fraction 1.0 the mask dips to 0.5 there — a phantom
  // mullion line. Fade the dip out over the LAST ~1% only (0.991 → 0.999), so
  // 0.99 keeps hairline mullions and exactly 1.0 reads as truly continuous
  // glass — the "whole floor is one window" curtain look is opt-in at 1.0,
  // never an accident of a high slider.
  wMaskX = mix(wMaskX, 1.0, smoothstep(0.4955, 0.4995, halfW));
  wMaskY = mix(wMaskY, 1.0, smoothstep(0.4955, 0.4995, halfH));
  // Anisotropic mask mean (#82): once an axis's thinnest mask FEATURE — the
  // lit run (frac) or the gap between runs (1 - frac), whichever is smaller —
  // drops under ~a pixel, it cannot be drawn faithfully: NEAREST-phase
  // quantisation lands it on occasional whole pixel columns (the irregular
  // "barcode" stripes on curtain/band floors, whose 1% mullions go sub-pixel
  // even on 40px cells). The analytic mean of the mask over a cell is just the
  // fraction, so converge to it as the feature crosses 2px → 1px. Also engages
  // via the cell-level aniso ramp (grazing) — whichever fires first. Free: no
  // extra samples, exact in the limit.
  float featX = min(fracW, 1.0 - fracW) / max(spanX, 1e-4); // thinnest X feature in px
  float featY = min(fracH, 1.0 - fracH) / max(spanY, 1e-4);
  float maskLodX = max(lodAnisoX, 1.0 - smoothstep(1.0, 2.0, featX));
  float maskLodY = max(lodAnisoY, 1.0 - smoothstep(1.0, 2.0, featY));
  wMaskX = mix(wMaskX, fracW, maskLodX);
  wMaskY = mix(wMaskY, fracH, maskLodY);
  float wMask = wMaskX * wMaskY;
  bool inWindow = wMask > 0.01;

  vec3 color = facade;

  // The intro should fill every window: cells that are atlas-unlit at night
  // still light up during the wake-up sweep using a default warm color. The
  // existing flicker / twinkle behaviour stays scoped to the atlas-lit subset
  // (alpha encoding 128 = TV-blue, 255 = steady).
  if (inWindow) {
    // Per-cell state (atlas classification, brightness, wake + duty cycle,
    // fractional-band gating) — single source in windowCellState above.
    vec4 cw = windowCellState(cell, bandFade);
    vec3 lit = cw.rgb;
    float windowOn = cw.a;

    // Anisotropic footprint average (#82): when the DOMINANT screen axis spans
    // multiple cells per pixel while the other stays resolved (grazing facade),
    // per-cell state flips column-to-column — vertical stripe combs / diagonal
    // churn. Average the cell state at 4 points across the footprint along the
    // compressed axis and blend it in by the aniso ramp. The resolved axis
    // keeps full detail (floors/columns stay readable) — this is what neither
    // min() (never engages) nor max() (whole-panel glow) could do.
    float lodTap = max(lodAnisoX, lodAnisoY);
    if (lodTap > 0.001) {
      vec2 tapDir = spanX >= spanY ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      // Cap the averaging window: past ~6 cells/px 4 taps undersample anyway
      // and the isotropic wash below is close behind.
      float tapSpan = min(max(spanX, spanY), 6.0);
      vec3 litAcc = vec3(0.0);
      float onAcc = 0.0;
      for (int k = 0; k < 4; k++) {
        float t = (float(k) + 0.5) * 0.25 - 0.5; // -0.375, -0.125, +0.125, +0.375
        vec4 s = windowCellState(cell + tapDir * (t * tapSpan), bandFade);
        litAcc += s.rgb * s.a;
        onAcc += s.a;
      }
      // On-weighted mean colour + mean coverage: a half-lit footprint reads as
      // the average lit colour at half strength, not as noise.
      vec3 avgLit = litAcc / max(onAcc, 0.001);
      float avgOn = onAcc * 0.25;
      lit = mix(lit, avgLit, lodTap);
      windowOn = mix(windowOn, avgOn, lodTap);
    }

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
    // sub-resolved in BOTH dimensions, i.e. genuinely far. The single-axis
    // grazing case is handled UPSTREAM by the anisotropic footprint average
    // (lodAnisoX/Y + windowCellState taps), which keeps the resolved axis.
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

    // Lights kill switch (facade debug): zeroing windowOn here darkens both
    // the per-cell path and the far glow (each is gated by windowOn below).
    windowOn *= uLightsOn;

    // Up close (lod=0): per-cell render with binary on/off gating.
    // Far (lod=1): per-cell sampling drops out, distantGlow takes over,
    // also gated by windowOn so a building reads dark before its windows wake.
    vec3 nearColor = mix(facade, lit, windowOn * wMask);
    vec3 farColor = mix(facade, distantGlow, windowOn);
    color = mix(nearColor, farColor, lod);
  }

  if (uDebugTint > 0.0001) color = mix(color, debugTintColor(), uDebugTint);
  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;
