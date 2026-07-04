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
// Hybrid far field (#82, lab-validated 2026-07-03): xyz = the building's
// on-weighted mean lit colour (same decoded+boosted space the lit path
// outputs), w = expected on-fraction of its cells (duty + TV statistics).
// Computed at build time from the same atlas data. NOTE: this is the 16th
// vertex attribute (instanceMatrix 4 + built-ins 3 + 9 customs) — exactly at
// the GL_MAX_VERTEX_ATTRIBS floor of 16. There is no headroom left.
attribute vec4 aMeanLit;

varying vec2 vUv;
varying vec3 vNormalLocal;     // pre-instance normal — face direction in geometry-local space
varying vec3 vNormalWorld;     // instance-rotated normal — used for face-up detection in world space
varying vec2 vAtlasOffset;
varying vec2 vAtlasSize;
varying vec3 vGrid;
varying vec3 vFacadeColor;
varying float vFacadeGlow;
// Per-building hash rolls, computed HERE from the exact attribute value — never
// in the fragment shader from an interpolated vBuildingHash. Rasterizers
// reconstruct a perspective-corrected varying with a few ulps of per-pixel
// wobble; at aBuildingHash's ~1e3 magnitude that is ~2e-4, and hash11 amplifies
// input error ~480x, so fragment-side hashing turned invisible interpolation
// noise into +/-0.03 on every roll — per-pixel salt-and-pepper on window edges
// at far telephoto poses (the "field view dithering", diagnosed 2026-07-03).
// Hashing per-vertex reads the attribute exactly; the [0,1) results interpolate
// between identical endpoints and are consumed linearly, so the noise path is
// gone for BOTH render modes. Components:
//   vSizeRolls: x = width roll, y = height roll (window fraction mixes),
//               z = curtain-share gate roll, w = full-curtain roll
//   vSeedRolls: x = curtain spandrel-height roll,
//               y = cell seed for per-cell timing/brightness hashes — an
//                   INTEGER 0..4095 so the fragment can snap interpolation
//                   ulps away exactly; those hashes feed binary on/off
//                   thresholds, where any residual noise shows as
//                   full-contrast per-pixel flips on knife-edge cells
varying vec4 vSizeRolls;
varying vec2 vSeedRolls;
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
varying vec4 vMeanLit;
// Same Hoskins fract hash as the fragment shader (and bakeCommon's float32
// mirror) — the rolls must be bit-comparable to what the fragment used to
// compute so window sizes do not re-roll.
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
void main() {
  vUv = uv;
  vMeanLit = aMeanLit;
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
  vSizeRolls = vec4(
    hash11(aBuildingHash * 2.3 + 13.0),
    hash11(aBuildingHash * 3.7 + 29.0),
    hash11(aBuildingHash * 4.1 + 67.0),
    hash11(aBuildingHash * 8.3 + 147.0)
  );
  vSeedRolls = vec2(hash11(aBuildingHash * 6.7 + 31.0), floor(hash11(aBuildingHash) * 4096.0));
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
uniform sampler2D uWindowAtlasFar; // trilinear-mipped twin — hybrid far field (box-filtered cell average)
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
uniform float uRenderMode;  // far-field strategy: 0 = classic distantGlow, 1 = hybrid mean-lit (#82)
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
// Texture-layer debug view (window-lab parity, 2026-07-03): 0 = final render,
// 1 = cell atlas (the raw per-window texel this fragment samples, full-bleed),
// 2 = window field (the pane mask as grayscale — aliasing shows here as
// dither, which is how the #82 mid-range stipple was isolated). Raw output,
// no fog, so the layers read as data, not as scene.
uniform float uWinDebugView;
// #69 archetype hover highlight — per-MESH state in one float (buildings are
// one InstancedMesh per archetype): 0 = idle, 0.5 = ANOTHER archetype is
// hovered (dim for contrast), 1 = THIS mesh's archetype is hovered (emissive
// lift). Eased CPU-side (~150ms), so in-between values must blend sensibly.
uniform float uHighlight;
// #69 hover strength (live-tunable via debug.hoverHighlight): matched-archetype
// lift + non-matched dim, read by highlightMul.
uniform float uHiLift;
uniform float uHiDim;
// #87 single-instance pick: the picked building's WORLD-SPACE centre, or a
// sentinel far outside the city when nothing is picked (see InstancedCity's
// PICK_SENTINEL). Compared against vBuildingCenter (below) rather than an
// instance-index attribute: this material already sits at the
// GL_MAX_VERTEX_ATTRIBS floor of 16 (see aMeanLit's comment above) — there is
// no free attribute slot for an identity channel, but every instance's world
// centre is already computed for the intro wake, and building footprints
// never overlap, so a distance test is exactly as selective as a slot-index
// match, at zero extra attribute cost. Broadcast identically to all 7
// archetype meshes — only the one actually containing a building at that
// position ever lights up.
uniform vec3 uPickPosition;

varying vec2 vUv;
varying vec3 vNormalLocal;
varying vec3 vNormalWorld;
varying vec2 vAtlasOffset;
varying vec2 vAtlasSize;
varying vec3 vGrid;
varying vec3 vFacadeColor;
varying float vFacadeGlow;
// Per-building rolls hashed in the VERTEX shader from the exact attribute (see
// the vertex-side comment): fragment-side hash11(vBuildingHash * k + c) turned
// varying-interpolation ulps into per-pixel window-size noise at far poses.
varying vec4 vSizeRolls; // x=width roll, y=height roll, z=curtain gate, w=full-curtain
varying vec2 vSeedRolls; // x=curtain spandrel-height roll, y=cell timing seed [0,64)
varying float vDistrictIdx;
varying float vCorrelationMode;
varying vec3 vBuildingCenter;
varying float vFaceId;
varying vec3 vDebugDistrictColor;
varying float vLayerIdx;
varying float vBuildingHeight;
varying float vPopulation;
varying vec4 vMeanLit;
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

// Hover-highlight brightness multiplier: 1 at idle, dips to a slight dim as
// uHighlight approaches 0.5 (another archetype hovered), lifts >1 toward 1
// (self hovered — HDR headroom is fine, the chain blooms it). Applied AFTER
// the debug tint so a hover layers over an active Building Tint mode instead
// of replacing it.
float highlightMul() {
  float dim = clamp(uHighlight * 2.0, 0.0, 1.0);
  float self = clamp(uHighlight * 2.0 - 1.0, 0.0, 1.0);
  float m = mix(mix(1.0, uHiDim, dim), uHiLift, self);
  // #87 single-instance pick: independent of the archetype-icon hover above —
  // lifts just the picked instance to the same uHiLift brightness even while
  // the rest of this mesh sits dimmed (another archetype hovered) or idle.
  // vBuildingCenter is a per-instance CONSTANT (same value at every vertex of
  // a given instance) but still a varying, so the rasterizer's perspective-
  // correct interpolation carries a few ulps of wobble — irrelevant at world-
  // coordinate scale against a 0.5 m gate, which only ever matches the one
  // instance actually sitting at uPickPosition.
  if (distance(vBuildingCenter, uPickPosition) < 0.5) {
    m = max(m, uHiLift);
  }
  return m;
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
  // Integer-valued varyings snapped to EXACT integers before any hash: the
  // rasterizer reconstructs even a constant varying with ulp wobble, and the
  // cycle hashes below feed binary on/off thresholds — knife-edge cells would
  // otherwise flip per pixel at far poses (same family as the vSizeRolls fix).
  float faceId = floor(vFaceId + 0.5);
  float cellSeed = floor(vSeedRolls.y + 0.5);
  // grid snapped too: mod(cellId, grid) sits ON a discontinuity whenever a
  // shifted column index is an exact multiple of cols (guaranteed for cols <=
  // 21 on faces 1-3) — grid wobbling +/-ulp flips the atlas sample between
  // column 0 and column cols-1 per pixel: static-filled panes at far poses.
  vec2 grid = floor(vGrid.xy + 0.5);
  float rowCoherent = step(1.5, vCorrelationMode);
  float fracFloor = rowCoherent * (1.0 - step(2.5, vCorrelationMode)); // mode 2 exactly
  vec2 cellId = floor(cellF) + vec2(faceId * 7.0, faceId * 11.0 * (1.0 - rowCoherent));
  vec2 atlasCell = mod(cellId, grid);
  vec2 cellCentreUv = (atlasCell + 0.5) / grid;
  vec4 state = texture2D(uWindowAtlas, vAtlasOffset + cellCentreUv * vAtlasSize);
  bool isBand = state.a > 0.7 && state.a < 0.9;
  bool isTv = state.a > 0.2 && state.a < 0.7;
  float isCurtain = 0.0;
  if (rowCoherent > 0.5 && vGrid.z > 4.5 && isBand &&
      vSizeRolls.z < uCurtainShare) {
    isCurtain = 1.0;
  }

  // Correlated band cells share their timing: a whole-floor band uses one
  // clock for the row on EVERY face (jx = 0); fractional bands AND curtain
  // floors key per face, so each side wakes and cycles on its own. Per-window
  // cells keep per-cell timing via the column term.
  float faceClock = max(fracFloor, isCurtain);
  float jx = isBand ? faceId * 31.0 * faceClock : cellId.x;
  float seed = hash11(jx + cellId.y * 17.0 + cellSeed);

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
      brightness = 0.82 + 0.36 * hash11(cellId.x * 9.1 + cellId.y * 4.3 + cellSeed + 151.0);
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
  float wakeJitter = hash11(jx * 1.31 + cellId.y * 11.7 + cellSeed + 41.0);
  float onJitter = hash11(jx * 5.7 + cellId.y * 3.1 + cellSeed + 71.0);
  float offJitter = hash11(jx * 1.7 + cellId.y * 23.0 + cellSeed + 19.0);
  float t0 = clamp(baseline, 0.0, 1.0) * uIntroDuration +
             wakeJitter * min(uIntroDuration * 0.04, 4.0);
  float wakeTime = uIntroStartTime + t0;

  // Switch-bank stagger: a share (uStagger) of correlated floors light up in
  // 2..4 column banks, 0.6–1.6 s apart — banks of switches down the hall.
  if (isBand && hash11(cellId.y * 23.0 + cellSeed + 211.0) < uStagger) {
    float banks = 2.0 + floor(hash11(cellId.y * 3.3 + cellSeed + 61.0) * 2.999);
    float bank = floor(floor(cellF.x) / max(1.0, ceil(grid.x / banks)));
    if (hash11(cellId.y * 7.7 + cellSeed + 97.0) < 0.5) bank = banks - 1.0 - bank;
    wakeTime += bank * (0.6 + hash11(cellId.y * 5.1 + cellSeed + 23.0));
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
    float u1 = hash11(faceId * 3.7 + cellId.y * 13.1 + cellSeed + 101.0);
    float u2 = hash11(faceId * 9.3 + cellId.y * 5.7 + cellSeed + 137.0);
    float litCount = floor(pow(u1, 1.6) * (grid.x + 0.999));
    float start = floor(u2 * (grid.x - litCount + 1.0));
    if (col < start || col > start + litCount - 1.0) windowOn = 0.0;
  }

  return vec4(lit, windowOn);
}

// Analytic box-filtered pane coverage along one axis (#82, the zoomed-in
// "distressed" stipple): the EXACT mean of the pane/mullion square wave over
// this fragment's footprint, in closed form. F(x) = integral of the unit
// cell's pane indicator; coverage = (F(x1) - F(x0)) / footprint. Replaces the
// smoothstep edge pair + the sub-pixel feature guard on the hybrid path:
// those half-draw a 0.3-1px mullion (the guard only fully engages under
// 0.5px), and the half-drawn line beats against the pixel grid as per-pixel
// dither across every 3-7px-cell facade. The integral has no such band —
// sharp ~1-footprint edges when magnified, smooth monotonic fade to the pane
// fraction as features go sub-pixel.
//   x         continuous cell-space coordinate at the fragment
//   footprint cell-space width of one pixel (fwidth), AA-scaled
//   lo        pane start inside the unit cell (0.5 - halfPane)
//   paneW     pane width fraction (full-bleed 1.0 gives coverage 1 — the
//             phantom-mullion fade falls out for free)
float paneCoverage(float x, float footprint, float lo, float paneW) {
  float x0 = x - 0.5 * footprint;
  float x1 = x + 0.5 * footprint;
  float F0 = floor(x0) * paneW + clamp(fract(x0) - lo, 0.0, paneW);
  float F1 = floor(x1) * paneW + clamp(fract(x1) - lo, 0.0, paneW);
  return (F1 - F0) / max(footprint, 1e-5);
}

// Building-level wake ramp for the hybrid far field: per-cell windowOn used to
// carry the intro into the far wash; the mean-lit path needs an aggregate.
// Same baseline ordering as windowCellState, seed term replaced by its mean
// (0.5), ramping over ~20% of the cascade around the building's slot.
float buildingIntroOn() {
  float baseline = 0.5;
  if (uIntroMode == 1) {
    baseline = vDistrictIdx / 3.0;
  } else if (uIntroMode == 2) {
    vec2 d = vBuildingCenter.xz - uIntroCityCenter.xz;
    baseline = 1.0 - clamp(length(d) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
  } else if (uIntroMode == 3) {
    float farD = distance(vBuildingCenter, uIntroCamPos);
    baseline = 1.0 - clamp(farD / max(1.0, uIntroMaxRadius * 2.0), 0.0, 1.0);
  } else if (uIntroMode == 4) {
    vec2 d = vBuildingCenter.xz - uIntroCityCenter.xz;
    baseline = clamp(length(d) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
  }
  float wakeTime = uIntroStartTime + clamp(baseline, 0.0, 1.0) * uIntroDuration;
  return clamp((uTime - wakeTime) / max(uIntroDuration * 0.2, 1.0), 0.0, 1.0);
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
    topc *= highlightMul();
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
  // Ramp start 0.35 (~2.9px cells): the first cut started at 0.3 and the
  // partial tap-average dimmed/muddied mid-range windows (avgOn < 1 on floors
  // that read fully lit) — user 2026-07-03. Grazing churn lives at spans
  // ≥0.5, still fully covered.
  float lodAnisoX = smoothstep(0.35, 0.9, spanX) * (1.0 - uOrthoBlend);
  float lodAnisoY = smoothstep(0.35, 0.9, spanY) * (1.0 - uOrthoBlend);
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
  // Snapped like windowCellState's copies — see the notes there.
  float faceId = floor(vFaceId + 0.5);
  vec2 grid = floor(vGrid.xy + 0.5);
  vec2 cellId = floor(cell) + vec2(faceId * 7.0, faceId * 11.0 * (1.0 - rowCoherent));
  vec2 atlasCell = mod(cellId, grid);
  vec2 cellCentreUv = (atlasCell + 0.5) / grid;
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
  // panel's [min, max] ranges — rolled per-instance in the VERTEX shader (see
  // vSizeRolls), so every window on a building shares the size while
  // neighbours differ. Independent hashes decorrelate the two dimensions.
  // Deterministic (seeded hash, no time input).
  float wRoll = vSizeRolls.x;
  float hRoll = vSizeRolls.y;
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
      vSizeRolls.z < uCurtainShare) {
    isCurtain = 1.0;
    // 1 in 5 curtain towers goes FULL curtain — exact 1.0 — so true curtains
    // occur occasionally without touching the knobs (an rng roll alone never
    // lands exactly on 1.0). The rest take the crt-width knob.
    float fullRoll = vSizeRolls.w;
    fracW = fullRoll < 0.2 ? 1.0 : uCurtainWidth;
    fracH = mix(0.72, 0.92, vSeedRolls.x);
    // Corner piers: the outermost column on each face keeps a reduced pane,
    // terminating each face's ribbon at a visible structural pier instead of
    // letting the glass wrap the corner as one continuous window.
    float pierCol = floor(cell.x);
    if (pierCol < 0.5 || pierCol > grid.x - 1.5) fracW = min(fracW, 0.78);
  }
  float halfW = fracW * 0.5;
  float halfH = fracH * 0.5;
  float wMaskX;
  float wMaskY;
  if (uRenderMode > 0.5) {
    // HYBRID mask (#82 zoomed-in stipple, diagnosed 2026-07-03 at the user's
    // pose): exact box-filtered coverage of the pane pattern per axis — see
    // paneCoverage. The classic branch's smoothstep + feature guard dithers
    // wherever a mullion sits between 0.5 and 1.1px (3-7px cells, i.e. most
    // mid-range facades at a telephoto pose); the integral is dither-free at
    // every scale, needs no phantom-mullion fade and no guard, and converges
    // to fracW/fracH on its own as features go sub-pixel.
    float footX = max(spanX * uAaEdge, 1e-4);
    float footY = max(spanY * uAaEdge, 1e-4);
    wMaskX = paneCoverage(cell.x, footX, 0.5 - halfW, fracW);
    wMaskY = paneCoverage(cell.y, footY, 0.5 - halfH, fracH);
  } else {
    // CLASSIC mask — the pre-hybrid reference, byte-identical for A/B.
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
    wMaskX =
      smoothstep(0.5 - halfW - aaX, 0.5 - halfW + aaX, cellLocal.x) *
      (1.0 - smoothstep(0.5 + halfW - aaX, 0.5 + halfW + aaX, cellLocal.x));
    wMaskY =
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
    // Engage only when the feature genuinely cannot be drawn (<~1px). The first
    // cut used 1-2px and read as windows SWELLING to fill their tile while still
    // plainly visible ("doesn't look like windows anymore" — user 2026-07-03):
    // a 70%-wide window's gap crosses 2px while cells are still ~7px. Keeping
    // gaps crisp down to the last drawable pixel wins over early averaging.
    float featX = min(fracW, 1.0 - fracW) / max(spanX, 1e-4); // thinnest X feature in px
    float featY = min(fracH, 1.0 - fracH) / max(spanY, 1e-4);
    float maskLodX = max(lodAnisoX, 1.0 - smoothstep(0.5, 1.1, featX));
    float maskLodY = max(lodAnisoY, 1.0 - smoothstep(0.5, 1.1, featY));
    wMaskX = mix(wMaskX, fracW, maskLodX);
    wMaskY = mix(wMaskY, fracH, maskLodY);
  }
  float wMask = wMaskX * wMaskY;
  bool inWindow = wMask > 0.01;

  // Texture-layer debug views — see the uniform note. The field view follows
  // the render mode, matching the Window Lab convention: classic shows its
  // smoothstep mask as grayscale (its 3-7px-cell dither is visible here —
  // that WAS the #82 stipple), hybrid shows the analytic pane field it
  // box-filters, in the lab's Atlas+SDF palette (blue inside, white iso-line
  // at the pane edge). Toggling classic/hybrid in this view flips
  // gray <-> blue instantly — a one-look check that the toggle reaches the GPU.
  if (uWinDebugView > 1.5) {
    if (uRenderMode > 0.5) {
      vec2 dxy = abs(cellLocal - 0.5) - vec2(halfW, halfH);
      float dd = max(dxy.x, dxy.y); // signed box distance, cell units
      // Iso-line width: 0.05 cells up close (the lab-bench look), floored at
      // ~1.2px on screen — a fixed cell-space width goes sub-pixel at range
      // and dithers exactly like a sub-pixel mullion (user 2026-07-03,
      // spotted in this very view). Energy-conserving: when the floor widens
      // the line past its true size, dim by the ratio so distant grids read
      // as faint lattice, not noise.
      float lineW = max(0.05, fwidth(dd) * 1.2);
      float edge = (1.0 - smoothstep(0.0, lineW, abs(dd))) * (0.05 / lineW);
      vec3 c = dd < 0.0
        ? mix(vec3(0.85, 0.92, 1.0), vec3(0.15, 0.4, 0.9), clamp(-dd * 3.0, 0.0, 1.0))
        : vec3(0.12, 0.12, 0.14) * (1.0 - clamp(dd * 1.5, 0.0, 0.8));
      c = mix(c, vec3(1.0), edge);
      // Sub-pixel cells: NO unfiltered pattern survives minification — the
      // bright rim gradient dithers just like the iso-line did. Converge the
      // viz to its area average via the SAME box-filtered coverage the render
      // uses (wMask) — the debug view demonstrating its own cure.
      // Converge on whichever fires first: cell size (rim + line go sub-pixel
      // together) or the narrowest pattern feature in PIXELS — high pane
      // fractions leave a sub-pixel dark gap while cells are still 5-8px, and
      // that gap dithers exactly like a sub-pixel mullion.
      float sp = max(spanX, spanY);
      float narrowFeat = min(min(halfW, 0.5 - halfW), min(halfH, 0.5 - halfH)) * 2.0;
      float featPx = narrowFeat / max(sp, 1e-4);
      float vizLod = max(smoothstep(0.15, 0.4, sp), 1.0 - smoothstep(0.9, 1.8, featPx));
      vec3 filteredViz = mix(vec3(0.08, 0.08, 0.1), vec3(0.5, 0.66, 0.97), wMask);
      c = mix(c, filteredViz, vizLod);
      gl_FragColor = vec4(c, 1.0);
    } else {
      gl_FragColor = vec4(vec3(wMask), 1.0);
    }
    return;
  } else if (uWinDebugView > 0.5) {
    gl_FragColor = vec4(state.rgb, 1.0);
    return;
  }

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

      // Deep-graze statistics convergence (#82, the zoomed-in "distressed"
      // stipple): past ~1 cell/px on the compressed axis a 4-tap mean of
      // BINARY per-column states quantises to 5 levels, and the tap set
      // shifts per fragment — adjacent pixels jump ±0.25 coverage, which is
      // exactly the residual salt-and-pepper on grazing facades. The true
      // limit of the row average for per-window/TV cells is the building's
      // duty statistics (aMeanLit), which is analytic and noise-free —
      // converge there as columns pass sub-pixel. Band/curtain rows are
      // excluded: their state is row-coherent (already clean under the taps)
      // and their floor identity — lit ribbon vs dark floor — is real
      // structure the building mean would erase. Hybrid-gated so classic
      // stays the untouched pre-hybrid reference.
      if (uRenderMode > 0.5 && !isBand) {
        float deepStat = smoothstep(0.8, 2.2, max(spanX, spanY));
        lit = mix(lit, vMeanLit.rgb, deepStat);
        windowOn = mix(windowOn, vMeanLit.a * buildingIntroOn(), deepStat);
      }
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
    // Far (lod=1): per-cell sampling drops out.
    vec3 nearColor = mix(facade, lit, windowOn * wMask);
    vec3 farColor;
    if (uRenderMode > 0.5) {
      // HYBRID far field v2 (#82; "orange columns" 2026-07-03): the far wash
      // must not POINT-SAMPLE per-cell state (confetti), but a flat per-
      // building mean erases all fenestration structure. Sample the mipped
      // atlas twin at the CONTINUOUS cell coordinate instead: trilinear
      // minification returns the box-filtered average of exactly the cells
      // this pixel covers — the building's real lit pattern, softening with
      // distance, stable under motion because it averages instead of picking.
      // Unshifted coordinate (no per-face atlas shift): a shifted CONTINUOUS
      // uv would wrap mid-facade and linear filtering would blend the seam;
      // face desync is invisible at wash range anyway. Unlit cells carry
      // their dim-tungsten RGB in the atlas (see generateWindowTexture), so
      // the average includes what the near path actually draws for them.
      // Deep limit: cross to the per-building mean once the footprint
      // outgrows the low mips — also caps packed-atlas neighbour bleed,
      // which grows with mip level.
      vec2 farUv = vAtlasOffset + clamp(cell / grid, 0.0, 1.0) * vAtlasSize;
      vec3 farPattern = texture2D(uWindowAtlasFar, farUv).rgb * uEmissiveBoost;
      vec3 farLit = mix(farPattern, vMeanLit.rgb, smoothstep(4.0, 8.0, relSpan));
      float farOn = vMeanLit.a * fracW * fracH * uLightsOn * buildingIntroOn();
      farColor = mix(facade, farLit, farOn);
    } else {
      // CLASSIC: generic warm glow gated by per-cell windowOn (kept for A/B —
      // this is the pre-hybrid look, confetti and all).
      farColor = mix(facade, distantGlow, windowOn);
    }
    color = mix(nearColor, farColor, lod);
  }

  if (uDebugTint > 0.0001) color = mix(color, debugTintColor(), uDebugTint);
  color *= highlightMul();
  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;
