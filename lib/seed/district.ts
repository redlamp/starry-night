import seedrandom from "seedrandom";
import type { Topology, Highway } from "./topology";

// District field for the streets-first generator (Stage 1).
//
// Highways are hard boundaries: a point never joins a district seed across a
// highway. Within each highway-bounded macro region, district shells are the
// Voronoi cells of center-weighted seed points. The Voronoi edges are where
// arterials will be laid in PR 3, so this partition is forward-compatible with
// the network-closure model the decision note describes for Stage 2.

export type DistrictCharacter =
  | "downtown"
  | "subcentre"
  | "heritage"
  | "residential"
  | "industrial"
  | "mixed-use";

export type District = {
  index: number; // 0..N-1, matches DistrictField.classify() output
  id: string; // stable: `${cardinal}-${character}-${index}`
  character: DistrictCharacter;
  displayName: string; // e.g. "North Downtown"
  seedX: number;
  seedZ: number;
  centroidX: number;
  centroidZ: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  sampleCount: number;
  area: number; // m² (approx, from sample density)
  color: string; // hex, for the plan-view district fill overlay
};

export type DistrictField = {
  districts: District[];
  // World point → district index, or -1 if it lands on a dropped micro-cell.
  classify: (x: number, z: number) => number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

const GRID_STEPS = 64; // sample resolution per axis
const MIN_SAMPLE_FRACTION = 0.006; // districts below this share of samples are merged away

function sideOfSegment(
  x: number,
  z: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): 0 | 1 {
  const cross = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
  return cross >= 0 ? 1 : 0;
}

function pointInPolygon(x: number, z: number, verts: Highway["vertices"]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x;
    const zi = verts[i].z;
    const xj = verts[j].x;
    const zj = verts[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Discrete signature of which side of each highway a point sits on. Closed
// highways (ring roads) contribute inside/outside; open ones contribute the
// side of their first→last chord (exact for straight lines, close enough for
// the gently-arced bypass).
function macroSignature(topo: Topology, x: number, z: number): string {
  let sig = "";
  for (const hw of topo.highways) {
    if (hw.closed) {
      sig += pointInPolygon(x, z, hw.vertices) ? "I" : "O";
    } else {
      const a = hw.vertices[0];
      const b = hw.vertices[hw.vertices.length - 1];
      sig += sideOfSegment(x, z, a.x, a.z, b.x, b.z);
    }
  }
  return sig;
}

type Seed = { x: number; z: number; macro: string };

function placeSeeds(rng: () => number, topo: Topology): Seed[] {
  const { centerX: cx, centerZ: cz, halfExtent: half } = topo;
  const target = 10 + Math.floor(rng() * 15); // 10..24 (merge trims to ~8..24)
  const minDist = half * 0.13;
  const seeds: Seed[] = [];
  let attempts = 0;
  while (seeds.length < target && attempts < 1500) {
    attempts++;
    const ang = rng() * Math.PI * 2;
    // Bias radius toward the centre so cores cluster and the periphery is sparse.
    const rad = Math.pow(rng(), 0.7) * half * 0.92;
    const x = cx + Math.cos(ang) * rad;
    const z = cz + Math.sin(ang) * rad;
    if (seeds.every((s) => Math.hypot(s.x - x, s.z - z) > minDist)) {
      seeds.push({ x, z, macro: macroSignature(topo, x, z) });
    }
  }
  // Guarantee at least 3 seeds even if rejection sampling stalled.
  while (seeds.length < 3) {
    const ang = (seeds.length / 3) * Math.PI * 2;
    const x = cx + Math.cos(ang) * half * 0.4;
    const z = cz + Math.sin(ang) * half * 0.4;
    seeds.push({ x, z, macro: macroSignature(topo, x, z) });
  }
  return seeds;
}

// Nearest seed that shares the point's macro region (highways are hard walls).
// Falls back to global nearest if no seed sits in the same macro region.
function nearestSeed(seeds: Seed[], topo: Topology, x: number, z: number): number {
  const macro = macroSignature(topo, x, z);
  let best = -1;
  let bestD = Infinity;
  let fallback = -1;
  let fallbackD = Infinity;
  for (let i = 0; i < seeds.length; i++) {
    const d = (seeds[i].x - x) ** 2 + (seeds[i].z - z) ** 2;
    if (d < fallbackD) {
      fallbackD = d;
      fallback = i;
    }
    if (seeds[i].macro === macro && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best >= 0 ? best : fallback;
}

const CARDINALS = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"] as const;
const CARDINAL_NAMES: Record<string, string> = {
  E: "East",
  NE: "Northeast",
  N: "North",
  NW: "Northwest",
  W: "West",
  SW: "Southwest",
  S: "South",
  SE: "Southeast",
};

function cardinalOf(cx: number, cz: number, x: number, z: number): string {
  const ang = Math.atan2(z - cz, x - cx); // -π..π
  const idx = Math.round((ang / (Math.PI * 2)) * 8 + 8) % 8;
  return CARDINALS[idx];
}

const CHARACTER_TITLE: Record<DistrictCharacter, string> = {
  downtown: "Downtown",
  subcentre: "Subcentre",
  heritage: "Heritage",
  residential: "Residential",
  industrial: "Industrial",
  "mixed-use": "Mixed-use",
};

const CHARACTER_COLOR: Record<DistrictCharacter, string> = {
  downtown: "#f2b134", // gold
  subcentre: "#e8743b", // orange
  heritage: "#a8743f", // sienna
  residential: "#3fa87e", // teal-green
  industrial: "#6b7a8f", // slate
  "mixed-use": "#9b6bc9", // violet
};

// Deterministic character pass driven by distance-to-centre rank + topology.
function assignCharacters(
  rng: () => number,
  topo: Topology,
  stats: Array<{ centroidX: number; centroidZ: number; area: number }>,
): DistrictCharacter[] {
  const cx = topo.centerX;
  const cz = topo.centerZ;
  const n = stats.length;
  const order = stats
    .map((s, i) => ({ i, d: Math.hypot(s.centroidX - cx, s.centroidZ - cz), area: s.area }))
    .sort((a, b) => a.d - b.d);

  const chars = new Array<DistrictCharacter>(n).fill("residential");
  const assigned = new Set<number>();

  // 1. Closest district is downtown.
  const downtownIdx = order[0].i;
  chars[downtownIdx] = "downtown";
  assigned.add(downtownIdx);

  // 2. Heritage: the smallest of the next two closest (a dense old core beside
  //    downtown). ~70% of cities have one.
  if (n >= 3 && rng() < 0.7) {
    const candidates = order.slice(1, 3).sort((a, b) => a.area - b.area);
    const heritageIdx = candidates[0].i;
    chars[heritageIdx] = "heritage";
    assigned.add(heritageIdx);
  }

  // 3. Subcentres: the high-rise band clusters AROUND downtown — the innermost
  //    unassigned districts become tall, so density concentrates centrally and
  //    the periphery is left to residential / industrial. Scales with size.
  const subTarget = 1 + Math.floor(n / 5);
  let subPlaced = 0;
  for (let rank = 1; rank < order.length && subPlaced < subTarget; rank++) {
    const idx = order[rank].i;
    if (assigned.has(idx)) continue;
    chars[idx] = "subcentre";
    assigned.add(idx);
    subPlaced++;
  }

  // 4. Industrial: the furthest-from-centre districts (docks / yards on the
  //    edge). Scales with city size.
  const industrialTarget = 1 + Math.floor(n / 14);
  let industrialAssigned = 0;
  for (let k = order.length - 1; k >= 0 && industrialAssigned < industrialTarget; k--) {
    if (!assigned.has(order[k].i)) {
      chars[order[k].i] = "industrial";
      assigned.add(order[k].i);
      industrialAssigned++;
    }
  }

  // 5. Remaining: inner unassigned → mixed-use (transition belt), outer → residential.
  const half = n / 2;
  for (let rank = 0; rank < order.length; rank++) {
    const idx = order[rank].i;
    if (assigned.has(idx)) continue;
    chars[idx] = rank < half ? "mixed-use" : "residential";
  }

  return chars;
}

export function generateDistricts(masterSeed: string, topo: Topology): DistrictField {
  const rng = seedrandom(`${masterSeed}::districts`);
  const { centerX: cx, centerZ: cz, halfExtent: half } = topo;
  const seeds = placeSeeds(rng, topo);

  const minX = cx - half;
  const maxX = cx + half;
  const minZ = cz - half;
  const maxZ = cz + half;
  const step = (2 * half) / GRID_STEPS;
  const cellArea = step * step;

  // Pass 1: raw per-seed sample counts to find which seeds survive.
  const rawCount = new Array<number>(seeds.length).fill(0);
  for (let gx = 0; gx < GRID_STEPS; gx++) {
    for (let gz = 0; gz < GRID_STEPS; gz++) {
      const x = minX + (gx + 0.5) * step;
      const z = minZ + (gz + 0.5) * step;
      rawCount[nearestSeed(seeds, topo, x, z)]++;
    }
  }
  const totalSamples = GRID_STEPS * GRID_STEPS;
  const minSamples = totalSamples * MIN_SAMPLE_FRACTION;

  // Build remap: dead seeds fold into the nearest surviving seed.
  const survivors = seeds.map((_, i) => rawCount[i] >= minSamples);
  if (!survivors.some(Boolean)) survivors.fill(true); // degenerate guard
  const remapToSurvivorSeed = new Array<number>(seeds.length);
  for (let i = 0; i < seeds.length; i++) {
    if (survivors[i]) {
      remapToSurvivorSeed[i] = i;
      continue;
    }
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < seeds.length; j++) {
      if (!survivors[j]) continue;
      const d = (seeds[i].x - seeds[j].x) ** 2 + (seeds[i].z - seeds[j].z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    remapToSurvivorSeed[i] = best;
  }

  // Re-index survivors to a dense 0..M-1 range.
  const survivorSeedToIndex = new Map<number, number>();
  for (let i = 0; i < seeds.length; i++) {
    if (survivors[i]) survivorSeedToIndex.set(i, survivorSeedToIndex.size);
  }
  const m = survivorSeedToIndex.size;

  const classifyRaw = (x: number, z: number): number => {
    // The city has a finite extent — Voronoi cells must not bleed past the
    // bbox, or block-grid overshoot would place buildings off the map.
    if (x < minX || x > maxX || z < minZ || z > maxZ) return -1;
    const raw = nearestSeed(seeds, topo, x, z);
    const survivorSeed = remapToSurvivorSeed[raw];
    return survivorSeedToIndex.get(survivorSeed) ?? -1;
  };

  // Pass 2: accumulate stats under the dense survivor indices.
  const acc = Array.from({ length: m }, () => ({
    sumX: 0,
    sumZ: 0,
    count: 0,
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }));
  for (let gx = 0; gx < GRID_STEPS; gx++) {
    for (let gz = 0; gz < GRID_STEPS; gz++) {
      const x = minX + (gx + 0.5) * step;
      const z = minZ + (gz + 0.5) * step;
      const idx = classifyRaw(x, z);
      if (idx < 0) continue;
      const a = acc[idx];
      a.sumX += x;
      a.sumZ += z;
      a.count++;
      if (x < a.minX) a.minX = x;
      if (x > a.maxX) a.maxX = x;
      if (z < a.minZ) a.minZ = z;
      if (z > a.maxZ) a.maxZ = z;
    }
  }

  const stats = acc.map((a) => ({
    centroidX: a.count ? a.sumX / a.count : cx,
    centroidZ: a.count ? a.sumZ / a.count : cz,
    area: a.count * cellArea,
  }));
  const characters = assignCharacters(rng, topo, stats);

  const districts: District[] = acc.map((a, idx) => {
    const character = characters[idx];
    const cardinal = cardinalOf(cx, cz, stats[idx].centroidX, stats[idx].centroidZ);
    return {
      index: idx,
      id: `${cardinal.toLowerCase()}-${character}-${idx}`,
      character,
      displayName: `${CARDINAL_NAMES[cardinal]} ${CHARACTER_TITLE[character]}`,
      seedX: stats[idx].centroidX,
      seedZ: stats[idx].centroidZ,
      centroidX: stats[idx].centroidX,
      centroidZ: stats[idx].centroidZ,
      minX: a.count ? a.minX : cx,
      maxX: a.count ? a.maxX : cx,
      minZ: a.count ? a.minZ : cz,
      maxZ: a.count ? a.maxZ : cz,
      sampleCount: a.count,
      area: stats[idx].area,
      color: CHARACTER_COLOR[character],
    };
  });

  return {
    districts,
    classify: classifyRaw,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

export { CHARACTER_COLOR };
