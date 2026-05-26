import seedrandom from "seedrandom";
import { generateTopology, type Highway, type Topology } from "./topology";
import {
  generateDistricts,
  type District,
  type DistrictCharacter,
  type DistrictField,
} from "./district";

export type Archetype =
  | "low-rise"
  | "warehouse"
  | "mid-rise"
  | "residential-tower"
  | "narrow-tower"
  | "office-block"
  | "spire";

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
  downtownBias: number; // 0..1 — proximity to the city core (PR 3 → coreProximity)
  windowSeed: number;
  rowsPerFloor: number;
  colsPerFace: number;
  floors: number;
};

export type CityData = {
  buildings: Building[];
  districts: District[];
  topology: Topology;
};

// All in meters. See wiki/research/building-sizes-real-world-references.md
const RESIDENTIAL_FLOOR_M = 3.0;
const OFFICE_FLOOR_M = 3.5;
const WINDOW_PITCH_M = 3.5;

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

function dimensionsForArchetype(arch: Archetype, rng: () => number) {
  switch (arch) {
    case "spire":
      return { width: 14 + rng() * 14, depth: 14 + rng() * 14, height: 80 + rng() * 140 };
    case "narrow-tower":
      return { width: 8 + rng() * 6, depth: 8 + rng() * 5, height: 50 + rng() * 30 };
    case "residential-tower":
      return { width: 16 + rng() * 14, depth: 14 + rng() * 8, height: 24 + rng() * 26 };
    case "office-block":
      return { width: 22 + rng() * 22, depth: 18 + rng() * 14, height: 30 + rng() * 50 };
    case "mid-rise":
      return { width: 14 + rng() * 12, depth: 12 + rng() * 8, height: 12 + rng() * 16 };
    case "warehouse":
      return { width: 28 + rng() * 25, depth: 22 + rng() * 18, height: 7 + rng() * 7 };
    case "low-rise":
      return { width: 10 + rng() * 10, depth: 8 + rng() * 7, height: 6 + rng() * 4 };
  }
}

function layerForZ(z: number): Layer {
  if (z > 0) return "front";
  if (z > -120) return "mid";
  return "back";
}

function isOfficeStyle(arch: Archetype) {
  return arch === "office-block" || arch === "spire" || arch === "warehouse";
}

// Core proximity for height boost + lighting bias. Centred on the city centre
// (which the downtown district sits at in Stage 1). PR 3 swaps this for a true
// distance-to-downtown-centroid coreProximity field.
const DOWNTOWN_RX = 220;
const DOWNTOWN_RZ = 190;
const DOWNTOWN_BOOST = 1.7;

