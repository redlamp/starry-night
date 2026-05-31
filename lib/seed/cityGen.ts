import seedrandom from "seedrandom";
import {
  generateTopology,
  CITY_CENTER,
  CITY_HALF_EXTENT,
  type Topology,
  type Highway,
} from "./topology";
import {
  generateDistricts,
  generateDistrictsFromNetwork,
  seamSegments,
  type District,
  type DistrictCharacter,
  type DistrictField,
  type SeamPolyline,
} from "./district";
import { buildSilhouette, isHighRise, type SilhouetteField } from "./silhouette";
import { generateArterials, type Arterial } from "./arterials";
import { stripGridFirst, gridFirst, computeLattice, type Lattice } from "./lattice";
import { generateStreetGrid, STREET_CONSTANTS, type RoadPoly } from "./streets";
import { generateTensorStreets } from "./tensorStreets";
import { subdivideCell, LOT_GRAMMAR } from "./lots";

// Any road tier, for the building-skip corridor test.
type RoadLike = { vertices: Array<{ x: number; z: number }>; width: number; closed: boolean };

export type Archetype =
  | "low-rise"
  | "warehouse"
  | "mid-rise"
  | "residential-tower"
  | "narrow-tower"
  | "office-block"
  | "spire";

// Stable ordering — the index used for the per-archetype window-fraction uniform
// arrays in the city shader (cityInstanced.ts) and the Windows settings panel.
export const ARCHETYPE_ORDER: Archetype[] = [
  "low-rise",
  "warehouse",
  "mid-rise",
  "residential-tower",
  "narrow-tower",
  "office-block",
  "spire",
];

export type Layer = "front" | "mid" | "back";

// Building-level lighting class. Kept to the original 4 values so the window
// shader (aDistrictIdx) + lightingGen mood logic stay unchanged. The richer
// 6-way planning identity lives on the District object; we map down to this.
export type BuildingLightingClass = "downtown" | "residential" | "industrial" | "oldtown";

export type Building = {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationY: number; // radians, around Y axis
  archetype: Archetype;
  layer: Layer;
  district: BuildingLightingClass;
  districtId: string; // stable id of the owning District
  coreProximity: number; // 0..1 — proximity to the nearest high-rise peak
  windowSeed: number;
  rowsPerFloor: number;
  colsPerFace: number;
  floors: number;
};

// A city block footprint (rotated rect) — exposed for the /plan street-grid
// overlay so blocks + their orientation are legible. Not used by the 3D scene.
export type PlanBlock = {
  cx: number;
  cz: number;
  w: number;
  d: number;
  rotationY: number;
  districtId: string;
  empty: boolean;
};

export type CityData = {
  buildings: Building[];
  districts: District[];
  topology: Topology;
  arterials: Arterial[];
  seams: SeamPolyline[];
  blocks: PlanBlock[];
  // Minor (local) streets — populated only on the streets-first (grid) path;
  // empty on the legacy path. The /plan overlay + streetlights draw these.
  streets: RoadPoly[];
};

// All in meters. See wiki/research/building-sizes-real-world-references.md.
// Per-archetype window grid pitch — metres of facade per window column / per
// floor. Drives colsPerFace / floors: towers get fine mullions, warehouses wide
// bays. Heritage districts apply AGE_PITCH_SCALE (denser, smaller windows). The
// glass-to-cell *fraction* is a live shader uniform, not baked here. See
// wiki/notes/decision-window-proportion-by-archetype.md.
const ARCHETYPE_PITCH: Record<Archetype, { col: number; floor: number }> = {
  spire: { col: 3.0, floor: 3.6 },
  "narrow-tower": { col: 3.0, floor: 3.4 },
  "office-block": { col: 3.4, floor: 3.6 },
  "residential-tower": { col: 3.6, floor: 3.0 },
  "mid-rise": { col: 3.8, floor: 3.1 },
  "low-rise": { col: 4.0, floor: 3.0 },
  warehouse: { col: 7.5, floor: 5.0 },
};
const AGE_PITCH_SCALE = 0.88; // Heritage / oldtown: denser, smaller windows.

// #7 road-facing window — front-row buildings (within ROAD_FACING_DIST of a
// highway / arterial edge) rotate to face the road, but only when the road's
// direction is within ROAD_FACING_ANGLE_TOL of the block grid's rotation.
// The tolerance preserves the stripe layout's depth-budget invariant: a
// near-perpendicular snap would push the rotated footprint into the next
// stripe and crash gate1's overlap test.
const ROAD_FACING_DIST = 35;
const ROAD_FACING_ANGLE_TOL = 0.7; // rad ≈ 40°

// Grid-first tuning — exposed live on /plan so the look can be dialled without
// editing source. DEFAULT_TUNING reproduces the baked behaviour exactly, so the
// 3D scene + gate1 (which pass no tuning) stay byte-identical. zoneSpread: each
// district draws one value and rotates ±spread/2 around the lattice base, so
// adjacent districts read as a patchwork of distinctly-angled grids (not one
// smooth warp). blockAspect multiplies the W:D block-elongation bands.
export type GridTuning = {
  zoneSpread: number; // per-district orientation spread (rad)
  driftDeg: number; // global centre→edge drift (deg)
  blockAspect: number; // multiplier on the block W:D elongation bands
  seamMaxCount: number; // max promoted seam avenues
  seamMinAngle: number; // min grid-clash angle to promote a seam (rad)
};
export const DEFAULT_TUNING: GridTuning = {
  zoneSpread: 0.5,
  driftDeg: 20,
  blockAspect: 1,
  seamMaxCount: 8,
  seamMinAngle: 0.2,
};

// Wrap an angle delta into [-π/2, π/2] so a building's two ends count as
// equivalent (a rectangle facing 10° and 190° are the same orientation).
function angleDeltaTau(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI / 2) d -= Math.PI;
  while (d < -Math.PI / 2) d += Math.PI;
  return d;
}

// Map the 6-way planning character to the 4-value building lighting class.
const LIGHTING_CLASS: Record<DistrictCharacter, BuildingLightingClass> = {
  downtown: "downtown",
  subcentre: "downtown",
  heritage: "oldtown",
  residential: "residential",
  industrial: "industrial",
  "mixed-use": "residential",
};

// Per-character block grammar + height ceiling multiplier (applied on top of the
// archetype's own height range). Drives both block size and how tall the
// district reads. PR 3 layers silhouette templates over this.
type CharacterGrammar = {
  blockW: number;
  blockD: number;
  streetW: number;
  streetD: number;
  blockJitter: number;
  emptyBlockProb: number;
  superBlockProb: number;
  twoStripeProb: number;
  heightCap: number;
};

const GRAMMAR: Record<DistrictCharacter, CharacterGrammar> = {
  downtown: {
    blockW: 55,
    blockD: 48,
    streetW: 14,
    streetD: 18,
    blockJitter: 0.15,
    emptyBlockProb: 0.03,
    superBlockProb: 0.05,
    twoStripeProb: 0.7,
    heightCap: 1.0,
  },
  subcentre: {
    blockW: 60,
    blockD: 50,
    streetW: 14,
    streetD: 18,
    blockJitter: 0.18,
    emptyBlockProb: 0.04,
    superBlockProb: 0.05,
    twoStripeProb: 0.65,
    heightCap: 0.8,
  },
  heritage: {
    blockW: 38,
    blockD: 32,
    streetW: 8,
    streetD: 10,
    blockJitter: 0.55,
    emptyBlockProb: 0.07,
    superBlockProb: 0.02,
    twoStripeProb: 0.35,
    heightCap: 0.55,
  },
  residential: {
    blockW: 82,
    blockD: 62,
    streetW: 12,
    streetD: 14,
    blockJitter: 0.24,
    emptyBlockProb: 0.05,
    superBlockProb: 0.05,
    twoStripeProb: 0.6,
    heightCap: 0.85,
  },
  industrial: {
    blockW: 115,
    blockD: 85,
    streetW: 18,
    streetD: 22,
    blockJitter: 0.13,
    emptyBlockProb: 0.1,
    superBlockProb: 0.08,
    twoStripeProb: 0.45,
    heightCap: 0.45,
  },
  "mixed-use": {
    blockW: 64,
    blockD: 52,
    streetW: 12,
    streetD: 16,
    blockJitter: 0.3,
    emptyBlockProb: 0.06,
    superBlockProb: 0.05,
    twoStripeProb: 0.55,
    heightCap: 0.7,
  },
};

