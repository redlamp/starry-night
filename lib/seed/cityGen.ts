import seedrandom from "seedrandom";
import { generateTopology, maxHalfExtent, genScale, type Topology, type Highway } from "./topology";
import {
  generateDistrictsFromNetwork,
  districtFieldFromRaster,
  type District,
  type DistrictCharacter,
  type DistrictField,
  type DistrictRaster,
} from "./district";
import { buildSilhouette, isHighRise, type SilhouetteField } from "./silhouette";
import { generateTensorStreets, type StreetTraceHook } from "./tensorStreets";
import { type RoadPoly } from "./streets";
import {
  resolveCityShape,
  makeShapeMask,
  type CityShapeSetting,
  type ShapeMask,
} from "./cityShape";
import { citySketchTensor, sketchKey } from "./citySketch";
import { fieldDeviation } from "./tensorField";
import { buildDensityField, buildDevelopmentMask, suburbAmount } from "./density";

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
  // 0 = core fabric (unchanged mix), 1 = fully suburban/rural (#49). Only the
  // residential / mixed-use branch reads it — one rng draw either way, so the
  // stream stays aligned for every other consumer.
  suburb = 0,
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
    // Suburban tilt (#49): thresholds slide from the urban mix toward
    // low-rise-dominated (the Stage-0 review: density picks SMALLER archetypes
    // toward the edge — homes and corner shops, the odd strip mall; towers
    // vanish). At suburb=0 the numbers are exactly the pre-#49 mix.
    const a = 0.1 - 0.08 * suburb; // residential-tower
    const b = 0.45 - 0.27 * suburb; // mid-rise
    const c = 0.8 + 0.1 * suburb; // low-rise (rest: warehouse/strip-mall)
    if (r < a) return "residential-tower";
    if (r < b) return "mid-rise";
    if (r < c) return "low-rise";
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

// #13: overall bearing of a road (endpoint to endpoint), folded to [0, π) —
// promotion wants DIVERSE bearings so the freeway network criss-crosses
// instead of stacking parallel routes.
function bearingOf(r: { vertices: Array<{ x: number; z: number }> }): number {
  const v = r.vertices;
  const th = Math.atan2(v[v.length - 1].z - v[0].z, v[v.length - 1].x - v[0].x);
  return ((th % Math.PI) + Math.PI) % Math.PI;
}

function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

// Two candidates trace the SAME corridor when they run nearly parallel AND
// nearly on top of each other — a promotion exclusion (#13). Crossing,
// diagonal, and offset-parallel routes are all legitimate freeway layouts;
// the angles a city gets are whatever its field morphology produces.
const CORRIDOR_BEARING = (10 * Math.PI) / 180;

// Freeways need freeway curvature (#13): reject a candidate if any ~200m
// stretch turns more than ~35° (≈ 330m minimum radius). This is what stops a
// streamline that grazes a RADIAL plaza from being promoted — the field yanks
// it around the centre in a tight arc no real freeway would take — while a
// gentle beltway sweep (large radius) still qualifies. The global 250·turn
// score penalty can't catch this: a very long route can absorb one sharp bend.
const HW_TURN_WINDOW_M = 200;
const HW_MAX_WINDOW_TURN = (35 * Math.PI) / 180;

function maxWindowTurn(r: { vertices: Array<{ x: number; z: number }> }, windowM: number): number {
  const v = r.vertices;
  if (v.length < 3) return 0;
  // Unwrapped cumulative heading + arc length per segment, then the max net
  // heading change across any window of `windowM` metres (two pointers).
  const heads: number[] = [];
  const lens: number[] = [];
  let acc = 0;
  let prev = 0;
  let unwrapped = 0;
  for (let i = 1; i < v.length; i++) {
    const h = Math.atan2(v[i].z - v[i - 1].z, v[i].x - v[i - 1].x);
    if (i === 1) {
      unwrapped = h;
    } else {
      let d = h - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      unwrapped += d;
    }
    prev = h;
    acc += Math.hypot(v[i].x - v[i - 1].x, v[i].z - v[i - 1].z);
    heads.push(unwrapped);
    lens.push(acc);
  }
  let maxTurn = 0;
  let j = 0;
  for (let i = 0; i < heads.length; i++) {
    while (lens[i] - lens[j] > windowM) j++;
    const t = Math.abs(heads[i] - heads[j]);
    if (t > maxTurn) maxTurn = t;
  }
  return maxTurn;
}