function coreProximity(topo: Topology, x: number, z: number): number {
  const dx = (x - topo.centerX) / DOWNTOWN_RX;
  const dz = (z - topo.centerZ) / DOWNTOWN_RZ;
  return Math.max(0, 1 - Math.sqrt(dx * dx + dz * dz));
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

function onHighwayCorridor(highways: Highway[], x: number, z: number): boolean {
  for (const hw of highways) {
    const margin = hw.width / 2 + 5;
    const verts = hw.vertices;
    const last = hw.closed ? verts.length : verts.length - 1;
    for (let i = 0; i < last; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      if (pointSegmentDistance(x, z, a.x, a.z, b.x, b.z) < margin) return true;
    }
  }
  return false;
}

type Block = { cx: number; cz: number; w: number; d: number; empty: boolean; stripes: 1 | 2 };

// Lay a (slightly rotated) block grid across a district's bounding box.
function districtBlocks(
  rng: () => number,
  district: District,
  grammar: CharacterGrammar,
  rot: number,
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
      blocks.push({
        cx,
        cz,
        w: bw,
        d: bd,
        empty: rng() < grammar.emptyBlockProb,
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
    topo: Topology;
    field: DistrictField;
    rot: number;
  },
  blockCx: number,
  stripeCz: number,
  blockWidth: number,
  depthBudget: number,
): Building[] {
  const { district, character, grammar, topo, field, rot } = ctx;
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
    const dt = (() => {
      // Local (blockCx + lx, stripeCz) is already partly in world via the block
      // centre; convert the local offset (lx, 0) by the district rotation.
      const wx = blockCx + lx * cosR;
      const wz = stripeCz + lx * sinR;
      return coreProximity(topo, wx, wz);
    })();

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

    // World centre of this building.
    const lxCenter = lx + width / 2;
    const lzJitter = (rng() - 0.5) * 1.5;
    const worldX = blockCx + lxCenter * cosR - lzJitter * sinR;
    const worldZ = stripeCz + lxCenter * sinR + lzJitter * cosR;

    lx += width + 0.5 + rng() * 1.5;

    // Containment: the building's whole footprint must lie inside this district
    // and clear of every highway corridor. Footprint-level (not just centre)
    // containment carves street gaps at district seams → no cross-district
    // overlap.
    if (!footprintInDistrict(field, district.index, worldX, worldZ, width, depth, cosR, sinR))
      continue;
    if (onHighwayCorridor(topo.highways, worldX, worldZ)) continue;

    const dt2 = coreProximity(topo, worldX, worldZ);
    const downtownBoost = 1 + dt2 * (DOWNTOWN_BOOST - 1);
    const height = dims.height * grammar.heightCap * downtownBoost * hJ * outlierH;

    const floorPitch = isOfficeStyle(archetype) ? OFFICE_FLOOR_M : RESIDENTIAL_FLOOR_M;
    const floors = Math.max(2, Math.round(height / floorPitch));
    const colsPerFace = Math.max(3, Math.round(width / WINDOW_PITCH_M));

    buildings.push({
      id: id++,
      x: worldX,
      z: worldZ,
      width,
      depth,
      height,
      rotationY: rot,
      archetype,
      layer: layerForZ(worldZ),
      district: lightingClass,
      districtId: district.id,
      downtownBias: dt2,
      windowSeed: rng(),
      rowsPerFloor: 1,
      colsPerFace,
      floors,
    });
  }

  return buildings;
}

export function generateCity(masterSeed: string): CityData {
  const topology = generateTopology(masterSeed);
  const field = generateDistricts(masterSeed, topology);
  const buildings: Building[] = [];
  let nextId = 0;

  for (const district of field.districts) {
    const grammar = GRAMMAR[district.character];
    const districtRng = seedrandom(`${masterSeed}::layout::${district.id}`);
    // Per-district rotation gives each shell its own grain. Heritage is the most
    // organic, downtown the most orthogonal.
    const rotSpread = district.character === "heritage" ? 0.5 : 0.18;
    const rot = (districtRng() - 0.5) * rotSpread;
    const ctx = { district, character: district.character, grammar, topo: topology, field, rot };
    const blocks = districtBlocks(districtRng, district, grammar, rot);

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

  return { buildings, districts: field.districts, topology };
}

export type Streetlight = { x: number; y: number; z: number };

// Interim streetlight generator — places lights at block-corner intersections
// inside each district shell, skipping highway corridors. PR 4 replaces this
// with the full per-tier + per-zone planning matrix.
export function generateStreetlights(masterSeed: string): Streetlight[] {
  const topology = generateTopology(masterSeed);
  const field = generateDistricts(masterSeed, topology);
  const lights: Streetlight[] = [];

  for (const district of field.districts) {
    const grammar = GRAMMAR[district.character];
    const rng = seedrandom(`${masterSeed}::streetlights::${district.id}`);
    const colSpacing = grammar.blockW + grammar.streetW;
    const rowSpacing = grammar.blockD + grammar.streetD;
    const lightY = district.character === "heritage" ? 5 : 7;

    for (let x = district.minX; x <= district.maxX; x += colSpacing) {
      for (let z = district.minZ; z <= district.maxZ; z += rowSpacing) {
        if (rng() < 0.22) continue;
        const ox = x + (rng() - 0.5) * 4;
        const oz = z + (rng() - 0.5) * 4;
        if (field.classify(ox, oz) !== district.index) continue;
        if (onHighwayCorridor(topology.highways, ox, oz)) continue;
        lights.push({ x: ox, y: lightY + (rng() - 0.5) * 0.4, z: oz });
      }
    }
  }

  // Highway-edge lights — pairs along both sides of each highway polyline.
  const hwRng = seedrandom(`${masterSeed}::streetlights::highways`);
  for (const hw of topology.highways) {
    const verts = hw.vertices;
    const last = hw.closed ? verts.length : verts.length - 1;
    const offset = hw.width / 2 + 2;
    const spacing = 30;
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
          lights.push({
            x: a.x + ux * s + nx * offset * side,
            y: 7 + (hwRng() - 0.5) * 0.4,
            z: a.z + uz * s + nz * offset * side,
          });
        }
      }
    }
  }

  return lights;
}
