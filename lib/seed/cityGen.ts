import seedrandom from "seedrandom";
import { generateTopology, type Topology, type Highway } from "./topology";
import {
  generateDistrictsFromNetwork,
  type District,
  type DistrictCharacter,
  type DistrictField,
} from "./district";
import { buildSilhouette, isHighRise, type SilhouetteField } from "./silhouette";
import { generateTensorStreets } from "./tensorStreets";
import { type RoadPoly } from "./streets";

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
  arterials: RoadPoly[];
  // Minor (local) streets. The /plan overlay + streetlights draw these.
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
  return buildTensorRoads(rawSeed).field;
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
    streets: minorStreets,
  };
}

// generateCity / generateStreetlights are pure functions of the seed, but the
// 3D scene renders ~5 components off the same seed — memoise (bounded) so the
// tensor field is traced once per seed, not once per component.
const cityCache = new Map<string, CityData>();
const lightsCache = new Map<string, Streetlight[]>();

export function generateCity(rawSeed: string): CityData {
  const hit = cityCache.get(rawSeed);
  if (hit) return hit;
  const result = generateCityTensor(rawSeed);
  if (cityCache.size > 64) cityCache.clear();
  cityCache.set(rawSeed, result);
  return result;
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

// Modern-LED streetlight temps (decision note §Streetlight planning):
//   highway + arterial → 4000K uniform; local → flat 3300K for now.
//   Per-district local temps + variant bulbs are planned — see #42.
const HIGHWAY_KELVIN = 4000;
const ARTERIAL_KELVIN = 4000;
const FAILURE_RATE = 0.025; // fraction of local lights that flicker as failing

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
  // Walk arc-length across the WHOLE polyline, dropping a light every `spacing`
  // metres. Tensor roads are RK4-sampled at ~4m, so a per-segment emitter would
  // never fire (spacing >> segment length) — accumulate across the segment seams.
  let acc = 0; // arc-length up to vertex i
  let nextAt = spacing; // arc-length of the next light to place
  for (let i = 0; i < last; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen === 0) continue;
    const ux = (b.x - a.x) / segLen;
    const uz = (b.z - a.z) / segLen;
    const nx = -uz;
    const nz = ux;
    while (nextAt <= acc + segLen) {
      const s = nextAt - acc; // distance into this segment
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
      nextAt += spacing;
    }
    acc += segLen;
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

export function generateStreetlights(rawSeed: string): Streetlight[] {
  const hit = lightsCache.get(rawSeed);
  if (hit) return hit;
  const result = generateStreetlightsTensor(rawSeed);
  if (lightsCache.size > 64) lightsCache.clear();
  lightsCache.set(rawSeed, result);
  return result;
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
  const { buildings } = generateCity(rawSeed);
  const rng = seedrandom(`${rawSeed}::beacons`);
  const beacons: AviationBeacon[] = [];
  for (const b of buildings) {
    if (b.height < BEACON_MIN_HEIGHT) continue;
    beacons.push({ x: b.x, y: b.height + 3, z: b.z, phase: rng() });
  }
  return beacons;
}