// Shared tensor road build (used by both the city + streetlight tensor paths so
// they agree). Ring-like arterials are demoted to minor STREETS (a circular road
// should be a street, never an arterial/highway). The highway is the longest,
// largely-straight arterial that spans the map; the old random-tilt topology
// highways are dropped (out of place against the tensor flow). Districts still
// use the raw topology for their macro regions (the character overlay).
function buildTensorRoadsImpl(masterSeed: string, onLine?: StreetTraceHook) {
  const rawTopo = dropRadialSpokes(generateTopology(masterSeed));
  // The tensor streamlines only need the city extent — districts are derived
  // FROM the finished network below, not the other way round. This base network
  // is always the full square; the organic footprint (#14) is a post-filter mask
  // applied in generateCity, so the central layout is identical across shapes.
  const bounds = {
    minX: rawTopo.centerX - rawTopo.halfExtent,
    maxX: rawTopo.centerX + rawTopo.halfExtent,
    minZ: rawTopo.centerZ - rawTopo.halfExtent,
    maxZ: rawTopo.centerZ + rawTopo.halfExtent,
  };
  // #40: a registered sketch replaces the seeded basis field AND becomes the
  // street mask (its ink is the footprint). Everything downstream — district
  // walls, flood-fill, frontage buildings, streetlights — derives from these
  // roads, so the whole city follows the sketch with no further changes.
  const sketch = citySketchTensor();
  const gen = generateTensorStreets(
    masterSeed,
    bounds,
    sketch ? sketch.mask : undefined,
    onLine,
    sketch ? sketch.field : undefined,
  );

  const ringArts = gen.arterials.filter((a) => totalTurn(a) >= RING_TURN);
  const arterials = gen.arterials.filter((a) => totalTurn(a) < RING_TURN);
  const minorStreets: RoadPoly[] = [
    ...gen.minorStreets,
    ...ringArts.map((r, i) => ({ ...r, id: `minor-ring-${i}`, width: 9, tier: "minor" as const })),
  ];

  // #13 Phase 1: promote a freeway network with PER-SEED character. The tier
  // sets a ceiling (town 1 / city 2 / metro 3); the seed rolls the actual count
  // — a small town can have no freeway at all, a metro always has at least one.
  // Candidates are the long, largely-straight arterials by score; the only
  // exclusion is a same-corridor dedupe, so the angles between routes are
  // whatever the field morphology gives (criss-cross, diagonal, parallel pair).
  // Districts are unaffected: walls below are the highways+arterials UNION,
  // identical whichever bucket a road lands in.
  const hwCeil = Math.min(3, Math.max(1, Math.round(genScale() * 0.75)));
  const hwRoll = seedrandom(`${masterSeed}::tensor::highways`)();
  const targetHighways =
    hwCeil <= 1
      ? hwRoll < 0.35
        ? 0
        : 1
      : hwCeil === 2
        ? hwRoll < 0.15
          ? 0
          : hwRoll < 0.55
            ? 1
            : 2
        : hwRoll < 0.25
          ? 1
          : hwRoll < 0.6
            ? 2
            : 3;
  const candidates = arterials
    .map((a) => ({ a, score: roadLength(a) - 250 * totalTurn(a), bearing: bearingOf(a) }))
    .filter(
      (c) =>
        roadLength(c.a) > 700 &&
        c.score > 0 &&
        // freeway-grade curvature only — see maxWindowTurn (radial-plaza guard)
        maxWindowTurn(c.a, HW_TURN_WINDOW_M) <= HW_MAX_WINDOW_TURN,
    )
    .sort((p, q) => q.score - p.score);
  const corridorDist = maxHalfExtent() * 0.3;
  const midOf = (r: RoadPoly) => r.vertices[Math.floor(r.vertices.length / 2)];
  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.length >= targetHighways) break;
    const m = midOf(c.a);
    const sameCorridor = picked.some(
      (p) =>
        bearingDiff(p.bearing, c.bearing) < CORRIDOR_BEARING &&
        Math.hypot(midOf(p.a).x - m.x, midOf(p.a).z - m.z) < corridorDist,
    );
    if (!sameCorridor) picked.push(c);
  }
  const pickedIds = new Set(picked.map((p) => p.a.id));
  const highways: Highway[] = picked.map((p, i) => ({
    id: `highway-${i}`,
    closed: false,
    vertices: p.a.vertices,
    width: 28,
    tier: "highway",
  }));
  const outArterials = arterials.filter((a) => !pickedIds.has(a.id));

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
// All gen caches key on the CURRENT tier extent (#58) — a tier switch generates
// a different city for the same seed, so a stale entry must never be served.
const tensorRoadsCache = new Map<string, ReturnType<typeof buildTensorRoadsImpl>>();
function buildTensorRoads(masterSeed: string, onLine?: StreetTraceHook) {
  const key = `${masterSeed}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}`;
  const hit = tensorRoadsCache.get(key);
  if (hit) return hit; // warm cache → nothing streams (the result lands at once anyway)
  const result = buildTensorRoadsImpl(masterSeed, onLine);
  if (tensorRoadsCache.size > 64) tensorRoadsCache.clear();
  tensorRoadsCache.set(key, result);
  return result;
}

// The tensor city's district field, exposed so the /plan + scene overlays draw
// the SAME districts the buildings were derived from (no separate Voronoi pass).
// Shape-independent: the field is the full square; shapes clip the output.
export function tensorDistrictField(rawSeed: string): DistrictField {
  return buildTensorRoads(rawSeed).field;
}