// Grid-first block aspect (W:D) bands per character — real city blocks are
// elongated, not square (wiki/research/block-proportions.md). Grid-first derives
// blockD = blockW / sampled-aspect so the long axis runs with the street grid;
// the legacy path keeps the hard-coded grammar.blockD (flag-OFF byte-identical).
// Downtown ≈ Manhattan 2-2.5:1; residential / industrial ≈ 1.6-2:1.
const BLOCK_ASPECT: Record<DistrictCharacter, [number, number]> = {
  downtown: [2.0, 2.5],
  subcentre: [1.6, 2.0],
  heritage: [1.35, 1.6],
  residential: [1.6, 2.0],
  industrial: [1.6, 2.1],
  "mixed-use": [1.45, 1.8],
};

function pickArchetype(
  rng: () => number,
  character: DistrictCharacter,
  downtown: number,
): Archetype {
  const r = rng();
  if (character === "downtown" || character === "subcentre") {
    if (downtown > 0.7) {
      if (r < 0.32) return "spire";
      if (r < 0.65) return "narrow-tower";
      if (r < 0.85) return "office-block";
      if (r < 0.95) return "residential-tower";
      return "mid-rise";
    }
    if (downtown > 0.55 && r < 0.3) return "spire";
    if (r < 0.5) return "narrow-tower";
    if (r < 0.75) return "office-block";
    if (r < 0.9) return "residential-tower";
    return "mid-rise";
  }
  if (character === "residential" || character === "mixed-use") {
    if (r < 0.1) return "residential-tower";
    if (r < 0.45) return "mid-rise";
    if (r < 0.8) return "low-rise";
    return "warehouse";
  }
  if (character === "industrial") {
    if (r < 0.7) return "warehouse";
    if (r < 0.85) return "low-rise";
    if (r < 0.95) return "office-block";
    return "mid-rise";
  }
  // heritage
  if (r < 0.62) return "low-rise";
  if (r < 0.88) return "mid-rise";
  return "warehouse";
}

// Draw a footprint by (width, aspect=depth/width, height) instead of (w,d,h).
// Drives #24 footprint variety: aspect < 1 = wider-than-deep (along-street
// frontage), aspect > 1 = perpendicular slab. Three rng calls in the same
// slots as the old form so downstream rng draws stay deterministic.
function aspectDims(
  rng: () => number,
  wRange: [number, number],
  aspectRange: [number, number],
  hRange: [number, number],
) {
  const width = wRange[0] + rng() * (wRange[1] - wRange[0]);
  const aspect = aspectRange[0] + rng() * (aspectRange[1] - aspectRange[0]);
  const height = hRange[0] + rng() * (hRange[1] - hRange[0]);
  return { width, depth: width * aspect, height };
}

function dimensionsForArchetype(arch: Archetype, rng: () => number) {
  switch (arch) {
    case "spire":
      // Efficient core — keep ~square.
      return aspectDims(rng, [14, 28], [0.92, 1.0], [80, 220]);
    case "narrow-tower":
      // Small tower, square plan.
      return aspectDims(rng, [8, 14], [0.9, 1.0], [50, 80]);
    case "residential-tower":
      // Slab-style — wider frontage along street than depth.
      return aspectDims(rng, [16, 30], [0.5, 0.85], [24, 50]);
    case "office-block":
      // Big blocks, full mix of squat squares to long slabs.
      return aspectDims(rng, [22, 44], [0.45, 1.0], [30, 80]);
    case "mid-rise":
      // Varied — small shops to long row blocks.
      return aspectDims(rng, [14, 26], [0.45, 1.1], [12, 28]);
    case "warehouse":
      // Strip-mall style: long frontage along the street.
      return aspectDims(rng, [28, 60], [0.35, 0.7], [7, 14]);
    case "low-rise":
      // Small varied corner shops.
      return aspectDims(rng, [10, 20], [0.5, 1.0], [6, 10]);
  }
}

function layerForZ(z: number): Layer {
  if (z > 0) return "front";
  if (z > -120) return "mid";
  return "back";
}

// Global core-proximity field: 0..1 proximity to the nearest high-rise peak
// across every downtown/subcentre district. Drives lighting cross-pollination
// + archetype bias (spires cluster at peaks). Replaces the old single-ellipse
// downtownBias so polycentric cities get a height/lighting gradient around
// each cluster, not just the geometric centre.
function makeCoreProximity(silhouettes: SilhouetteField[]): (x: number, z: number) => number {
  if (silhouettes.length === 0) return () => 0;
  return (x: number, z: number) => {
    let best = 0;
    for (const s of silhouettes) {
      const p = s.proximity(x, z);
      if (p > best) best = p;
    }
    return best;
  };
}

function pointSegmentDistance(
  x: number,
  z: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(x - x1, z - z1);
  let t = ((x - x1) * dx + (z - z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz));
}

// True only if the building's whole rotated footprint sits inside its own
// district. Rejecting footprints that cross a district seam leaves a street-
// width gap between neighbouring districts, which is what prevents buildings
// from two Voronoi-adjacent districts overlapping at the shared boundary.
function footprintInDistrict(
  field: DistrictField,
  index: number,
  x: number,
  z: number,
  w: number,
  d: number,
  cosR: number,
  sinR: number,
): boolean {
  const hw = w / 2;
  const hd = d / 2;
  const corners: Array<[number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
  ];
  for (const [lx, lz] of corners) {
    const wx = x + lx * cosR - lz * sinR;
    const wz = z + lx * sinR + lz * cosR;
    if (field.classify(wx, wz) !== index) return false;
  }
  return true;
}

function onRoadCorridor(roads: RoadLike[], x: number, z: number): boolean {
  for (const r of roads) {
    const margin = r.width / 2 + 5;
    const verts = r.vertices;
    const last = r.closed ? verts.length : verts.length - 1;
    for (let i = 0; i < last; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      if (pointSegmentDistance(x, z, a.x, a.z, b.x, b.z) < margin) return true;
    }
  }
  return false;
}

// Nearest major-road segment direction (radians around Y) within maxEdgeDist
// metres of the point's distance-to-road-edge. Returns null if nothing close.
// Drives #7: buildings fronting a highway / arterial rotate to face it rather
// than the block grid.
function nearestMajorRoadAngle(
  roads: RoadLike[],
  x: number,
  z: number,
  maxEdgeDist: number,
): number | null {
  let bestEdgeDist = maxEdgeDist;
  let bestAngle: number | null = null;
  for (const r of roads) {
    const verts = r.vertices;
    const last = r.closed ? verts.length : verts.length - 1;
    const halfW = r.width / 2;
    for (let i = 0; i < last; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const d = pointSegmentDistance(x, z, a.x, a.z, b.x, b.z);
      const edge = d - halfW;
      if (edge < bestEdgeDist) {
        bestEdgeDist = edge;
        bestAngle = Math.atan2(b.z - a.z, b.x - a.x);
      }
    }
  }
  return bestAngle;
}

type Block = { cx: number; cz: number; w: number; d: number; empty: boolean; stripes: 1 | 2 };

