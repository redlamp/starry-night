import seedrandom from "seedrandom";

export type Archetype =
  | "low-rise"
  | "warehouse"
  | "mid-rise"
  | "residential-tower"
  | "narrow-tower"
  | "office-block"
  | "spire";

export type Layer = "front" | "mid" | "back";
export type DistrictCharacter = "downtown" | "residential" | "industrial" | "oldtown";

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
  district: DistrictCharacter;
  windowSeed: number;
  rowsPerFloor: number;
  colsPerFace: number;
  floors: number;
};

// All in meters. See wiki/research/building-sizes-real-world-references.md
const RESIDENTIAL_FLOOR_M = 3.0;
const OFFICE_FLOOR_M = 3.5;
const WINDOW_PITCH_M = 3.5;

type DistrictSpec = {
  id: string;
  character: DistrictCharacter;
  centerX: number;
  centerZ: number;
  width: number; // local x extent
  depth: number; // local z extent
  rotationDeg: number;
  blockW: number;
  blockD: number;
  streetW: number;
  streetD: number;
  blockJitter: number; // 0..1 — how irregular blocks are
  emptyBlockProb: number;
  superBlockProb: number;
  twoStripeProb: number;
};

// District composition. See wiki/notes/decision-district-based-city-layout.md
const DISTRICTS: DistrictSpec[] = [
  {
    id: "downtown",
    character: "downtown",
    centerX: 0,
    centerZ: -120,
    width: 280,
    depth: 220,
    rotationDeg: 0,
    blockW: 55,
    blockD: 48,
    streetW: 14,
    streetD: 18,
    blockJitter: 0.15,
    emptyBlockProb: 0.03,
    superBlockProb: 0.05,
    twoStripeProb: 0.7,
  },
  {
    id: "midtown",
    character: "downtown",
    centerX: 30,
    centerZ: 90,
    width: 320,
    depth: 140,
    rotationDeg: -3,
    blockW: 70,
    blockD: 55,
    streetW: 14,
    streetD: 18,
    blockJitter: 0.18,
    emptyBlockProb: 0.04,
    superBlockProb: 0.04,
    twoStripeProb: 0.6,
  },
  {
    id: "oldtown",
    character: "oldtown",
    centerX: -230,
    centerZ: -50,
    width: 200,
    depth: 180,
    rotationDeg: 22,
    blockW: 38,
    blockD: 32,
    streetW: 8,
    streetD: 10,
    blockJitter: 0.55,
    emptyBlockProb: 0.07,
    superBlockProb: 0.02,
    twoStripeProb: 0.35,
  },
  {
    id: "residential-west",
    character: "residential",
    centerX: -280,
    centerZ: 130,
    width: 240,
    depth: 250,
    rotationDeg: 12,
    blockW: 80,
    blockD: 60,
    streetW: 12,
    streetD: 14,
    blockJitter: 0.25,
    emptyBlockProb: 0.05,
    superBlockProb: 0.05,
    twoStripeProb: 0.6,
  },
  {
    id: "residential-east",
    character: "residential",
    centerX: 290,
    centerZ: 90,
    width: 250,
    depth: 250,
    rotationDeg: -10,
    blockW: 85,
    blockD: 65,
    streetW: 12,
    streetD: 14,
    blockJitter: 0.22,
    emptyBlockProb: 0.05,
    superBlockProb: 0.05,
    twoStripeProb: 0.6,
  },
  {
    id: "commercial-bridge",
    character: "downtown",
    centerX: -90,
    centerZ: -280,
    width: 260,
    depth: 140,
    rotationDeg: 6,
    blockW: 70,
    blockD: 55,
    streetW: 14,
    streetD: 18,
    blockJitter: 0.2,
    emptyBlockProb: 0.05,
    superBlockProb: 0.05,
    twoStripeProb: 0.65,
  },
  {
    id: "industrial-south",
    character: "industrial",
    centerX: 80,
    centerZ: -440,
    width: 460,
    depth: 200,
    rotationDeg: 3,
    blockW: 120,
    blockD: 90,
    streetW: 18,
    streetD: 22,
    blockJitter: 0.12,
    emptyBlockProb: 0.1,
    superBlockProb: 0.08,
    twoStripeProb: 0.45,
  },
  {
    id: "harbor-east",
    character: "industrial",
    centerX: 320,
    centerZ: -320,
    width: 220,
    depth: 200,
    rotationDeg: -16,
    blockW: 110,
    blockD: 80,
    streetW: 16,
    streetD: 20,
    blockJitter: 0.15,
    emptyBlockProb: 0.1,
    superBlockProb: 0.07,
    twoStripeProb: 0.4,
  },
];