// --- #59 worker transfer: serialisable bundle + cache priming ----------------
// generateCity's heavy work runs in a Web Worker; structured clone drops the
// one closure in the pipeline (DistrictField.classify), so the worker posts the
// field's raster and the main thread reconstructs it. Priming writes the SAME
// module caches the synchronous path uses, so every existing consumer
// (generateCity / tensorDistrictField / generateStreetlights / overlays) hits a
// warm cache unchanged — the worker is purely a scheduling change.

export type CityBundle = {
  roads: {
    topology: Topology;
    arterials: RoadPoly[];
    minorStreets: RoadPoly[];
    districts: DistrictField["districts"];
    bounds: DistrictField["bounds"];
    raster: DistrictRaster;
  };
  city: CityData;
  lights: Streetlight[];
};

// Worker-side: run the full pipeline (current tier) and flatten to plain data.
// `onLine` (#59 streaming) fires per accepted streamline DURING the road trace —
// emit-only, so a hooked run is byte-identical; silent when the cache is warm.
export function buildCityBundle(
  rawSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
  onLine?: StreetTraceHook,
): CityBundle {
  const { topology, field, arterials, minorStreets } = buildTensorRoads(rawSeed, onLine);
  return {
    roads: {
      topology,
      arterials,
      minorStreets,
      districts: field.districts,
      bounds: field.bounds,
      raster: field.raster,
    },
    city: generateCity(rawSeed, shape, shapeScale),
    lights: generateStreetlights(rawSeed, shape, shapeScale),
  };
}

// Main-thread-side: seed the module caches from a worker-built bundle. Keys use
// the CURRENT tier extent — the caller must only prime a bundle generated for
// the tier the main thread is on (the client matches request/response by key).
export function primeCityCaches(
  rawSeed: string,
  shape: CityShapeSetting,
  shapeScale: number,
  bundle: CityBundle,
): void {
  const { roads, city, lights } = bundle;
  const field = districtFieldFromRaster(roads.districts, roads.bounds, roads.raster);
  const roadsKey = `${rawSeed}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}`;
  if (tensorRoadsCache.size > 64) tensorRoadsCache.clear();
  tensorRoadsCache.set(roadsKey, {
    topology: roads.topology,
    field,
    arterials: roads.arterials,
    minorStreets: roads.minorStreets,
  });
  const key = `${rawSeed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}`;
  if (cityCache.size > 64) cityCache.clear();
  cityCache.set(key, city);
  if (lightsCache.size > 64) lightsCache.clear();
  lightsCache.set(key, lights);
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
  // #49 density gradient: per-district development density + the block-coherent
  // dropout mask. Both are pure functions of (seed, field) — rebuilt here, never
  // cached, so the worker path (#59) needs no new transfer.
  const density = buildDensityField(masterSeed, field);
  const devMask = buildDevelopmentMask(masterSeed);
  // Suburban buildings shrink as density falls — the Stage-0 review's "smaller
  // archetypes toward the edge". Footprint AND height scale, so window grids
  // (cols/floors derive from dims) follow automatically.
  const SUBURB_SHRINK = 0.28;
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

        // #49: block-coherent dropout. A dropped development cell places
        // nothing — the gap is a whole parcel, not a missing tooth in a row.
        const localDensity = density.byIndex[idx] ?? density.radial.at(sx, sz);
        if (!devMask.keepAt(sx, sz, localDensity)) {
          i += 3;
          continue;
        }
        const suburb = suburbAmount(localDensity);

        const prox = coreProx(sx, sz);
        const archetype = pickArchetype(rng, character, prox, suburb);
        const dims = dimensionsForArchetype(archetype, rng);
        if (suburb > 0 && (character === "residential" || character === "mixed-use")) {
          const s = 1 - SUBURB_SHRINK * suburb;
          dims.width *= s;
          dims.depth *= s;
          dims.height *= s;
        }
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

  // --- #50: interior fill --------------------------------------------------
  // Frontage rows leave block HEARTS empty (visible holes in residential /
  // industrial superblocks). Second pass: scan a jittered grid over the
  // district bounds and drop road-ALIGNED buildings in the interior band —
  // beyond the frontage row (≥18m off the kerb network) but still inside a
  // block (≤55m; past that is roadless fringe, which stays empty). Density is
  // per-character (industrial yards fill hardest, heritage courts stay airy).
  // Own rng stream so the frontage rows above are byte-identical to pre-#50.
  // Same corridor + overlap gates as frontage (shared bIndex), so gate1's
  // road-hit / overlap asserts hold.
  const INTERIOR_NEAR = 18;
  const INTERIOR_FAR = 55;
  const INTERIOR_DENSITY: Record<DistrictCharacter, number> = {
    downtown: 0.4,
    subcentre: 0.4,
    heritage: 0.3,
    residential: 0.55,
    industrial: 0.7,
    "mixed-use": 0.5,
  };
  const irng = seedrandom(`${masterSeed}::tensor::buildings::interior`);
  const ISTEP = 26; // sample pitch (m) — finer than the smallest block grammar
  const ib = field.bounds;
  for (let gx = ib.minX + ISTEP / 2; gx < ib.maxX; gx += ISTEP) {
    for (let gz = ib.minZ + ISTEP / 2; gz < ib.maxZ; gz += ISTEP) {
      const px = gx + (irng() - 0.5) * ISTEP * 0.7;
      const pz = gz + (irng() - 0.5) * ISTEP * 0.7;
      const densityRoll = irng();
      const idx = field.classify(px, pz);
      if (idx < 0) continue;
      const q = roadIndex.query(px, pz);
      if (q.edge < INTERIOR_NEAR || q.edge > INTERIOR_FAR) continue;
      const district = field.districts[idx];
      const character = district.character;
      // #49: dropped cells stay empty inside too, and suburban block hearts
      // fade toward yards (interiors thin harder than frontage as density
      // falls — a rural block is a ring of homes around open land).
      const localDensity = density.byIndex[idx] ?? density.radial.at(px, pz);
      if (!devMask.keepAt(px, pz, localDensity)) continue;
      const suburb = suburbAmount(localDensity);
      if (densityRoll > INTERIOR_DENSITY[character] * (1 - 0.65 * suburb)) continue;
      const grammar = GRAMMAR[character];
      const prox = coreProx(px, pz);
      const archetype = pickArchetype(irng, character, prox, suburb);
      const dims = dimensionsForArchetype(archetype, irng);
      if (suburb > 0 && (character === "residential" || character === "mixed-use")) {
        const s = 1 - SUBURB_SHRINK * suburb;
        dims.width *= s;
        dims.depth *= s;
        dims.height *= s;
      }
      const hJ = 0.78 + irng() * 0.44;
      const outlierH = irng() < 0.06 ? (irng() < 0.5 ? 0.6 : 1.5) : 1.0;
      // Align to the nearest road's bearing (a back building still faces the
      // street grid) with a touch of yard jitter.
      const rotationY = q.ang + (irng() - 0.5) * 0.1;
      const f: Footprint = { x: px, z: pz, width: dims.width, depth: dims.depth, rotationY };
      if (!cornerOnRoad(f) && !overlapsPlaced(f)) {
        const lightingClass = LIGHTING_CLASS[character];
        const sil = isHighRise(character) ? (silhouetteByIndex.get(idx) ?? null) : null;
        const hm = sil ? sil.multiplier(px, pz) : 1;
        // Interiors sit a notch lower than their frontage (light wells, backs).
        const height = dims.height * grammar.heightCap * hm * hJ * outlierH * 0.92;
        const pitch = ARCHETYPE_PITCH[archetype];
        const ageScale = lightingClass === "oldtown" ? AGE_PITCH_SCALE : 1;
        const colJitter = 1 + (irng() - 0.5) * 0.16;
        const floorJitter = 1 + (irng() - 0.5) * 0.16;
        const floors = Math.max(2, Math.round(height / (pitch.floor * ageScale * floorJitter)));
        const colsPerFace = Math.max(
          3,
          Math.round(dims.width / (pitch.col * ageScale * colJitter)),
        );
        buildings.push({
          id: id++,
          x: px,
          z: pz,
          width: dims.width,
          depth: dims.depth,
          height,
          rotationY,
          archetype,
          layer: layerForZ(pz),
          district: lightingClass,
          districtId: district.id,
          coreProximity: prox,
          windowSeed: irng(),
          rowsPerFloor: 1,
          colsPerFace,
          floors,
        });
        const k = `${Math.floor(px / BCELL)},${Math.floor(pz / BCELL)}`;
        const l = bIndex.get(k);
        if (l) l.push(f);
        else bIndex.set(k, [f]);
      }
    }
  }

  return buildings;
}