// Lay a (slightly rotated) block grid across a district's bounding box.
function districtBlocks(
  rng: () => number,
  district: District,
  grammar: CharacterGrammar,
  rot: number,
  cityCx: number,
  cityCz: number,
  cityHalf: number,
  useGrid: boolean,
  blockAspect: number,
): Block[] {
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const w = district.maxX - district.minX;
  const d = district.maxZ - district.minZ;
  const colSpacing = grammar.blockW + grammar.streetW;
  // Grid-first elongates the block: hold the frontage width, shrink the depth to
  // a real W:D band so the long axis runs with the grid (no more near-squares).
  // Legacy keeps the square-ish grammar.blockD (flag-OFF byte-identical).
  const [aMin, aMax] = BLOCK_ASPECT[district.character];
  const blockD = useGrid
    ? grammar.blockW / ((aMin + rng() * (aMax - aMin)) * blockAspect)
    : grammar.blockD;
  const rowSpacing = blockD + grammar.streetD;
  // Cover the axis-aligned district bbox even when the grid is rotated. Grid-
  // first rotates to any angle (θ0 ± zone spread), where the old max(w,d)*1.15
  // undershoots the corners (a 45° grid needs √2≈1.41) and leaves empty wedges;
  // use the exact rotated half-span. Legacy keeps the cheap 1.15 factor.
  const hw = w / 2;
  const hd = d / 2;
  const cosA = Math.abs(cosR);
  const sinA = Math.abs(sinR);
  const span = useGrid
    ? 2 * Math.max(hw * cosA + hd * sinA, hw * sinA + hd * cosA) + colSpacing
    : Math.max(w, d) * 1.15;
  const cols = Math.max(1, Math.ceil(span / colSpacing));
  const rows = Math.max(1, Math.ceil(span / rowSpacing));
  const startX = -((cols - 1) * colSpacing) / 2;
  const startZ = -((rows - 1) * rowSpacing) / 2;
  const posJitter = 6 * grammar.blockJitter;
  const sizeJitterW = 0.4 * grammar.blockJitter;
  const sizeJitterD = 0.3 * grammar.blockJitter;

  const blocks: Block[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // Jitter block size downward only, so a block never exceeds its grid cell
      // (blockW × blockD) and thus can't spill into the neighbouring block's
      // street. Super-blocks are deferred to Stage 2's lot subdivision.
      const bw = grammar.blockW * (1 - sizeJitterW * rng());
      const bd = blockD * (1 - sizeJitterD * rng());
      const lx = startX + i * colSpacing + (rng() - 0.5) * posJitter;
      const lz = startZ + j * rowSpacing + (rng() - 0.5) * posJitter;
      // Rotate the local block centre around the district centroid into world space.
      const cx = district.centroidX + lx * cosR - lz * sinR;
      const cz = district.centroidZ + lx * sinR + lz * cosR;
      // Radial density falloff: blocks near the city edge are far more often
      // empty, so the periphery thins out and the dense core stands apart.
      const edgeFactor = Math.min(1, Math.hypot(cx - cityCx, cz - cityCz) / cityHalf);
      const emptyProb = Math.min(0.85, grammar.emptyBlockProb + Math.pow(edgeFactor, 1.6) * 0.55);
      blocks.push({
        cx,
        cz,
        w: bw,
        d: bd,
        empty: rng() < emptyProb,
        stripes: rng() < grammar.twoStripeProb ? 2 : 1,
      });
    }
  }
  return blocks;
}

function fillStripe(
  rng: () => number,
  startId: number,
  ctx: {
    district: District;
    character: DistrictCharacter;
    grammar: CharacterGrammar;
    field: DistrictField;
    rot: number;
    silhouette: SilhouetteField | null;
    coreProx: (x: number, z: number) => number;
    roads: RoadLike[];
  },
  blockCx: number,
  stripeCz: number,
  blockWidth: number,
  depthBudget: number,
): Building[] {
  const { district, character, grammar, field, rot, silhouette, coreProx, roads } = ctx;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const buildings: Building[] = [];
  const lightingClass = LIGHTING_CLASS[character];
  let id = startId;

  // Walk along the stripe in district-local x, transform each candidate to world.
  const halfBW = blockWidth / 2;
  let lx = -halfBW + rng() * 2;
  const endLx = halfBW;

  while (lx < endLx) {
    // Approx core proximity at the walk position, for archetype bias (spires
    // cluster near peaks).
    const dt = coreProx(blockCx + lx * cosR, stripeCz + lx * sinR);

    const archetype = pickArchetype(rng, character, dt);
    const dims = dimensionsForArchetype(archetype, rng);

    const wJ = 0.8 + rng() * 0.4;
    const dJ = 0.85 + rng() * 0.3;
    const hJ = 0.75 + rng() * 0.5;
    const outlierH = rng() < 0.06 ? (rng() < 0.5 ? 0.55 : 1.5) : 1.0;

    const width = Math.min(dims.width * wJ, blockWidth * 0.95);
    if (lx + width > endLx) break;

    // Clamp depth to the stripe's budget so a building can't reach across the
    // street into the next row's stripe.
    const depth = Math.min(dims.depth * dJ, depthBudget);

    const lzJitter = (rng() - 0.5) * 1.5;

    // #7: probe the road network at the tentative slot centre. Snap rotation to
    // the road only if (a) the road is within ROAD_FACING_DIST, (b) the
    // direction is within ROAD_FACING_ANGLE_TOL of the block grain, and (c)
    // the rotated footprint still fits the stripe's perpendicular budget.
    const tentLxCenter = lx + width / 2;
    const tentWorldX = blockCx + tentLxCenter * cosR - lzJitter * sinR;
    const tentWorldZ = stripeCz + tentLxCenter * sinR + lzJitter * cosR;
    const facingAngle = nearestMajorRoadAngle(roads, tentWorldX, tentWorldZ, ROAD_FACING_DIST);
    const rotDelta = facingAngle !== null ? angleDeltaTau(facingAngle, rot) : 0;
    const cosDA = Math.cos(rotDelta);
    const sinDA = Math.sin(rotDelta);
    const perpStripe = Math.abs(width * sinDA) + Math.abs(depth * cosDA);
    const useFacing =
      facingAngle !== null &&
      Math.abs(rotDelta) < ROAD_FACING_ANGLE_TOL &&
      perpStripe <= depthBudget;
    const rotY = useFacing ? (facingAngle as number) : rot;
    const rcosR = useFacing ? Math.cos(rotY) : cosR;
    const rsinR = useFacing ? Math.sin(rotY) : sinR;

    // Stride along the stripe = rotated footprint's projection on stripe-x.
    // alongStripe ≥ width when |cosDA|<1, so successive buildings can't clip.
    const alongStripe = useFacing ? Math.abs(width * cosDA) + Math.abs(depth * sinDA) : width;
    const lxCenter = useFacing ? lx + alongStripe / 2 : tentLxCenter;
    if (useFacing && lxCenter + alongStripe / 2 > endLx) break;

    const worldX = useFacing ? blockCx + lxCenter * cosR - lzJitter * sinR : tentWorldX;
    const worldZ = useFacing ? stripeCz + lxCenter * sinR + lzJitter * cosR : tentWorldZ;

    lx += alongStripe + 0.5 + rng() * 1.5;

    // Containment: the building's whole footprint must lie inside this district
    // and clear of every highway corridor. Footprint-level (not just centre)
    // containment carves street gaps at district seams → no cross-district
    // overlap.
    if (!footprintInDistrict(field, district.index, worldX, worldZ, width, depth, rcosR, rsinR))
      continue;
    if (onRoadCorridor(roads, worldX, worldZ)) continue;

    const prox = coreProx(worldX, worldZ);
    // Silhouette template shapes the high-rise skyline; non-high-rise districts
    // have no field (multiplier = 1) and keep their flat per-character cap.
    const hm = silhouette ? silhouette.multiplier(worldX, worldZ) : 1;
    const height = dims.height * grammar.heightCap * hm * hJ * outlierH;

    const pitch = ARCHETYPE_PITCH[archetype];
    const ageScale = lightingClass === "oldtown" ? AGE_PITCH_SCALE : 1;
    const colJitter = 1 + (rng() - 0.5) * 0.16;
    const floorJitter = 1 + (rng() - 0.5) * 0.16;
    const floors = Math.max(2, Math.round(height / (pitch.floor * ageScale * floorJitter)));
    const colsPerFace = Math.max(3, Math.round(width / (pitch.col * ageScale * colJitter)));

    buildings.push({
      id: id++,
      x: worldX,
      z: worldZ,
      width,
      depth,
      height,
      rotationY: rotY,
      archetype,
      layer: layerForZ(worldZ),
      district: lightingClass,
      districtId: district.id,
      coreProximity: prox,
      windowSeed: rng(),
      rowsPerFloor: 1,
      colsPerFace,
      floors,
    });
  }

  return buildings;
}

