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
    if (onRoadCorridor(roads, worldX, worldZ)) continue;

    const prox = coreProx(worldX, worldZ);
    // Silhouette template shapes the high-rise skyline; non-high-rise districts
    // have no field (multiplier = 1) and keep their flat per-character cap.
    const hm = silhouette ? silhouette.multiplier(worldX, worldZ) : 1;
    const height = dims.height * grammar.heightCap * hm * hJ * outlierH;

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
      coreProximity: prox,
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

  // Silhouette field per high-rise district + global core-proximity from all peaks.
  const silhouetteByIndex = new Map<number, SilhouetteField>();
  for (const d of field.districts) {
    if (isHighRise(d.character)) silhouetteByIndex.set(d.index, buildSilhouette(masterSeed, d));
  }
  const coreProx = makeCoreProximity([...silhouetteByIndex.values()]);

  const arterials = generateArterials(masterSeed, topology, field);
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
    const rot = (districtRng() - 0.5) * rotSpread;
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

export function generateStreetlights(masterSeed: string): Streetlight[] {
  const topology = generateTopology(masterSeed);
  const field = generateDistricts(masterSeed, topology);
  const arterials = generateArterials(masterSeed, topology, field);
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