// Tensor-field generator: streets follow the tensor field; buildings line the
// streets. This is the DEFAULT city generator.
// Keep the longest contiguous run of in-mask vertices. For a convex footprint
// (circle) a road crosses the boundary at most twice, so its inside portion is a
// single run — this clips the road to the footprint without splitting it.
function clipVertsToMask(
  verts: Array<{ x: number; z: number }>,
  mask: ShapeMask,
): Array<{ x: number; z: number }> {
  let bestStart = 0;
  let bestLen = 0;
  let curStart = 0;
  let curLen = 0;
  for (let i = 0; i < verts.length; i++) {
    if (mask(verts[i].x, verts[i].z) >= 0.5) {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }
  return bestLen >= 2 ? verts.slice(bestStart, bestStart + bestLen) : [];
}

function clipRoadsToMask<T extends { vertices: Array<{ x: number; z: number }> }>(
  roads: T[],
  mask: ShapeMask,
): T[] {
  const out: T[] = [];
  for (const r of roads) {
    const v = clipVertsToMask(r.vertices, mask);
    if (v.length >= 2) out.push({ ...r, vertices: v });
  }
  return out;
}

function generateCityTensor(
  masterSeed: string,
  shape: CityShapeSetting,
  shapeScale: number,
): CityData {
  // Base layout is always the full square (shape-independent, cached per seed).
  const { topology, field, arterials, minorStreets } = buildTensorRoads(masterSeed);
  const roads: RoadLike[] = [...topology.highways, ...arterials, ...minorStreets];
  let buildings = fillTensorBuildings(masterSeed, field, roads);
  // Sketch ink is the footprint (#40): roads already stop at the ink edge, but a
  // kerbside building's centre can land just past it — clip, like the shape mask.
  const sketch = citySketchTensor();
  if (sketch) buildings = buildings.filter((b) => sketch.mask(b.x, b.z) >= 0.5);

  const resolved = resolveCityShape(shape, masterSeed);
  if (resolved === "square") {
    return { buildings, districts: field.districts, topology, arterials, streets: minorStreets };
  }
  // Organic footprint (#14): clip the full square layout with a seeded mask so
  // the central layout is identical across shapes — only the edges differ.
  const mask = makeShapeMask(resolved, shapeScale);
  return {
    buildings: buildings.filter((b) => mask(b.x, b.z) >= 0.5),
    districts: field.districts,
    topology: { ...topology, highways: clipRoadsToMask(topology.highways, mask) },
    arterials: clipRoadsToMask(arterials, mask),
    streets: clipRoadsToMask(minorStreets, mask),
  };
}

// generateCity / generateStreetlights are pure functions of the seed, but the
// 3D scene renders ~5 components off the same seed — memoise (bounded) so the
// tensor field is traced once per seed, not once per component.
const cityCache = new Map<string, CityData>();
const lightsCache = new Map<string, Streetlight[]>();

export function generateCity(
  rawSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
): CityData {
  const key = `${rawSeed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}`;
  const hit = cityCache.get(key);
  if (hit) return hit;
  const result = generateCityTensor(rawSeed, shape, shapeScale);
  if (cityCache.size > 64) cityCache.clear();
  cityCache.set(key, result);
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

// Streetlight colour temperature by district character (#42). Local lamps take
// the temperature of the zone they light — cool white LED downtown, warm in
// residential, sodium-amber in heritage + industrial. Highway/arterial run a
// uniform cool white. A per-light jitter inside each band gives a real city's
// patchwork (retrofits, bulb age) instead of one flat colour.
const DISTRICT_KELVIN: Record<DistrictCharacter, [number, number]> = {
  downtown: [3800, 4300], // modern cool-white LED
  subcentre: [3500, 4000], // cool-neutral LED
  "mixed-use": [3100, 3700], // neutral white
  residential: [2850, 3300], // warm-white LED
  heritage: [2200, 2600], // warm decorative / legacy sodium
  industrial: [1900, 2300], // HPS sodium amber
};
const LOCAL_FALLBACK_KELVIN: [number, number] = [2900, 3300]; // off-district cells
const HIGHWAY_ARTERIAL_KELVIN: [number, number] = [3900, 4250]; // uniform cool white
const FAILURE_RATE = 0.025; // fraction of local lights that flicker as failing

// Per-side spacing guards (#46). The centreline is stepped evenly, but after the
// perpendicular offset the inner side of a curve compresses toward the curve
// centre while the outer side spreads. Measured in WORLD distance per side,
// these clamp the result: skip a candidate that lands closer than MIN_SPACING_FRAC
// of the tier spacing (kills inner-curve bunching), and insert one interpolated
// lamp when a gap exceeds MAX_SPACING_FRAC (caps outer-curve thinning). Fractions
// are tuned so straight roads — where offset lamps keep the centreline spacing —
// are visually unchanged.
const MIN_SPACING_FRAC = 0.6;
const MAX_SPACING_FRAC = 1.6;

// Global de-bunch (#46). The per-side guard above only sees one road; the worst
// bunching is CROSS-road — lamps from different polylines piling up at
// intersections, roundabouts, and the dense criss-cross core (measured: ~1.5–2.6k
// lamps/seed with a neighbour < 8 m, hundreds within 2 m). After all tiers emit,
// drop any lamp within STREETLIGHT_MIN_DIST of an already-kept lamp. 8 m sits
// safely below the ~12–13 m two-sides-of-a-street pair distance, so legitimate
// paired lamps survive while coincident pile-ups collapse to one. Lamps are
// processed highway → arterial → local, so main-road lamps win a conflict.
// Set to the grid's own two-sides-of-a-street pair distance (~12 m): the grid is
// already that dense, so it's untouched, while denser cross-road convergence
// (radial hubs, concentric rings, intersections) collapses to match it — even
// density everywhere. Just under the pair distance so paired lamps survive.
const STREETLIGHT_MIN_DIST = 11.5;

function bandPick(rng: () => number, band: readonly [number, number]): number {
  return band[0] + rng() * (band[1] - band[0]);
}

// #49 suburban lamp rules (Stage-0 review). Sparseness is expressed by WIDER
// SPACING along the street — never by dimming (constant brightness across
// bands) and never to zero (every lit street keeps lamps, just farther apart).
// Past the stagger threshold, lamps also switch from opposite pairs to the
// one-sided zig-zag of real low-volume residential streets (FHWA staggered
// layout). Both read from the local density at the station, so one long
// streamline tightens/loosens as it crosses the core→suburb→rural seams.
const SUBURB_SPACING_STRETCH = 1.5; // ×(1 + stretch·suburb) — up to 2.5× at full rural
const STAGGER_T = 0.35; // suburbAmount above which lamps alternate sides

// Emit lights in pairs along both sides of a road polyline at fixed spacing.
// `pickKelvin` is evaluated per lamp (position-dependent for local streets).
// `suburbAt` (local streets only) drives the #49 spacing stretch + stagger.
function emitRoadLights(
  rng: () => number,
  road: RoadLike,
  tier: StreetlightTier,
  pickKelvin: (x: number, z: number) => number,
  spacing: number,
  out: Streetlight[],
  suburbAt?: (x: number, z: number) => number,
) {
  const verts = road.vertices;
  const last = road.closed ? verts.length : verts.length - 1;
  const offset = road.width / 2 + 2;
  // Last KEPT lamp position per side (-1 → index 0, +1 → index 1), used to clamp
  // the post-offset world spacing. null until each side's first lamp is placed.
  const lastBySide: ([number, number] | null)[] = [null, null];

  // Push one lamp, do its rng draws (y-jitter, kelvin, isFailing) in the fixed
  // order, and record it as this side's last kept position. rng is only consumed
  // here, so skipped candidates never advance the stream — the draw order across
  // kept lamps is identical run-to-run (determinism contract / gate1).
  const place = (lx: number, lz: number, sideIdx: number) => {
    out.push({
      x: lx,
      y: 7 + (rng() - 0.5) * 0.4,
      z: lz,
      kelvin: pickKelvin(lx, lz),
      isFailing: rng() < FAILURE_RATE,
      tier,
    });
    lastBySide[sideIdx] = [lx, lz];
  };

  // Walk arc-length across the WHOLE polyline, dropping a light every `spacing`
  // metres. Tensor roads are RK4-sampled at ~4m, so a per-segment emitter would
  // never fire (spacing >> segment length) — accumulate across the segment seams.
  let acc = 0; // arc-length up to vertex i
  let nextAt = spacing; // arc-length of the next light to place
  let staggerParity = 0; // which side the next one-sided lamp takes
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
      // #49: read the local density once per station (centreline point).
      const sub = suburbAt ? suburbAt(a.x + ux * s, a.z + uz * s) : 0;
      const mul = 1 + SUBURB_SPACING_STRETCH * sub;
      const minDist = spacing * mul * MIN_SPACING_FRAC;
      const maxDist = spacing * mul * MAX_SPACING_FRAC;
      const staggered = sub > STAGGER_T;
      const sides: ReadonlyArray<-1 | 1> = staggered
        ? [staggerParity++ % 2 === 0 ? -1 : 1]
        : [-1, 1];
      for (const side of sides) {
        const sideIdx = side < 0 ? 0 : 1;
        const lx = a.x + ux * s + nx * offset * side;
        const lz = a.z + uz * s + nz * offset * side;
        const prev = lastBySide[sideIdx];
        if (prev) {
          const d = Math.hypot(lx - prev[0], lz - prev[1]);
          // Inner-curve bunching: candidate too close to the previous lamp — skip
          // it (and its rng draws) so the visible spacing never collapses.
          if (d < minDist) continue;
          // Outer-curve thinning: gap too wide — drop one interpolated lamp at the
          // midpoint first, then place the candidate. Midpoint of two offset
          // points stays on the offset line for straight runs and is a clean,
          // deterministic cap on the worst gaps. Staggered runs skip it: a
          // one-sided zig-zag's same-side gap is 2 stations wide BY DESIGN —
          // back-filling it would quietly rebuild the opposite-pairs look.
          if (d > maxDist && !staggered) {
            place((prev[0] + lx) / 2, (prev[1] + lz) / 2, sideIdx);
          }
        }
        place(lx, lz, sideIdx);
      }
      nextAt += spacing * mul;
    }
    acc += segLen;
  }
}