// Per-district grid orientation (radians). Precomputed so seam tiering can
// compare neighbours' grain. Each value is the FIRST draw of that district's
// own `::layout::` stream — exactly what the building loop re-derives — so the
// two never diverge and flag-OFF stays byte-identical.
function districtOrientations(
  masterSeed: string,
  field: DistrictField,
  useGrid: boolean,
  lattice: Lattice | null,
  zoneSpread: number,
): Map<number, number> {
  const rot = new Map<number, number>();
  for (const d of field.districts) {
    const rj = seedrandom(`${masterSeed}::layout::${d.id}`)();
    const rotSpread = d.character === "heritage" ? 0.5 : 0.18;
    rot.set(
      d.index,
      useGrid && lattice
        ? lattice.orientationAt(d.centroidX, d.centroidZ) + (rj - 0.5) * zoneSpread
        : (rj - 0.5) * rotSpread,
    );
  }
  return rot;
}

// Remove ring-radial spoke highways (id `highway-radial-*`), leaving the
// ring / crossroads / bypass. The streets-first path uses this so no road ever
// radiates from the centre — the spider-web the user banned.
export function dropRadialSpokes(topo: Topology): Topology {
  if (!topo.highways.some((h) => h.id.startsWith("highway-radial"))) return topo;
  return { ...topo, highways: topo.highways.filter((h) => !h.id.startsWith("highway-radial")) };
}

function roadLength(r: { vertices: Array<{ x: number; z: number }> }): number {
  let len = 0;
  for (let i = 1; i < r.vertices.length; i++) {
    len += Math.hypot(r.vertices[i].x - r.vertices[i - 1].x, r.vertices[i].z - r.vertices[i - 1].z);
  }
  return len;
}

// Total absolute turning angle along a polyline — a ring/circle accumulates a
// large turn; a straight road ≈ 0.
function totalTurn(r: { vertices: Array<{ x: number; z: number }> }): number {
  const v = r.vertices;
  let t = 0;
  for (let i = 2; i < v.length; i++) {
    let d =
      Math.atan2(v[i].z - v[i - 1].z, v[i].x - v[i - 1].x) -
      Math.atan2(v[i - 1].z - v[i - 2].z, v[i - 1].x - v[i - 2].x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    t += d;
  }
  return Math.abs(t);
}

const RING_TURN = (200 * Math.PI) / 180; // ≥ ~200° of turning reads as circular

// Shared tensor road build (used by both the city + streetlight tensor paths so
// they agree). Ring-like arterials are demoted to minor STREETS (a circular road
// should be a street, never an arterial/highway). The highway is the longest,
// largely-straight arterial that spans the map; the old random-tilt topology
// highways are dropped (out of place against the tensor flow). Districts still
// use the raw topology for their macro regions (the character overlay).
function buildTensorRoadsImpl(masterSeed: string) {
  const rawTopo = dropRadialSpokes(generateTopology(masterSeed));
  // The tensor streamlines only need the city extent — districts are derived
  // FROM the finished network below, not the other way round.
  const bounds = {
    minX: rawTopo.centerX - rawTopo.halfExtent,
    maxX: rawTopo.centerX + rawTopo.halfExtent,
    minZ: rawTopo.centerZ - rawTopo.halfExtent,
    maxZ: rawTopo.centerZ + rawTopo.halfExtent,
  };
  const gen = generateTensorStreets(masterSeed, bounds);

  const ringArts = gen.arterials.filter((a) => totalTurn(a) >= RING_TURN);
  const arterials = gen.arterials.filter((a) => totalTurn(a) < RING_TURN);
  const minorStreets: RoadPoly[] = [
    ...gen.minorStreets,
    ...ringArts.map((r, i) => ({ ...r, id: `minor-ring-${i}`, width: 9, tier: "minor" as const })),
  ];

  let highways: Highway[] = [];
  let outArterials = arterials;
  let best: RoadPoly | null = null;
  let bestScore = 0;
  for (const a of arterials) {
    const score = roadLength(a) - 250 * totalTurn(a); // long + straight wins
    if (roadLength(a) > 700 && score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  if (best) {
    const hwId = best.id;
    highways = [
      { id: "highway-0", closed: false, vertices: best.vertices, width: 28, tier: "highway" },
    ];
    outArterials = arterials.filter((a) => a.id !== hwId);
  }

  const topology: Topology = { ...rawTopo, highways };
  // Districts follow the road network: arterials + the highway are HARD WALLS,
  // minor streets stay passable, so each district is an arterial-bounded region
  // spanning several street blocks (replaces the free-floating Voronoi).
  const walls: RoadLike[] = [...highways, ...outArterials];
  const field = generateDistrictsFromNetwork(masterSeed, walls, rawTopo);
  return { topology, field, arterials: outArterials, minorStreets };
}

// buildTensorRoads is consumed by the city, the streetlights, and the three
// district overlays (/plan, scene shells, settings list) — all per seed. Cache
// so the tensor field + the flood-fill districting run once per seed, and every
// consumer agrees on the same districts the buildings were placed against.
const tensorRoadsCache = new Map<string, ReturnType<typeof buildTensorRoadsImpl>>();
function buildTensorRoads(masterSeed: string) {
  const hit = tensorRoadsCache.get(masterSeed);
  if (hit) return hit;
  const result = buildTensorRoadsImpl(masterSeed);
  if (tensorRoadsCache.size > 64) tensorRoadsCache.clear();
  tensorRoadsCache.set(masterSeed, result);
  return result;
}

// The tensor city's district field, exposed so the /plan + scene overlays draw
// the SAME districts the buildings were derived from (no separate Voronoi pass).
export function tensorDistrictField(rawSeed: string): DistrictField {
  return buildTensorRoads(stripGridFirst(rawSeed)).field;
}

// --- Tensor building fill -------------------------------------------------
// Stage 1 had roads only; this fills the inter-road space with road-facing
// buildings so block scale is judgeable. A spatial road index keeps the
// per-candidate road query O(1); footprints clear every road by their half
// diagonal and reject on OBB overlap, so the result is gate1-safe (no road
// corridor hits, no overlaps). Building dims/height/windows reuse the unchanged
// archetype logic. Explicit block + lot polygons are the next refinement.

type Seg = { ax: number; az: number; bx: number; bz: number; hw: number };

class RoadIndex {
  private cells = new Map<string, Seg[]>();
  private cell = 40;
  constructor(roads: RoadLike[]) {
    for (const r of roads) {
      const v = r.vertices;
      const last = r.closed ? v.length : v.length - 1;
      const hw = r.width / 2;
      for (let i = 0; i < last; i++) {
        const a = v[i];
        const b = v[(i + 1) % v.length];
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        const k = `${Math.floor(mx / this.cell)},${Math.floor(mz / this.cell)}`;
        const seg: Seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z, hw };
        const l = this.cells.get(k);
        if (l) l.push(seg);
        else this.cells.set(k, [seg]);
      }
    }
  }
  // Distance from (x,z) to the nearest road EDGE + that segment's direction.
  query(x: number, z: number): { edge: number; ang: number } {
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    let edge = Infinity;
    let ang = 0;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const l = this.cells.get(`${i},${j}`);
        if (!l) continue;
        for (const s of l) {
          const d = pointSegmentDistance(x, z, s.ax, s.az, s.bx, s.bz) - s.hw;
          if (d < edge) {
            edge = d;
            ang = Math.atan2(s.bz - s.az, s.bx - s.ax);
          }
        }
      }
    }
    return { edge, ang };
  }
}

