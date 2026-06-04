import seedrandom from "seedrandom";
import { type Topology, genScale } from "./topology";

// District field for the tensor city. Districts are derived FROM the arterial
// network (see generateDistrictsFromNetwork): arterials are hard walls, a
// flood-fill groups the gaps, and character is assigned by distance-to-centre.

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

// Serialisable core of the classify lookup (#59): the dense per-cell label grid
// plus its exact geometry. `classify` is a closure and cannot cross a worker
// boundary (structured clone drops functions) — transferring the raster and
// rebuilding via districtFieldFromRaster yields a byte-identical classify.
export type DistrictRaster = {
  label: Int16Array;
  n: number; // raster steps per axis
  step: number; // cell size (m) — stored, not re-derived, so FP math matches exactly
};

export type DistrictField = {
  districts: District[];
  // World point → district index, or -1 if it lands on a dropped micro-cell.
  classify: (x: number, z: number) => number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  raster: DistrictRaster;
};

// Build the classify closure from the raster — the ONE implementation, used by
// both generateDistrictsFromNetwork and the worker-side reconstruction, so the
// two can never drift.
function makeClassify(
  bounds: DistrictField["bounds"],
  raster: DistrictRaster,
): (x: number, z: number) => number {
  const { minX, maxX, minZ, maxZ } = bounds;
  const { label, n, step } = raster;
  const clampG = (g: number) => (g < 0 ? 0 : g > n - 1 ? n - 1 : g);
  return (x: number, z: number): number => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return -1;
    const gx = clampG(Math.floor((x - minX) / step));
    const gz = clampG(Math.floor((z - minZ) / step));
    return label[gx * n + gz];
  };
}