// --- #13 Phase 2: interchange glow ------------------------------------------
// Where two highways cross, a real freeway has an interchange — at night that
// reads as four glowing cloverleaf loops. No geometry: deterministic ramp-light
// clusters added to the streetlight set (the de-bunch pass then knits them into
// the road lighting). Crossing detection is segment×segment on decimated
// polylines; near-parallel overlaps (< 25°) and crossings within 150m of an
// already-found interchange are skipped.

type Crossing = { x: number; z: number; d1: [number, number]; d2: [number, number] };

const INTERCHANGE_MIN_ANGLE = (25 * Math.PI) / 180;
const INTERCHANGE_MIN_DIST = 150;
const RAMP_LOOP_RADIUS = 38; // cloverleaf loop radius (m)
const RAMP_LOOP_OFFSET = 70; // loop centre distance from the crossing point (m)
const RAMP_LIGHTS_PER_LOOP = 10;

function segIntersect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): [number, number] | null {
  const r1x = bx - ax;
  const r1z = bz - az;
  const r2x = dx - cx;
  const r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
  const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [ax + t * r1x, az + t * r1z];
}

function findHighwayCrossings(highways: Highway[]): Crossing[] {
  const out: Crossing[] = [];
  const STEP = 3; // decimate verts (RK4 ~4m apart → ~12m segments): plenty for detection
  for (let i = 0; i < highways.length; i++) {
    for (let j = i + 1; j < highways.length; j++) {
      const va = highways[i].vertices;
      const vb = highways[j].vertices;
      for (let p = STEP; p < va.length; p += STEP) {
        for (let q = STEP; q < vb.length; q += STEP) {
          const hit = segIntersect(
            va[p - STEP].x,
            va[p - STEP].z,
            va[p].x,
            va[p].z,
            vb[q - STEP].x,
            vb[q - STEP].z,
            vb[q].x,
            vb[q].z,
          );
          if (!hit) continue;
          const a1 = Math.atan2(va[p].z - va[p - STEP].z, va[p].x - va[p - STEP].x);
          const a2 = Math.atan2(vb[q].z - vb[q - STEP].z, vb[q].x - vb[q - STEP].x);
          if (
            bearingDiff(
              ((a1 % Math.PI) + Math.PI) % Math.PI,
              ((a2 % Math.PI) + Math.PI) % Math.PI,
            ) < INTERCHANGE_MIN_ANGLE
          )
            continue;
          if (out.some((c) => Math.hypot(c.x - hit[0], c.z - hit[1]) < INTERCHANGE_MIN_DIST))
            continue;
          out.push({
            x: hit[0],
            z: hit[1],
            d1: [Math.cos(a1), Math.sin(a1)],
            d2: [Math.cos(a2), Math.sin(a2)],
          });
        }
      }
    }
  }
  return out;
}

