import seedrandom from "seedrandom";
import { generateTopology, type Topology } from "./topology";
import {
  generateDistricts,
  type District,
  type DistrictCharacter,
  type DistrictField,
} from "./district";
import { buildSilhouette, isHighRise, type SilhouetteField } from "./silhouette";
import { generateArterials, type Arterial } from "./arterials";
import { stripGridFirst, gridFirst, computeLattice } from "./lattice";

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

export type CityData = {
  buildings: Building[];
  districts: District[];
  topology: Topology;
  arterials: Arterial[];
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

// Stage 2 (grid-first): residual per-district jitter layered on top of the
// lattice orientation field, so districts in the same neighbourhood read as a
// patchwork of slightly-off grids rather than one rigid plane. Kept small.
const GRID_RESIDUAL_SPREAD = 0.05; // rad ≈ ±1.4° (half-spread)

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
): Block[] {
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const w = district.maxX - district.minX;
  const d = district.maxZ - district.minZ;
  const span = Math.max(w, d) * 1.15; // overshoot so the rotated grid covers corners
  const colSpacing = grammar.blockW + grammar.streetW;
  const rowSpacing = grammar.blockD + grammar.streetD;
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
      const bd = grammar.blockD * (1 - sizeJitterD * rng());
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
    const alongStripe = useFacing
      ? Math.abs(width * cosDA) + Math.abs(depth * sinDA)
      : width;
    const lxCenter = useFacing ? lx + alongStripe / 2 : tentLxCenter;
    if (useFacing && lxCenter + alongStripe / 2 > endLx) break;

    const worldX = useFacing
      ? blockCx + lxCenter * cosR - lzJitter * sinR
      : tentWorldX;
    const worldZ = useFacing
      ? stripeCz + lxCenter * sinR + lzJitter * cosR
      : tentWorldZ;

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

export function generateCity(rawSeed: string): CityData {
  // Strip the grid-first flag sentinel before any RNG key is derived (Stage 0).
  const masterSeed = stripGridFirst(rawSeed);
  // Grid-first rework — Stage 1. Read the flag from the raw seed and compute the
  // lattice θ0 once; both feed the L∞ district metric + grid-line arterials.
  // Flag-OFF leaves every path byte-identical to pre-rework behaviour.
  const useGrid = gridFirst(rawSeed);
  // Compute the lattice once when grid-first is on; reused for both the district
  // metric frame (θ0) and the per-district grid grain (orientationAt, Stage 2).
  const lattice = useGrid ? computeLattice(masterSeed) : null;
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
  // Buildings skip both road tiers so highways + arterials read as open avenues.
  const roads: RoadLike[] = [...topology.highways, ...arterials];

  const buildings: Building[] = [];
  let nextId = 0;

  for (const district of field.districts) {
    const grammar = GRAMMAR[district.character];
    const districtRng = seedrandom(`${masterSeed}::layout::${district.id}`);
    // Per-district rotation gives each shell its own grain. Heritage is the most
    // organic, downtown the most orthogonal.
    const rotSpread = district.character === "heritage" ? 0.5 : 0.18;
    // Stage 2: grid-first anchors the grain to the lattice orientation field at
    // the district centroid (neighbours differ only slightly — patchwork, not
    // confetti) plus a small per-character residual jitter. The legacy path keeps
    // its independent rotation. CRITICAL: both branches consume the SAME single
    // districtRng() draw, so every downstream draw (archetype, dims, windowSeed)
    // is byte-identical to before — proven by the gate1 building-count assert.
    const rj = districtRng();
    const rot =
      useGrid && lattice
        ? lattice.orientationAt(district.centroidX, district.centroidZ) +
          (rj - 0.5) * GRID_RESIDUAL_SPREAD
        : (rj - 0.5) * rotSpread;
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
    );

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

  return { buildings, districts: field.districts, topology, arterials };
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

export function generateStreetlights(rawSeed: string): Streetlight[] {
  const masterSeed = stripGridFirst(rawSeed);
  // Grid-first — streetlights follow the new arterials/districts when on.
  const useGrid = gridFirst(rawSeed);
  const theta0 = useGrid ? computeLattice(masterSeed).theta0 : 0;
  const topology = generateTopology(masterSeed);
  const field = generateDistricts(masterSeed, topology, useGrid, theta0);
  const arterials = generateArterials(masterSeed, topology, field, useGrid, theta0);
  const roads: RoadLike[] = [...topology.highways, ...arterials];
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
  const { buildings } = generateCity(masterSeed);
  const rng = seedrandom(`${masterSeed}::beacons`);
  const beacons: AviationBeacon[] = [];
  for (const b of buildings) {
    if (b.height < BEACON_MIN_HEIGHT) continue;
    beacons.push({ x: b.x, y: b.height + 3, z: b.z, phase: rng() });
  }
  return beacons;
}