// Reconstruct a DistrictField from its serialisable parts (#59) — the worker
// posts {districts, bounds, raster}; the main thread rebuilds the closure.
export function districtFieldFromRaster(
  districts: District[],
  bounds: DistrictField["bounds"],
  raster: DistrictRaster,
): DistrictField {
  return { districts, bounds, raster, classify: makeClassify(bounds, raster) };
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

// Absolute radial bands (metres) for the character pass. The high-rise core is
// PINNED to a compact footprint that does NOT grow with the city — Clark's Law
// (1951): population/built density declines ~exponentially from the CBD, and real
// downtowns stay ~1–2 km across even in huge metros. Residential is "everything
// past the belt", so the bulk of a large city is low-density and grows with it.
// These are absolute world metres, independent of MAX_HALF_EXTENT, so they stay
// correct under any crop or per-device extent tier (#53).
const R_DOWNTOWN = 650; // primary CBD core radius
const R_SUBCENTRE = 1150; // secondary dense band (subcentres live here)
const R_MIXED = 1900; // transition belt → mixed-use; beyond this → residential
const MAX_SUBCENTRES = 2; // few secondary clusters (was 1+⌊n/5⌋ ≈ 3–5, which blanketed the core)

// Deterministic character pass driven by ABSOLUTE distance-to-centre bands (#49).
function assignCharacters(
  rng: () => number,
  topo: Topology,
  stats: Array<{ centroidX: number; centroidZ: number; area: number }>,
): DistrictCharacter[] {
  const cx = topo.centerX;
  const cz = topo.centerZ;
  const n = stats.length;
  const dist = stats.map((s, i) => ({
    i,
    d: Math.hypot(s.centroidX - cx, s.centroidZ - cz),
    area: s.area,
  }));
  const order = [...dist].sort((a, b) => a.d - b.d);
  const maxD = order.length ? order[order.length - 1].d : 1;

  const chars = new Array<DistrictCharacter>(n).fill("residential");
  const assigned = new Set<number>();

  // 1. Downtown — the closest district is always the primary CBD; any further
  //    district whose centroid still falls inside the core radius joins it.
  chars[order[0].i] = "downtown";
  assigned.add(order[0].i);

  // 2. Heritage — the smaller of the 2nd/3rd closest (a dense old core beside
  //    downtown). ~70% of cities have one. Assigned before the core sweep so it
  //    survives even when it sits inside R_DOWNTOWN.
  if (n >= 3 && rng() < 0.7) {
    const candidates = order.slice(1, 3).sort((a, b) => a.area - b.area);
    chars[candidates[0].i] = "heritage";
    assigned.add(candidates[0].i);
  }

  // 3a. Core sweep — remaining districts inside R_DOWNTOWN are downtown-class.
  for (const o of dist) {
    if (!assigned.has(o.i) && o.d < R_DOWNTOWN) {
      chars[o.i] = "downtown";
      assigned.add(o.i);
    }
  }

  // 3b. Subcentres — the LARGEST unassigned districts in the subcentre band
  //     (a subcentre is a big secondary cluster, not merely "next closest"),
  //     capped few so the high-rise footprint stays compact.
  const subCand = dist
    .filter((o) => !assigned.has(o.i) && o.d >= R_DOWNTOWN && o.d < R_SUBCENTRE)
    .sort((a, b) => b.area - a.area);
  for (let s = 0; s < Math.min(MAX_SUBCENTRES, subCand.length); s++) {
    chars[subCand[s].i] = "subcentre";
    assigned.add(subCand[s].i);
  }

  // 4. Industrial — a thin fringe at the rim (furthest districts past half the
  //    outer radius: docks / yards on the edge). Scales gently with city size.
  const industrialTarget = Math.max(1, Math.round(n * 0.08));
  let industrialAssigned = 0;
  for (let k = order.length - 1; k >= 0 && industrialAssigned < industrialTarget; k--) {
    const o = order[k];
    if (!assigned.has(o.i) && o.d > maxD * 0.5) {
      chars[o.i] = "industrial";
      assigned.add(o.i);
      industrialAssigned++;
    }
  }

  // 5. Remaining by absolute band: a mixed-use transition belt inside R_MIXED,
  //    else residential — the low-density bulk that fills the rest of the city.
  for (const o of dist) {
    if (assigned.has(o.i)) continue;
    chars[o.i] = o.d < R_MIXED ? "mixed-use" : "residential";
  }

  return chars;
}

// ---------------------------------------------------------------------------
// Network-aligned districts (tensor path) — replaces the free-floating Voronoi.
// ---------------------------------------------------------------------------
// In a real city, district boundaries ARE arterials: the superblock model puts
// commercial/dense uses on the arterials that bound a block and residential
// uses inside, and NYC zoning runs district edges along street centrelines
// (NYC ZR 76-141). So instead of dropping seed points and carving Voronoi cells
// that float across the roads, we derive districts FROM the finished road
// network: rasterise the arterials + highway as hard WALLS, flood-fill the gaps
// (minor streets are passable, so one district spans several street blocks),
// merge slivers, then assign character by distance-to-centre rank exactly as
// the Voronoi path did. classify() stays an O(1) Int16Array lookup, so every
// caller (cityGen fill, lighting, streetlights, the /plan + scene overlays) is
// untouched. Pure geometry + the one existing seeded character pass → fully
// deterministic (no RNG in the flood-fill / merge steps).

type NetRoad = { vertices: Array<{ x: number; z: number }>; width: number; closed: boolean };

// Raster steps/axis — keyed to the gen extent (tier); ~7.5m cells at any tier.
// A function (not a module const) so the tier can change at runtime.
const netGridSteps = () => Math.round(200 * genScale());
const NET_MIN_DISTRICTS = 6; // never merge below this (gate1's floor is 6)
const NET_MAX_DISTRICTS = 48; // hard safety ceiling (gate1's cap is 48)
// A district must clear this ABSOLUTE area or it's a sliver → merged into a
// neighbour. Absolute (not a fraction of the map) so district SIZE stays roughly
// constant across extents and the COUNT scales with the city (#49): at Metro the
// old 0.045·mapArea floor was ~1.6 km², which collapsed the map to ~10 giant
// districts. A district is still a *group* of superblocks, and the count varies by
// seed. This (not the cap) is the primary control.
const TARGET_MIN_DISTRICT_AREA = 360_000; // m² (~0.36 km²)
const NET_MIN_AREA_FRACTION_MAX = 0.045; // clamp for small extents (per-device tiers, #53)
const NET_WALL_PAD = 0.6; // wall half-band = width/2 + PAD·step, so the raster wall
// is ≥1 cell thick on both sides of any diagonal and a 4-connected flood can't leak across it.

function pointSegDist(
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

export function generateDistrictsFromNetwork(
  masterSeed: string,
  walls: NetRoad[],
  topo: Topology,
): DistrictField {
  const { centerX: cx, centerZ: cz, halfExtent: half } = topo;
  const minX = cx - half;
  const maxX = cx + half;
  const minZ = cz - half;
  const maxZ = cz + half;
  const N = netGridSteps();
  const total = N * N;
  const step = (2 * half) / N;
  const cellArea = step * step;
  const clampG = (g: number) => (g < 0 ? 0 : g > N - 1 ? N - 1 : g);

  // 1. Rasterise the wall network. A cell is a wall if any arterial/highway
  //    segment passes within (half-width + pad) of its centre.
  const isWall = new Uint8Array(total);
  for (const r of walls) {
    const v = r.vertices;
    if (v.length < 2) continue;
    const last = r.closed ? v.length : v.length - 1;
    const rad = r.width / 2 + NET_WALL_PAD * step;
    for (let i = 0; i < last; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      const loGx = clampG(Math.floor((Math.min(a.x, b.x) - rad - minX) / step));
      const hiGx = clampG(Math.ceil((Math.max(a.x, b.x) + rad - minX) / step));
      const loGz = clampG(Math.floor((Math.min(a.z, b.z) - rad - minZ) / step));
      const hiGz = clampG(Math.ceil((Math.max(a.z, b.z) + rad - minZ) / step));
      for (let gx = loGx; gx <= hiGx; gx++) {
        const wx = minX + (gx + 0.5) * step;
        for (let gz = loGz; gz <= hiGz; gz++) {
          const wz = minZ + (gz + 0.5) * step;
          if (pointSegDist(wx, wz, a.x, a.z, b.x, b.z) <= rad) isWall[gx * N + gz] = 1;
        }
      }
    }
  }

  // 2. Flood-fill the non-wall cells (4-connectivity) into raw components.
  const label = new Int32Array(total).fill(-1);
  let K = 0;
  const stack: number[] = [];
  for (let s = 0; s < total; s++) {
    if (isWall[s] || label[s] >= 0) continue;
    label[s] = K;
    stack.length = 0;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop() as number;
      const gx = Math.floor(c / N);
      const gz = c - gx * N;
      if (gx > 0 && !isWall[c - N] && label[c - N] < 0) {
        label[c - N] = K;
        stack.push(c - N);
      }
      if (gx < N - 1 && !isWall[c + N] && label[c + N] < 0) {
        label[c + N] = K;
        stack.push(c + N);
      }
      if (gz > 0 && !isWall[c - 1] && label[c - 1] < 0) {
        label[c - 1] = K;
        stack.push(c - 1);
      }
      if (gz < N - 1 && !isWall[c + 1] && label[c + 1] < 0) {
        label[c + 1] = K;
        stack.push(c + 1);
      }
    }
    K++;
  }
  // Degenerate guard: walls covered everything → one district over the map.
  if (K === 0) {
    label.fill(0);
    K = 1;
  }

  // 3. Multi-source BFS: flood the component labels OUT into the wall cells so
  //    every in-bounds cell ends up owned by its nearest district — the
  //    boundaries then sit on the arterial medians.
  const full = Int32Array.from(label);
  const queue = new Int32Array(total);
  let qh = 0;
  let qt = 0;
  for (let s = 0; s < total; s++) if (full[s] >= 0) queue[qt++] = s;
  while (qh < qt) {
    const c = queue[qh++];
    const lab = full[c];
    const gx = Math.floor(c / N);
    const gz = c - gx * N;
    if (gx > 0 && full[c - N] < 0) {
      full[c - N] = lab;
      queue[qt++] = c - N;
    }
    if (gx < N - 1 && full[c + N] < 0) {
      full[c + N] = lab;
      queue[qt++] = c + N;
    }
    if (gz > 0 && full[c - 1] < 0) {
      full[c - 1] = lab;
      queue[qt++] = c - 1;
    }
    if (gz < N - 1 && full[c + 1] < 0) {
      full[c + 1] = lab;
      queue[qt++] = c + 1;
    }
  }

  // Cell count per raw component (post wall-fill) + adjacency strength between
  // components (shared boundary length), used to merge slivers into neighbours.
  const count = new Array<number>(K).fill(0);
  for (let s = 0; s < total; s++) count[full[s]]++;
  const baseAdj = new Map<number, Map<number, number>>();
  const addAdj = (a: number, b: number) => {
    if (a === b) return;
    let ma = baseAdj.get(a);
    if (!ma) baseAdj.set(a, (ma = new Map()));
    ma.set(b, (ma.get(b) ?? 0) + 1);
    let mb = baseAdj.get(b);
    if (!mb) baseAdj.set(b, (mb = new Map()));
    mb.set(a, (mb.get(a) ?? 0) + 1);
  };
  for (let gx = 0; gx < N; gx++) {
    for (let gz = 0; gz < N; gz++) {
      const c = gx * N + gz;
      const la = full[c];
      if (gx < N - 1) {
        const lb = full[c + N];
        if (lb !== la) addAdj(la, lb);
      }
      if (gz < N - 1) {
        const lb = full[c + 1];
        if (lb !== la) addAdj(la, lb);
      }
    }
  }

  // 4. Union-find merge: collapse the smallest component into its strongest-
  //    bordering neighbour until we're under the cap and no sliver remains,
  //    but never below the floor. Deterministic (size/argmax ties → lowest id).
  const parent = Array.from({ length: K }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const rootSizes = (): Map<number, number> => {
    const m = new Map<number, number>();
    for (let i = 0; i < K; i++) {
      const r = find(i);
      m.set(r, (m.get(r) ?? 0) + count[i]);
    }
    return m;
  };
  // Sliver floor in CELLS: an absolute target area (÷ cellArea), clamped so a
  // small extent can't demand a district bigger than 4.5% of its own map.
  const minArea = Math.min(total * NET_MIN_AREA_FRACTION_MAX, TARGET_MIN_DISTRICT_AREA / cellArea);
  for (;;) {
    const sizes = rootSizes();
    if (sizes.size <= NET_MIN_DISTRICTS) break;
    let small = -1;
    let smallSize = Infinity;
    for (const [r, sz] of sizes) {
      if (sz < smallSize) {
        smallSize = sz;
        small = r;
      }
    }
    const tooSmall = smallSize < minArea;
    if (sizes.size <= NET_MAX_DISTRICTS && !tooSmall) break;
    // Strongest live neighbour of `small`, summing adjacency across its members.
    const nbWeight = new Map<number, number>();
    for (let i = 0; i < K; i++) {
      if (find(i) !== small) continue;
      const m = baseAdj.get(i);
      if (!m) continue;
      for (const [j, w] of m) {
        const rj = find(j);
        if (rj === small) continue;
        nbWeight.set(rj, (nbWeight.get(rj) ?? 0) + w);
      }
    }
    let best = -1;
    let bestW = -1;
    for (const [r, w] of nbWeight) {
      if (w > bestW) {
        bestW = w;
        best = r;
      }
    }
    if (best < 0) break; // isolated (shouldn't happen) — avoid an infinite loop
    parent[small] = best;
  }

  // 5. Re-index survivors to a dense 0..M-1 range (stable: ascending root id).
  const liveRoots = Array.from(new Set(Array.from({ length: K }, (_, i) => find(i)))).sort(
    (a, b) => a - b,
  );
  const rootToDense = new Map<number, number>();
  liveRoots.forEach((r, d) => rootToDense.set(r, d));
  const M = liveRoots.length;
  const denseOf = (origLabel: number) => rootToDense.get(find(origLabel)) ?? 0;

  // Dense per-cell label → the O(1) classify lookup table.
  const denseLabel = new Int16Array(total);
  for (let s = 0; s < total; s++) denseLabel[s] = denseOf(full[s]);

  // 6. Stats under the dense indices (centroid, bbox, area).
  const acc = Array.from({ length: M }, () => ({
    sumX: 0,
    sumZ: 0,
    count: 0,
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }));
  for (let gx = 0; gx < N; gx++) {
    for (let gz = 0; gz < N; gz++) {
      const d = denseLabel[gx * N + gz];
      const x = minX + (gx + 0.5) * step;
      const z = minZ + (gz + 0.5) * step;
      const a = acc[d];
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

  // 7. Character pass — identical rule + RNG key as the Voronoi path.
  const rng = seedrandom(`${masterSeed}::districts`);
  const characters = assignCharacters(rng, topo, stats);

  const raster: DistrictRaster = { label: denseLabel, n: N, step };
  const classify = makeClassify({ minX, maxX, minZ, maxZ }, raster);

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

  return { districts, classify, bounds: { minX, maxX, minZ, maxZ }, raster };
}

export { CHARACTER_COLOR };