// Four light loops in the four quadrants between the two roads' directions.
function emitInterchangeLights(rng: () => number, c: Crossing, out: Streetlight[]) {
  const sum: [number, number] = [c.d1[0] + c.d2[0], c.d1[1] + c.d2[1]];
  const dif: [number, number] = [c.d1[0] - c.d2[0], c.d1[1] - c.d2[1]];
  for (const b of [sum, dif]) {
    const len = Math.hypot(b[0], b[1]);
    if (len < 1e-6) continue;
    b[0] /= len;
    b[1] /= len;
  }
  for (const [bx, bz] of [sum, [-sum[0], -sum[1]], dif, [-dif[0], -dif[1]]] as const) {
    const cx = c.x + bx * RAMP_LOOP_OFFSET;
    const cz = c.z + bz * RAMP_LOOP_OFFSET;
    for (let k = 0; k < RAMP_LIGHTS_PER_LOOP; k++) {
      const ang = (k / RAMP_LIGHTS_PER_LOOP) * Math.PI * 2;
      out.push({
        x: cx + Math.cos(ang) * RAMP_LOOP_RADIUS,
        y: 7 + (rng() - 0.5) * 0.4,
        z: cz + Math.sin(ang) * RAMP_LOOP_RADIUS,
        kelvin: bandPick(rng, HIGHWAY_ARTERIAL_KELVIN),
        isFailing: rng() < FAILURE_RATE,
        tier: "highway",
      });
    }
  }
}