function pickArchetype(
  rng: () => number,
  character: DistrictCharacter,
  downtown: number,
): Archetype {
  const r = rng();
  if (character === "downtown") {
    if (downtown > 0.55 && r < 0.3) return "spire";
    if (r < 0.5) return "narrow-tower";
    if (r < 0.75) return "office-block";
    if (r < 0.9) return "residential-tower";
    return "mid-rise";
  }
  if (character === "residential") {
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
  // oldtown
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

// Downtown ellipse for height boost — independent of district to allow gradient bleed across district seams.
const DOWNTOWN_RX = 200;
const DOWNTOWN_RZ = 170;
const DOWNTOWN_CX = 0;
const DOWNTOWN_CZ = -120;
const DOWNTOWN_BOOST = 1.7;

// Diagonal arterials — wide streets cutting across district grids at angles.
// Buildings whose centre falls within an arterial corridor get skipped.
type Arterial = { x1: number; z1: number; x2: number; z2: number; halfWidth: number };
const ARTERIALS: Arterial[] = [
  // NW → SE sweep, runs through downtown + east residential
  { x1: -480, z1: 220, x2: 480, z2: -460, halfWidth: 11 },
  // SW → NE sweep, runs through industrial + downtown + east
  { x1: -300, z1: -500, x2: 420, z2: 260, halfWidth: 9 },
];

function pointArterialDistance(x: number, z: number, a: Arterial): number {
  const dx = a.x2 - a.x1;
  const dz = a.z2 - a.z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(x - a.x1, z - a.z1);
  let t = ((x - a.x1) * dx + (z - a.z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x1 + t * dx;
  const projZ = a.z1 + t * dz;
  return Math.hypot(x - projX, z - projZ);
}

function inAnyArterial(x: number, z: number): boolean {
  for (const a of ARTERIALS) {
    if (pointArterialDistance(x, z, a) < a.halfWidth) return true;
  }
  return false;
}

export function getArterials(): Arterial[] {
  return ARTERIALS;
}

function downtownBias(x: number, z: number): number {
  const dx = (x - DOWNTOWN_CX) / DOWNTOWN_RX;
  const dz = (z - DOWNTOWN_CZ) / DOWNTOWN_RZ;
  const d = Math.sqrt(dx * dx + dz * dz);
  return Math.max(0, 1 - d);
}

type LocalBlock = {
  lx: number;
  lz: number;
  w: number;
  d: number;
  empty: boolean;
  stripes: 1 | 2;
};

function generateDistrictBlocks(rng: () => number, spec: DistrictSpec): LocalBlock[] {
  const colSpacing = spec.blockW + spec.streetW;
  const rowSpacing = spec.blockD + spec.streetD;
  const cols = Math.max(1, Math.floor(spec.width / colSpacing));
  const rows = Math.max(1, Math.floor(spec.depth / rowSpacing));
  const startX = -((cols - 1) * colSpacing) / 2;
  const startZ = -((rows - 1) * rowSpacing) / 2;
  const posJitter = 6 * spec.blockJitter;
  const sizeJitterW = 0.4 * spec.blockJitter;
  const sizeJitterD = 0.3 * spec.blockJitter;

  const blocks: LocalBlock[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const isSuper = rng() < spec.superBlockProb;
      const w = spec.blockW * (1 - sizeJitterW * 0.5 + rng() * sizeJitterW) * (isSuper ? 1.5 : 1);
      const d = spec.blockD * (1 - sizeJitterD * 0.5 + rng() * sizeJitterD) * (isSuper ? 1.3 : 1);
      blocks.push({
        lx: startX + i * colSpacing + (rng() - 0.5) * posJitter,
        lz: startZ + j * rowSpacing + (rng() - 0.5) * posJitter,
        w,
        d,
        empty: rng() < spec.emptyBlockProb,
        stripes: rng() < spec.twoStripeProb ? 2 : 1,
      });
    }
  }
  return blocks;
}

function fillStripe(
  rng: () => number,
  startId: number,
  spec: DistrictSpec,
  cosR: number,
  sinR: number,
  localBlockX: number,
  localStripeZ: number,
  blockWidth: number,
): Building[] {
  const buildings: Building[] = [];
  const halfBW = blockWidth / 2;
  let id = startId;

  let lx = localBlockX - halfBW + rng() * 2;
  const endLx = localBlockX + halfBW;
  const heightCap = spec.character === "industrial" ? 0.45 : spec.character === "oldtown" ? 0.7 : 1;

  while (lx < endLx) {
    // World position before archetype pick — district + downtown bias use world coords.
    const wxCenter = spec.centerX + lx * cosR - localStripeZ * sinR;
    const wzCenter = spec.centerZ + lx * sinR + localStripeZ * cosR;
    const dt = downtownBias(wxCenter, wzCenter);

    const archetype = pickArchetype(rng, spec.character, dt);
    const dims = dimensionsForArchetype(archetype, rng);

    const wJ = 0.8 + rng() * 0.4;
    const dJ = 0.85 + rng() * 0.3;
    const hJ = 0.75 + rng() * 0.5;
    const outlierH = rng() < 0.06 ? (rng() < 0.5 ? 0.55 : 1.5) : 1.0;

    const width = Math.min(dims.width * wJ, blockWidth * 0.95);
    if (lx + width > endLx) break;

    const depth = dims.depth * dJ;
    const downtownBoost = 1 + dt * (DOWNTOWN_BOOST - 1);
    const height = dims.height * heightCap * downtownBoost * hJ * outlierH;

    const floorPitch = isOfficeStyle(archetype) ? OFFICE_FLOOR_M : RESIDENTIAL_FLOOR_M;
    const floors = Math.max(2, Math.round(height / floorPitch));
    const colsPerFace = Math.max(3, Math.round(width / WINDOW_PITCH_M));

    // World position for this building's centre — local (lx + width/2, localStripeZ) → rotated → translated.
    const lxCenter = lx + width / 2;
    const lzWithJitter = localStripeZ + (rng() - 0.5) * 1.5;
    const worldX = spec.centerX + lxCenter * cosR - lzWithJitter * sinR;
    const worldZ = spec.centerZ + lxCenter * sinR + lzWithJitter * cosR;

    // Diagonal arterials override district grid — skip buildings caught in their corridor.
    if (inAnyArterial(worldX, worldZ)) {
      lx += width + 0.5 + rng() * 1.5;
      continue;
    }

    buildings.push({
      id: id++,
      x: worldX,
      z: worldZ,
      width,
      depth,
      height,
      rotationY: (spec.rotationDeg * Math.PI) / 180,
      archetype,
      layer: layerForZ(worldZ),
      district: spec.character,
      windowSeed: rng(),
      rowsPerFloor: 1,
      colsPerFace,
      floors,
    });

    lx += width + 0.5 + rng() * 1.5;
  }

  return buildings;
}

export type Streetlight = { x: number; y: number; z: number };

export function generateStreetlights(masterSeed: string): Streetlight[] {
  const lights: Streetlight[] = [];
  for (const spec of DISTRICTS) {
    const rng = seedrandom(`${masterSeed}::streetlights::${spec.id}`);
    const cosR = Math.cos((spec.rotationDeg * Math.PI) / 180);
    const sinR = Math.sin((spec.rotationDeg * Math.PI) / 180);
    const colSpacing = spec.blockW + spec.streetW;
    const rowSpacing = spec.blockD + spec.streetD;
    const cols = Math.max(1, Math.floor(spec.width / colSpacing));
    const rows = Math.max(1, Math.floor(spec.depth / rowSpacing));
    const startX = -((cols - 1) * colSpacing) / 2;
    const startZ = -((rows - 1) * rowSpacing) / 2;
    const lightY = spec.character === "oldtown" ? 5 : 7;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        // Place a light at each block's 4 corners (street intersections), slightly inside.
        const lx = startX + i * colSpacing;
        const lz = startZ + j * rowSpacing;
        const inset = 2.5;
        const halfW = spec.blockW / 2 + inset;
        const halfD = spec.blockD / 2 + inset;
        for (const [dx, dz] of [
          [-halfW, -halfD],
          [halfW, -halfD],
          [-halfW, halfD],
          [halfW, halfD],
        ] as const) {
          // skip ~20% randomly so they're not perfectly regular
          if (rng() < 0.22) continue;
          const ox = lx + dx + (rng() - 0.5) * 1.5;
          const oz = lz + dz + (rng() - 0.5) * 1.5;
          const wx = spec.centerX + ox * cosR - oz * sinR;
          const wz = spec.centerZ + ox * sinR + oz * cosR;
          if (inAnyArterial(wx, wz)) continue;
          lights.push({ x: wx, y: lightY + (rng() - 0.5) * 0.4, z: wz });
        }
      }
    }
  }

  // Arterial streetlights — pairs along both sides of each diagonal road.
  const arterialRng = seedrandom(`${masterSeed}::streetlights::arterials`);
  for (const a of ARTERIALS) {
    const dx = a.x2 - a.x1;
    const dz = a.z2 - a.z1;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const spacing = 22;
    const offset = a.halfWidth + 1.5;
    for (let s = spacing; s < len; s += spacing) {
      for (const side of [-1, 1] as const) {
        const cx = a.x1 + ux * s + nx * offset * side;
        const cz = a.z1 + uz * s + nz * offset * side;
        lights.push({ x: cx, y: 7 + (arterialRng() - 0.5) * 0.4, z: cz });
      }
    }
  }

  return lights;
}

export function generateCity(masterSeed: string): Building[] {
  const buildings: Building[] = [];
  let nextId = 0;

  for (const spec of DISTRICTS) {
    const districtRng = seedrandom(`${masterSeed}::layout::${spec.id}`);
    const cosR = Math.cos((spec.rotationDeg * Math.PI) / 180);
    const sinR = Math.sin((spec.rotationDeg * Math.PI) / 180);
    const blocks = generateDistrictBlocks(districtRng, spec);

    for (const b of blocks) {
      if (b.empty) continue;

      const frontStripeZ = b.lz + b.d / 2 - 0.5;
      const stripe1 = fillStripe(
        districtRng,
        nextId,
        spec,
        cosR,
        sinR,
        b.lx,
        frontStripeZ,
        b.w,
      );
      nextId += stripe1.length;
      buildings.push(...stripe1);

      if (b.stripes === 2) {
        const backStripeZ = b.lz - b.d / 2 + 0.5;
        const stripe2 = fillStripe(
          districtRng,
          nextId,
          spec,
          cosR,
          sinR,
          b.lx,
          backStripeZ,
          b.w,
        );
        nextId += stripe2.length;
        buildings.push(...stripe2);
      }
    }
  }

  return buildings;
}