type Footprint = { x: number; z: number; width: number; depth: number; rotationY: number };

function obbCorners(b: Footprint): Array<[number, number]> {
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const o: Array<[number, number]> = [
    [hw, hd],
    [hw, -hd],
    [-hw, hd],
    [-hw, -hd],
  ];
  return o.map(([lx, lz]) => [b.x + lx * c - lz * s, b.z + lx * s + lz * c] as [number, number]);
}

// SAT: true if the two footprints are NOT separated by at least `minGap`.
function tooClose(a: Footprint, b: Footprint, minGap: number): boolean {
  const ca = Math.cos(a.rotationY);
  const sa = Math.sin(a.rotationY);
  const cb = Math.cos(b.rotationY);
  const sb = Math.sin(b.rotationY);
  const axes: Array<[number, number]> = [
    [ca, sa],
    [-sa, ca],
    [cb, sb],
    [-sb, cb],
  ];
  const cornersA = obbCorners(a);
  const cornersB = obbCorners(b);
  for (const [ax, az] of axes) {
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const [x, z] of cornersA) {
      const p = x * ax + z * az;
      if (p < amin) amin = p;
      if (p > amax) amax = p;
    }
    for (const [x, z] of cornersB) {
      const p = x * ax + z * az;
      if (p < bmin) bmin = p;
      if (p > bmax) bmax = p;
    }
    const overlap = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (overlap <= -minGap) return false; // separated by ≥ minGap on this axis
  }
  return true;
}

// Buildings LINE the streets: walk each street + arterial on both sides and lay
// a tight row of road-facing buildings, set back just off the kerb. Highways get
// no direct frontage (a real freeway has a buffer). Block interiors are left
// open — every building fronts a street, none float. Footprint corners are
// checked against the whole road network (gate1 corridor-safe) and against
// already-placed buildings (gate1 overlap-safe). All dims/height/window logic is
// the unchanged archetype code.
function fillTensorBuildings(
  masterSeed: string,
  field: DistrictField,
  roads: RoadLike[],
): Building[] {
  const rng = seedrandom(`${masterSeed}::tensor::buildings`);
  const silhouetteByIndex = new Map<number, SilhouetteField>();
  for (const d of field.districts) {
    if (isHighRise(d.character)) silhouetteByIndex.set(d.index, buildSilhouette(masterSeed, d));
  }
  const coreProx = makeCoreProximity([...silhouetteByIndex.values()]);
  const roadIndex = new RoadIndex(roads);

  const buildings: Building[] = [];
  const bIndex = new Map<string, Footprint[]>();
  const BCELL = 70; // ≥ max building span, so the 3×3 overlap query never misses a neighbour
  const GAP = 2; // metres between neighbouring buildings in a row
  let id = 0;

  const cornerOnRoad = (f: Footprint): boolean => {
    for (const [cxp, czp] of obbCorners(f)) {
      if (roadIndex.query(cxp, czp).edge < 1) return true; // a corner sits in a road corridor
    }
    return false;
  };
  const overlapsPlaced = (f: Footprint): boolean => {
    const ci = Math.floor(f.x / BCELL);
    const cj = Math.floor(f.z / BCELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const l = bIndex.get(`${i},${j}`);
        if (!l) continue;
        for (const o of l) if (tooClose(f, o, 1)) return true;
      }
    }
    return false;
  };

  // Streets (9) + arterials (16) get frontage; highways (28) do not.
  const frontageRoads = roads.filter((r) => r.width <= 16);

  for (const r of frontageRoads) {
    const v = r.vertices;
    const hw = r.width / 2;
    for (const side of [1, -1] as const) {
      let i = 1 + Math.floor(rng() * 3); // small per-side start offset
      while (i < v.length) {
        const a = v[i - 1];
        const b = v[i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const sl = Math.hypot(dx, dz);
        if (sl < 1e-6) {
          i += 1;
          continue;
        }
        const ux = dx / sl;
        const uz = dz / sl;
        const nx = -uz;
        const nz = ux;

        // Sample character just off the kerb on this side.
        const sx = b.x + nx * side * (hw + 6);
        const sz = b.z + nz * side * (hw + 6);
        const idx = field.classify(sx, sz);
        if (idx < 0) {
          i += 3;
          continue;
        }
        const district = field.districts[idx];
        const character = district.character;
        const grammar = GRAMMAR[character];
        const prox = coreProx(sx, sz);
        const archetype = pickArchetype(rng, character, prox);
        const dims = dimensionsForArchetype(archetype, rng);
        const hJ = 0.78 + rng() * 0.44;
        const outlierH = rng() < 0.06 ? (rng() < 0.5 ? 0.6 : 1.5) : 1.0;

        const setback = character === "downtown" || character === "subcentre" ? 1.5 : 3;
        const off = hw + setback + dims.depth / 2;
        const cx = b.x + nx * side * off;
        const cz = b.z + nz * side * off;
        const rotationY = Math.atan2(uz, ux); // width runs along the road, depth fronts it
        const f: Footprint = { x: cx, z: cz, width: dims.width, depth: dims.depth, rotationY };

        // Advance along the road by this building's footprint + gap (≈ 4 m / vertex).
        const advance = Math.max(2, Math.round((dims.width + GAP) / 4));

        // Centre must clear EVERY road (not just corners) — catches a long
        // building straddling a perpendicular street between its corners.
        const centreClear = roadIndex.query(cx, cz).edge >= 0.5;
        if (field.classify(cx, cz) >= 0 && centreClear && !cornerOnRoad(f) && !overlapsPlaced(f)) {
          const lightingClass = LIGHTING_CLASS[character];
          const sil = isHighRise(character) ? (silhouetteByIndex.get(idx) ?? null) : null;
          const hm = sil ? sil.multiplier(cx, cz) : 1;
          const height = dims.height * grammar.heightCap * hm * hJ * outlierH;
          const pitch = ARCHETYPE_PITCH[archetype];
          const ageScale = lightingClass === "oldtown" ? AGE_PITCH_SCALE : 1;
          const colJitter = 1 + (rng() - 0.5) * 0.16;
          const floorJitter = 1 + (rng() - 0.5) * 0.16;
          const floors = Math.max(2, Math.round(height / (pitch.floor * ageScale * floorJitter)));
          const colsPerFace = Math.max(
            3,
            Math.round(dims.width / (pitch.col * ageScale * colJitter)),
          );
          buildings.push({
            id: id++,
            x: cx,
            z: cz,
            width: dims.width,
            depth: dims.depth,
            height,
            rotationY,
            archetype,
            layer: layerForZ(cz),
            district: lightingClass,
            districtId: district.id,
            coreProximity: prox,
            windowSeed: rng(),
            rowsPerFloor: 1,
            colsPerFace,
            floors,
          });
          const k = `${Math.floor(cx / BCELL)},${Math.floor(cz / BCELL)}`;
          const l = bIndex.get(k);
          if (l) l.push(f);
          else bIndex.set(k, [f]);
        }
        i += advance;
      }
    }
  }
  return buildings;
}

