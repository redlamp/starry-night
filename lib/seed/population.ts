import { generateCity, type Archetype, type BuildingLightingClass } from "./cityGen";
import { CITY_CENTER, maxHalfExtent } from "./topology";
import { sketchKey } from "./citySketch";
import { fieldDeviation } from "./tensorField";
import { densityProfileKey } from "./density";
import type { CityShapeSetting } from "./cityShape";

// Population density field — a people-equivalent estimate derived ENTIRELY from
// the generated buildings (floor area × occupancy by use), binned to a grid and
// blurred to neighbourhood scale. Pure derivation, no rng: same seed → same
// field. Consumers: the Population panel heat-map overlay, and traffic, which
// scales per-segment car counts by local population so remote arterials carry
// country-road traffic instead of downtown's (user 2026-06-07).

// People per m² of floor area, by archetype. Coarse occupancy truths, not a
// census: residential packs people per floor, offices contribute the evening
// fraction that drives night traffic, warehouses are near-empty after dark.
const ARCHETYPE_OCCUPANCY: Record<Archetype, number> = {
  "residential-tower": 0.03,
  "mid-rise": 0.028,
  "low-rise": 0.025,
  "narrow-tower": 0.02,
  spire: 0.011,
  "office-block": 0.011,
  warehouse: 0.002,
};

// Zone-use multiplier layered on top (the building's lighting class is the
// 4-way collapse of the district character, already on every building).
const CLASS_USE: Record<BuildingLightingClass, number> = {
  residential: 1.15,
  oldtown: 1.0,
  downtown: 0.85,
  industrial: 0.35,
};

const CELL = 80; // metres per grid cell — blocks resolve, individual lots don't
const BLUR_RADIUS = 2; // box-blur radius in cells; 2 passes ≈ 160 m Gaussian

// One building's people-equivalent contribution — shared by the field build
// and the Debug View "population" building tint.
export function buildingPopulation(b: {
  width: number;
  depth: number;
  floors: number;
  archetype: Archetype;
  district: BuildingLightingClass;
}): number {
  return b.width * b.depth * b.floors * ARCHETYPE_OCCUPANCY[b.archetype] * CLASS_USE[b.district];
}

// --- Census capacity (#96, recalibrated 2026-07-18) -------------------------
// The people-equivalent above is tuned for NIGHT TRAFFIC, and only the three
// pure-residential archetypes counted toward the city's census — which read
// far too low against a skyline full of spires (user: "seems very low
// considering the size and density"). The census model instead treats the
// tall archetypes as mixed-use (a share of their floors is apartments, like
// real downtown towers) at a dense-metro housing rate. This is DISPLAY data
// (masthead, cards, demographics) — traffic, the heat-map, and the persona
// derivation keep buildingPopulation() untouched so nothing re-rolls.
const RESIDENTIAL_MIX: Partial<Record<Archetype, number>> = {
  "residential-tower": 1,
  "mid-rise": 1,
  "low-rise": 1,
  "narrow-tower": 0.7,
  spire: 0.5,
  "office-block": 0.2,
  // warehouse: nobody lives in one.
};
const HOUSING_DENSITY = 0.04; // people per m² of residential floor area (~25 m²/person)

// One building's census-capacity contribution; 0 for archetypes nobody lives in.
export function residentialCapacity(b: {
  width: number;
  depth: number;
  floors: number;
  archetype: Archetype;
}): number {
  const mix = RESIDENTIAL_MIX[b.archetype];
  return mix ? b.width * b.depth * b.floors * mix * HOUSING_DENSITY : 0;
}

export type PopulationField = {
  n: number; // grid is n×n
  cell: number; // metres per cell
  minX: number;
  minZ: number;
  grid: Float32Array; // smoothed density, normalised 0..1 (clamped at ~p99)
  total: number; // whole-city people-equivalent estimate
  sample(x: number, z: number): number; // bilinear 0..1
};

// One box-blur pass along each axis (separable). Edge cells renormalise by the
// actual window size so the city rim doesn't artificially darken.
function boxBlur(src: Float32Array, n: number, radius: number): Float32Array {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, i - radius); k <= Math.min(n - 1, i + radius); k++) {
        sum += src[j * n + k];
        count++;
      }
      tmp[j * n + i] = sum / count;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, j - radius); k <= Math.min(n - 1, j + radius); k++) {
        sum += tmp[k * n + i];
        count++;
      }
      out[j * n + i] = sum / count;
    }
  }
  return out;
}

function buildPopulationFieldImpl(
  masterSeed: string,
  shape: CityShapeSetting,
  shapeScale: number,
): PopulationField {
  const city = generateCity(masterSeed, shape, shapeScale);
  const half = maxHalfExtent();
  const n = Math.max(8, Math.ceil((2 * half) / CELL));
  const minX = CITY_CENTER.x - half;
  const minZ = CITY_CENTER.z - half;

  let raw: Float32Array = new Float32Array(n * n);
  let total = 0;
  for (const b of city.buildings) {
    const pop = buildingPopulation(b);
    total += pop;
    const i = Math.min(n - 1, Math.max(0, Math.floor((b.x - minX) / CELL)));
    const j = Math.min(n - 1, Math.max(0, Math.floor((b.z - minZ) / CELL)));
    raw[j * n + i] += pop;
  }

  raw = boxBlur(raw, n, BLUR_RADIUS);
  raw = boxBlur(raw, n, BLUR_RADIUS);

  // Normalise against a high percentile, not the max — one supertall cell must
  // not crush the rest of the ramp toward black.
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || 1;
  const grid = new Float32Array(n * n);
  for (let i = 0; i < raw.length; i++) grid[i] = Math.min(1, raw[i] / p99);

  const sample = (x: number, z: number): number => {
    // Bilinear over cell centres; outside the grid clamps to the edge cell.
    const fx = Math.min(n - 1.001, Math.max(0, (x - minX) / CELL - 0.5));
    const fz = Math.min(n - 1.001, Math.max(0, (z - minZ) / CELL - 0.5));
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const tx = fx - i0;
    const tz = fz - j0;
    const i1 = Math.min(n - 1, i0 + 1);
    const j1 = Math.min(n - 1, j0 + 1);
    const a = grid[j0 * n + i0] * (1 - tx) + grid[j0 * n + i1] * tx;
    const b = grid[j1 * n + i0] * (1 - tx) + grid[j1 * n + i1] * tx;
    return a * (1 - tz) + b * tz;
  };

  return { n, cell: CELL, minX, minZ, grid, total, sample };
}

// Memoised like generateCity — the heat map, traffic, and the panel readout all
// ask for the same field.
const popCache = new Map<string, PopulationField>();

export function buildPopulationField(
  masterSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
): PopulationField {
  // Mirror generateCity's cache key exactly — anything that changes the city
  // (tier extent, sketch, deviation) must miss here too.
  const key = `${masterSeed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}::${densityProfileKey()}`;
  const hit = popCache.get(key);
  if (hit) return hit;
  const result = buildPopulationFieldImpl(masterSeed, shape, shapeScale);
  if (popCache.size > 32) popCache.clear();
  popCache.set(key, result);
  return result;
}
