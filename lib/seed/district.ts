import seedrandom from "seedrandom";
import { CITY_CENTER, type Topology, type Highway } from "./topology";

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

// Grid-first rework — Stage 1 (wiki/notes/plan-grid-first-rework.md). When the
// flag is on, the Voronoi metric switches from squared-Euclidean (round/organic
// cells) to Chebyshev L∞ evaluated in the θ0 frame → rectilinear, map-like seams
// aligned to the downtown grid. We rotate both points by -θ0 about CITY_CENTER,
// then the distance is max(|dx_rot|, |dz_rot|).
//
// Grid-first min-seed spacing factor (× halfExtent). The plan's documented
// default is the same half*0.13 the L2 path uses, re-tuned only reactively if a
// flag-ON seed trips gate1's [6,26] district-count band. The full 20-seed
// flag-ON gate passes at 0.13 (counts land in [11,24]), so no re-tune was
// needed; this stays a single tunable knob should a future seed-set trip it.
const GRID_MIN_DIST_FACTOR = 0.13;

// Squared Chebyshev (L∞) distance between two world points, evaluated in the θ0
// frame (rotate both by -θ0 about CITY_CENTER first). Squared so it composes
// with the existing squared-Euclidean comparisons without a sqrt.
function chebyshevSqInFrame(
  theta0: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const cos = Math.cos(-theta0);
  const sin = Math.sin(-theta0);
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;
  const arx = (ax - cx) * cos - (az - cz) * sin;
  const arz = (ax - cx) * sin + (az - cz) * cos;
  const brx = (bx - cx) * cos - (bz - cz) * sin;
  const brz = (bx - cx) * sin + (bz - cz) * cos;
  const m = Math.max(Math.abs(arx - brx), Math.abs(arz - brz));
  return m * m;
}

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