// Tensor-field generator: streets follow the tensor field; buildings line the
// streets. This is the DEFAULT city generator.
function generateCityTensor(masterSeed: string): CityData {
  const { topology, field, arterials, minorStreets } = buildTensorRoads(masterSeed);
  const roads: RoadLike[] = [...topology.highways, ...arterials, ...minorStreets];
  const buildings = fillTensorBuildings(masterSeed, field, roads);
  return {
    buildings,
    districts: field.districts,
    topology,
    arterials,
    seams: [],
    blocks: [],
    streets: minorStreets,
  };
}

// ---------------------------------------------------------------------------
// Streets-first generator (the rebuild). Geometry flows STREET GRAPH → BLOCKS
// (cells of the graph) → LOTS (subdivision) → BUILDINGS (one per lot, set back
// from the street, aligned to the single grid orientation θ0). Districts are a
// CHARACTER OVERLAY only — they pick height/archetype/lighting/spacing, never
// geometry or rotation. This is what replaces the old district-bbox block array
// (the spider-web). Building dimensions, archetypes, silhouette height field and
// the window grid are reused unchanged, so the Building contract the renderer +
// window shader consume is identical.
function generateCityGridFirst(masterSeed: string): CityData {
  // Axis-aligned grid (no random rotation) — up/down/left/right. Interim until
  // the tensor-field generator lands; theta0 stays a parameter on the grid so
  // that swap is localised.
  const theta0 = 0;
  // Drop the banned radial spokes (ring-radial highways) — the streets-first
  // grid is the only road structure and it radiates nothing. Keep ring /
  // crossroads / bypass highways (they cut across the grid like a real freeway).
  const topology = dropRadialSpokes(generateTopology(masterSeed));
  // L∞ districts in the θ0 frame: used ONLY as the character overlay + silhouette
  // anchor + colours now (no geometry ownership, no per-district rotation).
  const field = generateDistricts(masterSeed, topology, true, theta0);

  // Silhouette field per high-rise district + global core-proximity (unchanged).
  const silhouetteByIndex = new Map<number, SilhouetteField>();
  for (const d of field.districts) {
    if (isHighRise(d.character)) silhouetteByIndex.set(d.index, buildSilhouette(masterSeed, d));
  }
  const coreProx = makeCoreProximity([...silhouetteByIndex.values()]);

  // The single geometry authority.
  const grid = generateStreetGrid(masterSeed, field, theta0);

  const cos = Math.cos(theta0);
  const sin = Math.sin(theta0);
  const ccx = CITY_CENTER.x;
  const ccz = CITY_CENTER.z;
  const half = CITY_HALF_EXTENT;
  const toWorld = (u: number, v: number) => ({
    x: ccx + u * cos - v * sin,
    z: ccz + u * sin + v * cos,
  });
  const { ARTERIAL_WIDTH, MINOR_WIDTH } = STREET_CONSTANTS;

  const buildings: Building[] = [];
  const planBlocks: PlanBlock[] = [];
  let nextId = 0;

  for (const cell of grid.cells) {
    const district = field.districts[cell.districtIndex];
    if (!district) continue;
    const character = cell.character;
    const grammar = GRAMMAR[character];
    const lotOpts = LOT_GRAMMAR[character];
    const districtId = district.id;
    // One stable RNG per block, keyed by the cell's grid coordinates (never an
    // array index that could reorder) — deterministic + independent of every
    // other block's draw order.
    const rng = seedrandom(`${masterSeed}::block::${cell.id}`);

    // Per-edge road inset: arterial edges set back by the arterial half-width,
    // minor edges by the minor half-width, + a 1m sidewalk. The footprint then
    // sits strictly clear of every road corridor (gate1 corridor test).
    const insU0 = (cell.artU0 ? ARTERIAL_WIDTH : MINOR_WIDTH) / 2 + 1;
    const insU1 = (cell.artU1 ? ARTERIAL_WIDTH : MINOR_WIDTH) / 2 + 1;
    const insV0 = (cell.artV0 ? ARTERIAL_WIDTH : MINOR_WIDTH) / 2 + 1;
    const insV1 = (cell.artV1 ? ARTERIAL_WIDTH : MINOR_WIDTH) / 2 + 1;
    const buildable = {
      u0: cell.u0 + insU0,
      v0: cell.v0 + insV0,
      u1: cell.u1 - insU1,
      v1: cell.v1 - insV1,
    };
    const bw = buildable.u1 - buildable.u0;
    const bd = buildable.v1 - buildable.v0;
    const bc = toWorld((buildable.u0 + buildable.u1) / 2, (buildable.v0 + buildable.v1) / 2);
    if (bw < 6 || bd < 6) {
      planBlocks.push({
        cx: bc.x,
        cz: bc.z,
        w: Math.max(0, bw),
        d: Math.max(0, bd),
        rotationY: theta0,
        districtId,
        empty: true,
      });
      continue;
    }

    // Radial density falloff: blocks near the city edge thin out.
    const edgeFactor = Math.min(1, Math.hypot(bc.x - ccx, bc.z - ccz) / half);
    const emptyProb = Math.min(0.8, grammar.emptyBlockProb + Math.pow(edgeFactor, 1.7) * 0.5);

    const lots = subdivideCell(rng, buildable, lotOpts);
    let placedAny = false;

    for (const lot of lots) {
      const lotW = lot.u1 - lot.u0;
      const lotD = lot.v1 - lot.v0;
      if (rng() < emptyProb) continue; // dark / vacant lot

      // Setback inside the lot — tighter downtown, looser in the suburbs.
      const setback = character === "downtown" || character === "subcentre" ? 1.2 : 2.2;
      const maxW = lotW - 2 * setback;
      const maxD = lotD - 2 * setback;
      if (maxW < 5 || maxD < 5) continue;

      const world = toWorld((lot.u0 + lot.u1) / 2, (lot.v0 + lot.v1) / 2);
      const prox = coreProx(world.x, world.z);
      const archetype = pickArchetype(rng, character, prox);
      const dims = dimensionsForArchetype(archetype, rng);
      const isTower =
        archetype === "spire" || archetype === "narrow-tower" || archetype === "residential-tower";

      // Towers stay slender (archetype width); everything else fills its lot so
      // blocks read dense rather than dotted. Always clamp inside the lot.
      let width = Math.min(dims.width, maxW);
      let depth = Math.min(dims.depth, maxD);
      if (!isTower) {
        width = Math.min(maxW, Math.max(width, maxW * 0.82));
        depth = Math.min(maxD, Math.max(depth, maxD * 0.82));
      }
      if (width < 5 || depth < 5) continue;

      const hJ = 0.78 + rng() * 0.44;
      const outlierH = rng() < 0.06 ? (rng() < 0.5 ? 0.6 : 1.5) : 1.0;

      // Highways (kept) are the only roads not already cleared by the inset.
      if (onRoadCorridor(topology.highways, world.x, world.z)) continue;

      const lightingClass = LIGHTING_CLASS[character];
      const sil = isHighRise(character)
        ? (silhouetteByIndex.get(cell.districtIndex) ?? null)
        : null;
      const hm = sil ? sil.multiplier(world.x, world.z) : 1;
      const height = dims.height * grammar.heightCap * hm * hJ * outlierH;

      const pitch = ARCHETYPE_PITCH[archetype];
      const ageScale = lightingClass === "oldtown" ? AGE_PITCH_SCALE : 1;
      const colJitter = 1 + (rng() - 0.5) * 0.16;
      const floorJitter = 1 + (rng() - 0.5) * 0.16;
      const floors = Math.max(2, Math.round(height / (pitch.floor * ageScale * floorJitter)));
      const colsPerFace = Math.max(3, Math.round(width / (pitch.col * ageScale * colJitter)));

      buildings.push({
        id: nextId++,
        x: world.x,
        z: world.z,
        width,
        depth,
        height,
        rotationY: theta0, // flush to the grid → flush to the bounding streets
        archetype,
        layer: layerForZ(world.z),
        district: lightingClass,
        districtId,
        coreProximity: prox,
        windowSeed: rng(),
        rowsPerFloor: 1,
        colsPerFace,
        floors,
      });
      placedAny = true;
    }

    planBlocks.push({
      cx: bc.x,
      cz: bc.z,
      w: bw,
      d: bd,
      rotationY: theta0,
      districtId,
      empty: !placedAny,
    });
  }

  return {
    buildings,
    districts: field.districts,
    topology,
    arterials: grid.arterials,
    seams: [],
    blocks: planBlocks,
    streets: grid.streets,
  };
}