// Global de-bunch pass: keep a lamp only if no already-kept lamp sits within
// `minDist`. Deterministic — input order (highway → arterial → local) decides
// which lamp wins, so main-road lamps survive over crowding local ones. Spatial
// hash with cell = minDist; a conflicting lamp can only be in the same or an
// adjacent cell, so a ±1 cell scan is exhaustive.
function dedupeByMinDistance(lights: Streetlight[], minDist: number): Streetlight[] {
  const cell = minDist;
  const min2 = minDist * minDist;
  const grid = new Map<string, Streetlight[]>();
  const out: Streetlight[] = [];
  for (const l of lights) {
    const cx = Math.floor(l.x / cell);
    const cz = Math.floor(l.z / cell);
    let tooClose = false;
    for (let gx = cx - 1; gx <= cx + 1 && !tooClose; gx++) {
      for (let gz = cz - 1; gz <= cz + 1 && !tooClose; gz++) {
        const bucket = grid.get(`${gx},${gz}`);
        if (!bucket) continue;
        for (const o of bucket) {
          const dx = l.x - o.x;
          const dz = l.z - o.z;
          if (dx * dx + dz * dz < min2) {
            tooClose = true;
            break;
          }
        }
      }
    }
    if (tooClose) continue;
    out.push(l);
    const k = `${cx},${cz}`;
    const bucket = grid.get(k);
    if (bucket) bucket.push(l);
    else grid.set(k, [l]);
  }
  return out;
}