function placeSeeds(rng: () => number, topo: Topology, useGrid: boolean, theta0: number): Seed[] {
  const { centerX: cx, centerZ: cz, halfExtent: half } = topo;
  const target = 10 + Math.floor(rng() * 15); // 10..24 (merge trims to ~8..24)
  // Same 0.13 factor as the L2 path — NOT wider. The square L∞ exclusion zone
  // is already ~27% larger in area than the L2 circle at equal radius, so L∞
  // naturally limits the district count; no re-tune was needed (flag-ON counts
  // land in [11,24], inside the [6,26] gate, across 20 seeds). Kept as a single
  // knob to re-tune reactively if a future seed-set trips the band.
  const minDist = half * (useGrid ? GRID_MIN_DIST_FACTOR : 0.13);
  const minDistSq = minDist * minDist;
  const seeds: Seed[] = [];
  let attempts = 0;
  while (seeds.length < target && attempts < 1500) {
    attempts++;
    const ang = rng() * Math.PI * 2;
    // Bias radius toward the centre so cores cluster and the periphery is sparse.
    const rad = Math.pow(rng(), 0.7) * half * 0.92;
    const x = cx + Math.cos(ang) * rad;
    const z = cz + Math.sin(ang) * rad;
    const farEnough = useGrid
      ? seeds.every((s) => chebyshevSqInFrame(theta0, s.x, s.z, x, z) > minDistSq)
      : seeds.every((s) => Math.hypot(s.x - x, s.z - z) > minDist);
    if (farEnough) {
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
function nearestSeed(
  seeds: Seed[],
  topo: Topology,
  x: number,
  z: number,
  useGrid: boolean,
  theta0: number,
): number {
  const macro = macroSignature(topo, x, z);
  let best = -1;
  let bestD = Infinity;
  let fallback = -1;
  let fallbackD = Infinity;
  for (let i = 0; i < seeds.length; i++) {
    const d = useGrid
      ? chebyshevSqInFrame(theta0, seeds[i].x, seeds[i].z, x, z)
      : (seeds[i].x - x) ** 2 + (seeds[i].z - z) ** 2;
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

export function generateDistricts(
  masterSeed: string,
  topo: Topology,
  useGrid: boolean = false,
  theta0: number = 0,
): DistrictField {
  const rng = seedrandom(`${masterSeed}::districts`);
  const { centerX: cx, centerZ: cz, halfExtent: half } = topo;
  const seeds = placeSeeds(rng, topo, useGrid, theta0);

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
      rawCount[nearestSeed(seeds, topo, x, z, useGrid, theta0)]++;
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
      const d = useGrid
        ? chebyshevSqInFrame(theta0, seeds[i].x, seeds[i].z, seeds[j].x, seeds[j].z)
        : (seeds[i].x - seeds[j].x) ** 2 + (seeds[i].z - seeds[j].z) ** 2;
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
    const raw = nearestSeed(seeds, topo, x, z, useGrid, theta0);
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

// ---------------------------------------------------------------------------
// Seam streets (issue #33) — TIERED.
// ---------------------------------------------------------------------------
// The full Voronoi boundary network is extracted from the classify grid via
// marching-squares crack-chaining, then only the MAJOR boundaries (long
// through-runs) are promoted to drawn avenues. Real cities join differently-
// oriented grids along a few shared streets — usually one major boundary, often
// diagonal — not a lane per Voronoi edge (wiki/research/map-layout-references.md).
// Minor boundaries stay as the street-width gap footprintInDistrict already
// leaves. Pure + deterministic: reads classify + sampleCount, consumes no RNG.

export const SEAM_STREET_WIDTH = 16;
const SEAM_MIN_CELLS = 4; // clamp: skip seams touching a sub-4-cell district
const SEAM_MIN_LENGTH_FACTOR = 0.3; // promote boundaries longer than half * this
const SEAM_MIN_ANGLE = 0.2; // rad ≈ 11.5° — only where adjacent grids truly clash
const SEAM_MAX = 8; // cap to a handful of major avenues, never a lane per boundary

export type SeamPolyline = {
  id: string;
  vertices: Array<{ x: number; z: number }>;
  width: number;
  closed: boolean;
  districtPair: [number, number];
};

export function seamSegments(
  field: DistrictField,
  districtRot: Map<number, number>,
  maxCount: number = SEAM_MAX,
  minAngle: number = SEAM_MIN_ANGLE,
): SeamPolyline[] {
  if (field.districts.length < 2) return [];
  const { minX, maxX, minZ } = field.bounds;
  const N = GRID_STEPS;
  const step = (maxX - minX) / N;
  const half = (maxX - minX) / 2;

  // Label cache at cell centres — one classify call per cell (matches the grid
  // sampleCount was accumulated on, so the clamp is exact).
  const label = new Int16Array(N * N);
  for (let gx = 0; gx < N; gx++) {
    for (let gz = 0; gz < N; gz++) {
      label[gx * N + gz] = field.classify(minX + (gx + 0.5) * step, minZ + (gz + 0.5) * step);
    }
  }
  const sampleCount = field.districts.map((d) => d.sampleCount);
  const bigEnough = (lab: number) => lab >= 0 && (sampleCount[lab] ?? 0) >= SEAM_MIN_CELLS;

  // Cracks on shared cell edges. Vertex (i,j) = world (minX+i*step, minZ+j*step),
  // i,j in [0,N]; a crack joins two adjacent vertices (the exact L∞ boundary
  // line between two differing cell centres). Tagged with the unordered pair.
  const vKey = (i: number, j: number) => i * (N + 1) + j;
  const pairKey = (p: number, q: number) => (p < q ? p * 100000 + q : q * 100000 + p);
  const cracks: Array<{ a: number; b: number; pair: number }> = [];
  // x-neighbours → vertical boundary line at i = gx+1
  for (let gx = 0; gx < N - 1; gx++) {
    for (let gz = 0; gz < N; gz++) {
      const la = label[gx * N + gz];
      const lb = label[(gx + 1) * N + gz];
      if (la === lb || !bigEnough(la) || !bigEnough(lb)) continue;
      cracks.push({ a: vKey(gx + 1, gz), b: vKey(gx + 1, gz + 1), pair: pairKey(la, lb) });
    }
  }
  // z-neighbours → horizontal boundary line at j = gz+1
  for (let gx = 0; gx < N; gx++) {
    for (let gz = 0; gz < N - 1; gz++) {
      const la = label[gx * N + gz];
      const lb = label[gx * N + gz + 1];
      if (la === lb || !bigEnough(la) || !bigEnough(lb)) continue;
      cracks.push({ a: vKey(gx, gz + 1), b: vKey(gx + 1, gz + 1), pair: pairKey(la, lb) });
    }
  }

  const adj = new Map<number, number[]>();
  for (let ci = 0; ci < cracks.length; ci++) {
    for (const v of [cracks[ci].a, cracks[ci].b]) {
      const l = adj.get(v);
      if (l) l.push(ci);
      else adj.set(v, [ci]);
    }
  }
  const vToXZ = (v: number) => {
    const i = Math.floor(v / (N + 1));
    return { x: minX + i * step, z: minZ + (v - i * (N + 1)) * step };
  };
  // Continue only through a clean degree-2 vertex of the SAME pair — so a seam
  // passes straight/around corners but DEAD-ENDS (T-junction) where a third
  // district meets, never line-matching the neighbour grid.
  const continuation = (v: number, fromCi: number, pair: number): number => {
    const list = adj.get(v);
    if (!list) return -1;
    let other = -1;
    let count = 0;
    for (const ci of list) {
      if (cracks[ci].pair !== pair) continue;
      count++;
      if (ci !== fromCi) other = ci;
    }
    return count === 2 ? other : -1;
  };

  const visited = new Array<boolean>(cracks.length).fill(false);
  const collected: Array<{ poly: SeamPolyline; len: number }> = [];
  let sid = 0;
  for (let start = 0; start < cracks.length; start++) {
    if (visited[start]) continue;
    visited[start] = true;
    const pair = cracks[start].pair;
    const chain: number[] = [cracks[start].a, cracks[start].b];
    // Walk forward from b, then backward from a, through degree-2 same-pair vertices.
    let curV = cracks[start].b;
    let curCi = start;
    let closedLoop = false;
    for (;;) {
      const next = continuation(curV, curCi, pair);
      if (next < 0 || visited[next]) break;
      visited[next] = true;
      const far = cracks[next].a === curV ? cracks[next].b : cracks[next].a;
      chain.push(far);
      curV = far;
      curCi = next;
      if (curV === cracks[start].a) {
        closedLoop = true;
        break;
      }
    }
    if (!closedLoop) {
      curV = cracks[start].a;
      curCi = start;
      for (;;) {
        const next = continuation(curV, curCi, pair);
        if (next < 0 || visited[next]) break;
        visited[next] = true;
        const far = cracks[next].a === curV ? cracks[next].b : cracks[next].a;
        chain.unshift(far);
        curV = far;
        curCi = next;
      }
    }
    if (closedLoop) chain.pop(); // drop the duplicate closing vertex

    // Collinear-merge (lossless on the rectilinear grid) + to world.
    const pts = chain.map(vToXZ);
    const merged: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && i < pts.length - 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const c = pts[i + 1];
        const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
        if (Math.abs(cross) < 1e-6 * step * step) continue;
      }
      merged.push(pts[i]);
    }
    // Closed loops: the chain ends are cyclic neighbours, so also drop a
    // collinear join (the linear pass above never tests the two endpoints).
    if (closedLoop) {
      while (merged.length >= 3) {
        const a = merged[merged.length - 1];
        const b = merged[0];
        const c = merged[1];
        if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-6 * step * step)
          merged.shift();
        else break;
      }
      while (merged.length >= 3) {
        const a = merged[merged.length - 2];
        const b = merged[merged.length - 1];
        const c = merged[0];
        if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-6 * step * step)
          merged.pop();
        else break;
      }
    }
    let len = 0;
    for (let i = 1; i < merged.length; i++) {
      len += Math.hypot(merged[i].x - merged[i - 1].x, merged[i].z - merged[i - 1].z);
    }
    // Closed loops: count the closing segment too, so the tier length is correct.
    if (closedLoop && merged.length >= 2) {
      len += Math.hypot(
        merged[0].x - merged[merged.length - 1].x,
        merged[0].z - merged[merged.length - 1].z,
      );
    }
    const da = Math.floor(pair / 100000);
    const db = pair % 100000;
    collected.push({
      poly: {
        id: `seam-${sid++}`,
        vertices: merged,
        width: SEAM_STREET_WIDTH,
        closed: closedLoop,
        districtPair: [da, db],
      },
      len,
    });
  }

  // Tier: a seam street is warranted only where two adjacent grids genuinely
  // CLASH in orientation (a reconciling avenue, like SF's Market St) AND the
  // boundary is a long through-run. Cap to the few longest so the result reads
  // as a handful of major avenues, not a lane per Voronoi edge.
  const angDiff = (a: number, b: number) => {
    let d = Math.abs(a - b) % Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    return d;
  };
  const minLen = half * SEAM_MIN_LENGTH_FACTOR;
  return collected
    .filter((c) => {
      if (c.poly.vertices.length < 2 || c.len < minLen) return false;
      const ra = districtRot.get(c.poly.districtPair[0]);
      const rb = districtRot.get(c.poly.districtPair[1]);
      return ra !== undefined && rb !== undefined && angDiff(ra, rb) >= minAngle;
    })
    .sort((a, b) => b.len - a.len)
    .slice(0, maxCount)
    .map((c, i) => ({ ...c.poly, id: `seam-${i}` }));
}

export { CHARACTER_COLOR };