// generateCity / generateStreetlights are pure functions of the seed, but the
// 3D scene renders ~5 components off the same seed — memoise (bounded) so the
// tensor field is traced once per seed, not once per component.
const cityCache = new Map<string, CityData>();
const lightsCache = new Map<string, Streetlight[]>();

export function generateCity(rawSeed: string, tuning: GridTuning = DEFAULT_TUNING): CityData {
  const hit = cityCache.get(rawSeed);
  if (hit) return hit;
  const result = generateCityImpl(rawSeed, tuning);
  if (cityCache.size > 64) cityCache.clear();
  cityCache.set(rawSeed, result);
  return result;
}

function generateCityImpl(rawSeed: string, tuning: GridTuning = DEFAULT_TUNING): CityData {
  // Strip the grid-first flag sentinel before any RNG key is derived (Stage 0).
  const masterSeed = stripGridFirst(rawSeed);
  // Tensor-field roads are the DEFAULT (and only intended) city model now. A
  // ::gridfirst seed still routes to the dormant grid path for A/B comparison;
  // the legacy radial body below is unreachable and slated for removal.
  if (!gridFirst(rawSeed)) return generateCityTensor(masterSeed);
  const useGrid = gridFirst(rawSeed);
  if (useGrid) return generateCityGridFirst(masterSeed);
  // Compute the lattice once when grid-first is on; reused for both the district
  // metric frame (θ0) and the per-district grid grain (orientationAt, Stage 2).
  const lattice = useGrid ? computeLattice(masterSeed, tuning.driftDeg) : null;
  const theta0 = lattice ? lattice.theta0 : 0;
  const topology = generateTopology(masterSeed);
  const field = generateDistricts(masterSeed, topology, useGrid, theta0);

  // Silhouette field per high-rise district + global core-proximity from all peaks.
  const silhouetteByIndex = new Map<number, SilhouetteField>();
  for (const d of field.districts) {
    if (isHighRise(d.character)) silhouetteByIndex.set(d.index, buildSilhouette(masterSeed, d));
  }
  const coreProx = makeCoreProximity([...silhouetteByIndex.values()]);

  const arterials = generateArterials(masterSeed, topology, field, useGrid, theta0);
  // Tiered seam streets (grid-first only): the major district boundaries promoted
  // to avenues. Buildings skip every road tier so they read as open avenues.
  const districtRot = districtOrientations(masterSeed, field, useGrid, lattice, tuning.zoneSpread);
  const seams: SeamPolyline[] = useGrid
    ? seamSegments(field, districtRot, tuning.seamMaxCount, tuning.seamMinAngle)
    : [];
  const roads: RoadLike[] = [...topology.highways, ...arterials, ...seams];

  const buildings: Building[] = [];
  const planBlocks: PlanBlock[] = [];
  let nextId = 0;

  for (const district of field.districts) {
    const grammar = GRAMMAR[district.character];
    const districtRng = seedrandom(`${masterSeed}::layout::${district.id}`);
    // Grain orientation is precomputed in districtRot (so seam tiering can
    // compare neighbours). Advance this stream by the SAME single draw the
    // precompute consumed, so every downstream draw (archetype, dims,
    // windowSeed) stays byte-identical — proven by the gate1 building-count
    // assert. The legacy path's grain lives in districtRot too.
    districtRng();
    const rot = districtRot.get(district.index) ?? 0;
    const ctx = {
      district,
      character: district.character,
      grammar,
      field,
      rot,
      silhouette: silhouetteByIndex.get(district.index) ?? null,
      coreProx,
      roads,
    };
    const blocks = districtBlocks(
      districtRng,
      district,
      grammar,
      rot,
      topology.centerX,
      topology.centerZ,
      topology.halfExtent,
      useGrid,
      tuning.blockAspect,
    );

    for (const b of blocks) {
      planBlocks.push({
        cx: b.cx,
        cz: b.cz,
        w: b.w,
        d: b.d,
        rotationY: rot,
        districtId: district.id,
        empty: b.empty,
      });
    }

    for (const b of blocks) {
      if (b.empty) continue;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      if (b.stripes === 2) {
        // Two stripes sit at ±blockD/4; each gets a depth budget of half the
        // block (minus a 2m margin) so the two rows of buildings + the gap
        // between them all fit inside the block.
        const budget = Math.max(6, b.d / 2 - 2);
        for (const lz of [b.d / 4, -b.d / 4]) {
          const cx = b.cx - lz * sinR;
          const cz = b.cz + lz * cosR;
          const stripe = fillStripe(districtRng, nextId, ctx, cx, cz, b.w, budget);
          nextId += stripe.length;
          buildings.push(...stripe);
        }
      } else {
        // Single stripe down the block centre; depth budget is the whole block.
        const budget = Math.max(6, b.d - 2);
        const stripe = fillStripe(districtRng, nextId, ctx, b.cx, b.cz, b.w, budget);
        nextId += stripe.length;
        buildings.push(...stripe);
      }
    }
  }

  return {
    buildings,
    districts: field.districts,
    topology,
    arterials,
    seams,
    blocks: planBlocks,
    streets: [],
  };
}

export type StreetlightTier = "highway" | "arterial" | "local";

export type Streetlight = {
  x: number;
  y: number;
  z: number;
  kelvin: number;
  isFailing: boolean;
  tier: StreetlightTier;
};

// Modern-LED streetlight matrix (decision note §Streetlight planning):
//   highway + arterial → 4000K uniform (no variant);
//   local → per-zone colour temperature by district character.
const LOCAL_KELVIN: Record<DistrictCharacter, number> = {
  downtown: 4000,
  subcentre: 4000,
  residential: 3000,
  heritage: 2700,
  industrial: 4300,
  "mixed-use": 3500,
};
const HIGHWAY_KELVIN = 4000;
const ARTERIAL_KELVIN = 4000;
// A replaced bulb / different batch sits at one of these off-temps.
const VARIANT_TEMPS = [2200, 3500, 5000];
const FAILURE_RATE = 0.025; // fraction of local lights that flicker as failing

function pickVariant(rng: () => number, base: number): number {
  for (let i = 0; i < 4; i++) {
    const t = VARIANT_TEMPS[Math.floor(rng() * VARIANT_TEMPS.length)];
    if (Math.abs(t - base) > 200) return t;
  }
  return VARIANT_TEMPS[0];
}

// Emit lights in pairs along both sides of a road polyline at fixed spacing.
function emitRoadLights(
  rng: () => number,
  road: RoadLike,
  tier: StreetlightTier,
  kelvin: number,
  spacing: number,
  out: Streetlight[],
) {
  const verts = road.vertices;
  const last = road.closed ? verts.length : verts.length - 1;
  const offset = road.width / 2 + 2;
  for (let i = 0; i < last; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen === 0) continue;
    const ux = (b.x - a.x) / segLen;
    const uz = (b.z - a.z) / segLen;
    const nx = -uz;
    const nz = ux;
    for (let s = spacing; s < segLen; s += spacing) {
      for (const side of [-1, 1] as const) {
        out.push({
          x: a.x + ux * s + nx * offset * side,
          y: 7 + (rng() - 0.5) * 0.4,
          z: a.z + uz * s + nz * offset * side,
          kelvin,
          isFailing: rng() < FAILURE_RATE,
          tier,
        });
      }
    }
  }
}