// Tensor streetlights (Stage 1): edge lights along every road tier. Local
// per-block lights arrive with the blocks in Stage 2-3.
function generateStreetlightsTensor(
  masterSeed: string,
  shape: CityShapeSetting,
  shapeScale: number,
): Streetlight[] {
  // Emit on the full square network, then clip to the footprint mask (#14) so the
  // lights match the same boundary the buildings + roads were clipped to.
  const { topology, arterials, minorStreets } = buildTensorRoads(masterSeed);
  const lights: Streetlight[] = [];

  // District lookup for local-lamp temperature. classify() → district index →
  // character → kelvin band. Field is shape-independent + cached.
  const field = tensorDistrictField(masterSeed);
  const charByIndex = new Map<number, DistrictCharacter>();
  for (const d of field.districts) charByIndex.set(d.index, d.character);
  const localBand = (x: number, z: number): readonly [number, number] => {
    const idx = field.classify(x, z);
    const ch = idx >= 0 ? charByIndex.get(idx) : undefined;
    return ch ? DISTRICT_KELVIN[ch] : LOCAL_FALLBACK_KELVIN;
  };

  const hwRng = seedrandom(`${masterSeed}::streetlights::highways`);
  for (const hw of topology.highways) {
    emitRoadLights(
      hwRng,
      hw,
      "highway",
      () => bandPick(hwRng, HIGHWAY_ARTERIAL_KELVIN),
      34,
      lights,
    );
  }
  // #13 Phase 2: interchange ramp loops where highways cross. Own seeded
  // stream so adding/removing interchanges never shifts road-lamp draws.
  const interRng = seedrandom(`${masterSeed}::streetlights::interchanges`);
  for (const c of findHighwayCrossings(topology.highways)) {
    emitInterchangeLights(interRng, c, lights);
  }
  const artRng = seedrandom(`${masterSeed}::streetlights::arterials`);
  for (const a of arterials) {
    emitRoadLights(
      artRng,
      a,
      "arterial",
      () => bandPick(artRng, HIGHWAY_ARTERIAL_KELVIN),
      28,
      lights,
    );
  }
  // #49: local lamps stretch their spacing and go one-sided (staggered) as
  // density falls — see SUBURB_SPACING_STRETCH/STAGGER_T. Constant brightness:
  // kelvin/intensity never change with band. Highway + arterial lamps are
  // exempt (real metros keep their main roads continuously lit).
  const density = buildDensityField(masterSeed, field);
  const suburbAt = (x: number, z: number) => suburbAmount(density.densityAt(x, z));
  const minRng = seedrandom(`${masterSeed}::streetlights::minor`);
  for (const s of minorStreets) {
    emitRoadLights(
      minRng,
      s,
      "local",
      (x, z) => bandPick(minRng, localBand(x, z)),
      40,
      lights,
      suburbAt,
    );
  }
  // De-bunch across all tiers before clipping to the footprint mask.
  let deduped = dedupeByMinDistance(lights, STREETLIGHT_MIN_DIST);
  // Sketch ink is the footprint (#40) — kerb-offset lamps can sit just past the
  // ink edge the road stopped at; clip them like the buildings.
  const sketch = citySketchTensor();
  if (sketch) deduped = deduped.filter((l) => sketch.mask(l.x, l.z) >= 0.5);
  const resolved = resolveCityShape(shape, masterSeed);
  if (resolved === "square") return deduped;
  const mask = makeShapeMask(resolved, shapeScale);
  return deduped.filter((l) => mask(l.x, l.z) >= 0.5);
}

export function generateStreetlights(
  rawSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
): Streetlight[] {
  const key = `${rawSeed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}`;
  const hit = lightsCache.get(key);
  if (hit) return hit;
  const result = generateStreetlightsTensor(rawSeed, shape, shapeScale);
  if (lightsCache.size > 64) lightsCache.clear();
  lightsCache.set(key, result);
  return result;
}

export type AviationBeacon = {
  x: number;
  y: number; // world Y at the roof beacon
  z: number;
  phase: number; // 0..1 blink phase offset so towers don't flash in unison
};

// Real-world obstruction lights sit on structures tall enough to threaten
// flight paths AND tall enough to stand out locally — aviation rules light the
// prominent obstruction, not every tall building. Gate on absolute height, then
// keep only the tallest building per local cluster cell (#48). A short city has
// no beacons (correct); a dense downtown lights its standout towers, not every
// mid-rise. Cluster size is a fixed real-world distance (NOT scaled with city
// width) — a bigger city just has more clusters, so proportionally more beacons.
const BEACON_MIN_HEIGHT = 100;
const BEACON_CLUSTER_SIZE = 300; // m — neighbourhood cell for the tallest-tower rule

export function generateAviationBeacons(
  rawSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
): AviationBeacon[] {
  const { buildings } = generateCity(rawSeed, shape, shapeScale);
  // Tallest qualifying building per cluster cell. Map keeps first-insertion key
  // order, and buildings are iterated in deterministic array order, so the
  // emitted set + phase assignment below stay deterministic.
  const tallestPerCell = new Map<string, (typeof buildings)[number]>();
  for (const b of buildings) {
    if (b.height < BEACON_MIN_HEIGHT) continue;
    const key = `${Math.floor(b.x / BEACON_CLUSTER_SIZE)},${Math.floor(b.z / BEACON_CLUSTER_SIZE)}`;
    const cur = tallestPerCell.get(key);
    if (!cur || b.height > cur.height) tallestPerCell.set(key, b);
  }
  const rng = seedrandom(`${rawSeed}::beacons`);
  const beacons: AviationBeacon[] = [];
  for (const b of tallestPerCell.values()) {
    beacons.push({ x: b.x, y: b.height + 3, z: b.z, phase: rng() });
  }
  return beacons;
}