// Tensor streetlights (Stage 1): edge lights along every road tier. Local
// per-block lights arrive with the blocks in Stage 2-3.
function generateStreetlightsTensor(masterSeed: string): Streetlight[] {
  const { topology, arterials, minorStreets } = buildTensorRoads(masterSeed);
  const lights: Streetlight[] = [];
  const hwRng = seedrandom(`${masterSeed}::streetlights::highways`);
  for (const hw of topology.highways) {
    emitRoadLights(hwRng, hw, "highway", HIGHWAY_KELVIN, 34, lights);
  }
  const artRng = seedrandom(`${masterSeed}::streetlights::arterials`);
  for (const a of arterials) {
    emitRoadLights(artRng, a, "arterial", ARTERIAL_KELVIN, 28, lights);
  }
  const minRng = seedrandom(`${masterSeed}::streetlights::minor`);
  for (const s of minorStreets) {
    emitRoadLights(minRng, s, "local", 3300, 40, lights);
  }
  return lights;
}

// Streets-first streetlights: edge lights on highways + grid arterials, plus
// one local light per block (kelvin by character), clear of every road corridor.
function generateStreetlightsGridFirst(masterSeed: string): Streetlight[] {
  const theta0 = 0;
  const topology = dropRadialSpokes(generateTopology(masterSeed));
  const field = generateDistricts(masterSeed, topology, true, theta0);
  const grid = generateStreetGrid(masterSeed, field, theta0);
  const roads: RoadLike[] = [...topology.highways, ...grid.arterials, ...grid.streets];
  const lights: Streetlight[] = [];

  const hwRng = seedrandom(`${masterSeed}::streetlights::highways`);
  for (const hw of topology.highways) {
    emitRoadLights(hwRng, hw, "highway", HIGHWAY_KELVIN, 34, lights);
  }
  const artRng = seedrandom(`${masterSeed}::streetlights::arterials`);
  for (const a of grid.arterials) {
    emitRoadLights(artRng, a, "arterial", ARTERIAL_KELVIN, 28, lights);
  }

  // Local lights — one candidate per block, jittered off the centroid.
  const locRng = seedrandom(`${masterSeed}::streetlights::local`);
  for (const cell of grid.cells) {
    if (locRng() < 0.35) continue;
    const ox = cell.cx + (locRng() - 0.5) * 8;
    const oz = cell.cz + (locRng() - 0.5) * 8;
    const baseKelvin = LOCAL_KELVIN[cell.character];
    const kelvin = locRng() < 0.05 ? pickVariant(locRng, baseKelvin) : baseKelvin;
    const isFailing = locRng() < FAILURE_RATE;
    if (onRoadCorridor(roads, ox, oz)) continue;
    lights.push({ x: ox, y: 7 + (locRng() - 0.5) * 0.4, z: oz, kelvin, isFailing, tier: "local" });
  }

  return lights;
}

export function generateStreetlights(
  rawSeed: string,
  tuning: GridTuning = DEFAULT_TUNING,
): Streetlight[] {
  const hit = lightsCache.get(rawSeed);
  if (hit) return hit;
  const result = generateStreetlightsImpl(rawSeed, tuning);
  if (lightsCache.size > 64) lightsCache.clear();
  lightsCache.set(rawSeed, result);
  return result;
}

function generateStreetlightsImpl(
  rawSeed: string,
  tuning: GridTuning = DEFAULT_TUNING,
): Streetlight[] {
  const masterSeed = stripGridFirst(rawSeed);
  // Tensor is the default; ::gridfirst routes to the dormant grid path.
  if (!gridFirst(rawSeed)) return generateStreetlightsTensor(masterSeed);
  const useGrid = gridFirst(rawSeed);
  if (useGrid) return generateStreetlightsGridFirst(masterSeed);
  const lattice = useGrid ? computeLattice(masterSeed, tuning.driftDeg) : null;
  const theta0 = lattice ? lattice.theta0 : 0;
  const topology = generateTopology(masterSeed);
  const field = generateDistricts(masterSeed, topology, useGrid, theta0);
  const arterials = generateArterials(masterSeed, topology, field, useGrid, theta0);
  const districtRot = districtOrientations(masterSeed, field, useGrid, lattice, tuning.zoneSpread);
  const seams: SeamPolyline[] = useGrid
    ? seamSegments(field, districtRot, tuning.seamMaxCount, tuning.seamMinAngle)
    : [];
  const roads: RoadLike[] = [...topology.highways, ...arterials, ...seams];
  const lights: Streetlight[] = [];

  // Local lights — per-zone colour temperature, on a block grid inside each
  // district shell, clear of every road corridor.
  for (const district of field.districts) {
    const grammar = GRAMMAR[district.character];
    const rng = seedrandom(`${masterSeed}::streetlights::${district.id}`);
    const colSpacing = grammar.blockW + grammar.streetW;
    const rowSpacing = grammar.blockD + grammar.streetD;
    const lightY = district.character === "heritage" ? 5 : 7;
    const baseKelvin = LOCAL_KELVIN[district.character];
    const variantChance = district.character === "heritage" ? 0.08 : 0.04;

    for (let x = district.minX; x <= district.maxX; x += colSpacing) {
      for (let z = district.minZ; z <= district.maxZ; z += rowSpacing) {
        if (rng() < 0.22) continue;
        const ox = x + (rng() - 0.5) * 4;
        const oz = z + (rng() - 0.5) * 4;
        if (field.classify(ox, oz) !== district.index) continue;
        if (onRoadCorridor(roads, ox, oz)) continue;
        const kelvin = rng() < variantChance ? pickVariant(rng, baseKelvin) : baseKelvin;
        lights.push({
          x: ox,
          y: lightY + (rng() - 0.5) * 0.4,
          z: oz,
          kelvin,
          isFailing: rng() < FAILURE_RATE,
          tier: "local",
        });
      }
    }
  }

  // Highway + arterial edge lights — 4000K uniform, wider spacing on highways.
  const hwRng = seedrandom(`${masterSeed}::streetlights::highways`);
  for (const hw of topology.highways) {
    emitRoadLights(hwRng, hw, "highway", HIGHWAY_KELVIN, 34, lights);
  }
  const artRng = seedrandom(`${masterSeed}::streetlights::arterials`);
  for (const a of arterials) {
    emitRoadLights(artRng, a, "arterial", ARTERIAL_KELVIN, 26, lights);
  }
  // Seam avenues light like arterials (reuse the tier; distinct RNG key).
  const seamRng = seedrandom(`${masterSeed}::streetlights::seams`);
  for (const s of seams) {
    emitRoadLights(seamRng, s, "arterial", ARTERIAL_KELVIN, 26, lights);
  }

  return lights;
}

export type AviationBeacon = {
  x: number;
  y: number; // world Y at the roof beacon
  z: number;
  phase: number; // 0..1 blink phase offset so towers don't flash in unison
};

// Real-world obstruction lights sit on structures tall enough to threaten
// flight paths. Gate on absolute height so only genuine skyscrapers get a red
// beacon — a short city has none, which is correct.
const BEACON_MIN_HEIGHT = 100;

export function generateAviationBeacons(rawSeed: string): AviationBeacon[] {
  const masterSeed = stripGridFirst(rawSeed);
  // Pass the RAW seed: generateCity reads the ::gridfirst flag from its own
  // argument, so the beacon building set must come from the unstripped seed —
  // otherwise beacons land on the legacy layout while the scene renders grid-
  // first. masterSeed (sentinel stripped) is only the RNG-key base below.
  const { buildings } = generateCity(rawSeed);
  const rng = seedrandom(`${masterSeed}::beacons`);
  const beacons: AviationBeacon[] = [];
  for (const b of buildings) {
    if (b.height < BEACON_MIN_HEIGHT) continue;
    beacons.push({ x: b.x, y: b.height + 3, z: b.z, phase: rng() });
  }
  return beacons;
}
