// Compact wire/storage form of a CityBundle (#b: typed-array packing).
//
// A CityBundle's bulk is three object arrays — buildings (~13k), streetlights
// (~20k) and road polylines (~117k vertices as {x,z} objects, carried twice:
// the full base network in `roads.*` and the shape-clipped render set in
// `city.*`). Structured-cloning those (worker→main postMessage AND the
// IndexedDB record) re-serialises every object's keys and pointers — megabytes
// of overhead the actual numbers don't need.
//
// packBundle flattens each collection to Struct-of-Arrays typed buffers; a
// typed array structured-clones as one compact buffer copy (the district raster
// already does this — it clones in ~0.5ms vs ~50ms for the road objects).
// unpackBundle rebuilds the exact CityBundle on the far side, so nothing
// downstream changes shape.
//
// LOSSLESS BY CONSTRUCTION: every numeric field is stored as Float64 (windowSeed
// is a full-precision seedrandom double driving the window shader, and kelvin is
// a non-integer colour temperature — neither survives a narrower type). Enums
// and the districtId become integer indices into fixed/interned string tables.
// The round-trip is value-exact — see scripts/prototypes/wireCheck.ts.
//
// Used at the two transfer boundaries only (cityGen.worker → cityGenClient, and
// bundleStore put/get). The runtime type stays CityBundle everywhere else.
import {
  ARCHETYPE_ORDER,
  type Archetype,
  type Layer,
  type BuildingLightingClass,
  type Building,
  type Streetlight,
  type StreetlightTier,
  type CityBundle,
} from "@/lib/seed/cityGen";
import type { RoadPoly, RoadTier } from "@/lib/seed/streets";

const LAYER_ORDER: Layer[] = ["front", "mid", "back"];
const LIGHTING_ORDER: BuildingLightingClass[] = ["downtown", "residential", "industrial", "oldtown"];
const ROAD_TIER_ORDER: RoadTier[] = ["arterial", "minor"];
const LIGHT_TIER_ORDER: StreetlightTier[] = ["highway", "arterial", "local"];

// --- roads (RoadPoly[]) -------------------------------------------------------
type RoadsWire = {
  ids: string[]; // per-poly id
  width: Float64Array; // per-poly surface width
  tier: Uint8Array; // ROAD_TIER_ORDER index
  counts: Uint32Array; // per-poly vertex count (to slice `xz`)
  xz: Float64Array; // all vertices flattened: x,z,x,z,…
};

function packRoads(roads: RoadPoly[]): RoadsWire {
  const m = roads.length;
  const ids = new Array<string>(m);
  const width = new Float64Array(m);
  const tier = new Uint8Array(m);
  const counts = new Uint32Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) total += roads[i].vertices.length;
  const xz = new Float64Array(total * 2);
  let k = 0;
  for (let i = 0; i < m; i++) {
    const r = roads[i];
    ids[i] = r.id;
    width[i] = r.width;
    tier[i] = ROAD_TIER_ORDER.indexOf(r.tier);
    counts[i] = r.vertices.length;
    for (const v of r.vertices) {
      xz[k++] = v.x;
      xz[k++] = v.z;
    }
  }
  return { ids, width, tier, counts, xz };
}

function unpackRoads(w: RoadsWire): RoadPoly[] {
  const m = w.ids.length;
  const out: RoadPoly[] = new Array(m);
  let k = 0;
  for (let i = 0; i < m; i++) {
    const n = w.counts[i];
    const vertices = new Array<{ x: number; z: number }>(n);
    for (let j = 0; j < n; j++) vertices[j] = { x: w.xz[k++], z: w.xz[k++] };
    out[i] = { id: w.ids[i], vertices, width: w.width[i], closed: false, tier: ROAD_TIER_ORDER[w.tier[i]] };
  }
  return out;
}

// --- buildings (Building[]) ---------------------------------------------------
// 12 numeric fields interleaved, stride B_STRIDE:
//   id,x,z,width,depth,height,rotationY,coreProximity,windowSeed,rowsPerFloor,colsPerFace,floors
const B_STRIDE = 12;
type BuildingsWire = {
  n: number;
  num: Float64Array; // n * B_STRIDE
  archetype: Uint8Array; // ARCHETYPE_ORDER index
  layer: Uint8Array; // LAYER_ORDER index
  district: Uint8Array; // LIGHTING_ORDER index
  districtId: Uint16Array; // index into districtIds
  districtIds: string[]; // interned table (a few dozen)
};

function packBuildings(bs: Building[]): BuildingsWire {
  const n = bs.length;
  const num = new Float64Array(n * B_STRIDE);
  const archetype = new Uint8Array(n);
  const layer = new Uint8Array(n);
  const district = new Uint8Array(n);
  const districtId = new Uint16Array(n);
  const districtIds: string[] = [];
  const idIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const b = bs[i];
    const o = i * B_STRIDE;
    num[o] = b.id;
    num[o + 1] = b.x;
    num[o + 2] = b.z;
    num[o + 3] = b.width;
    num[o + 4] = b.depth;
    num[o + 5] = b.height;
    num[o + 6] = b.rotationY;
    num[o + 7] = b.coreProximity;
    num[o + 8] = b.windowSeed;
    num[o + 9] = b.rowsPerFloor;
    num[o + 10] = b.colsPerFace;
    num[o + 11] = b.floors;
    archetype[i] = ARCHETYPE_ORDER.indexOf(b.archetype);
    layer[i] = LAYER_ORDER.indexOf(b.layer);
    district[i] = LIGHTING_ORDER.indexOf(b.district);
    let di = idIndex.get(b.districtId);
    if (di === undefined) {
      di = districtIds.length;
      districtIds.push(b.districtId);
      idIndex.set(b.districtId, di);
    }
    districtId[i] = di;
  }
  return { n, num, archetype, layer, district, districtId, districtIds };
}

function unpackBuildings(w: BuildingsWire): Building[] {
  const out: Building[] = new Array(w.n);
  for (let i = 0; i < w.n; i++) {
    const o = i * B_STRIDE;
    out[i] = {
      id: w.num[o],
      x: w.num[o + 1],
      z: w.num[o + 2],
      width: w.num[o + 3],
      depth: w.num[o + 4],
      height: w.num[o + 5],
      rotationY: w.num[o + 6],
      archetype: ARCHETYPE_ORDER[w.archetype[i]] as Archetype,
      layer: LAYER_ORDER[w.layer[i]],
      district: LIGHTING_ORDER[w.district[i]],
      districtId: w.districtIds[w.districtId[i]],
      coreProximity: w.num[o + 7],
      windowSeed: w.num[o + 8],
      rowsPerFloor: w.num[o + 9],
      colsPerFace: w.num[o + 10],
      floors: w.num[o + 11],
    };
  }
  return out;
}

// --- streetlights (Streetlight[]) ---------------------------------------------
// vals stride 4: x,y,z,kelvin (kelvin is a non-integer colour temperature).
// flags: bit0 = isFailing, bits1+ = LIGHT_TIER_ORDER index.
type LightsWire = { n: number; vals: Float64Array; flags: Uint8Array };

function packLights(ls: Streetlight[]): LightsWire {
  const n = ls.length;
  const vals = new Float64Array(n * 4);
  const flags = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = ls[i];
    const o = i * 4;
    vals[o] = l.x;
    vals[o + 1] = l.y;
    vals[o + 2] = l.z;
    vals[o + 3] = l.kelvin;
    flags[i] = (LIGHT_TIER_ORDER.indexOf(l.tier) << 1) | (l.isFailing ? 1 : 0);
  }
  return { n, vals, flags };
}

function unpackLights(w: LightsWire): Streetlight[] {
  const out: Streetlight[] = new Array(w.n);
  for (let i = 0; i < w.n; i++) {
    const o = i * 4;
    const f = w.flags[i];
    out[i] = {
      x: w.vals[o],
      y: w.vals[o + 1],
      z: w.vals[o + 2],
      kelvin: w.vals[o + 3],
      isFailing: (f & 1) === 1,
      tier: LIGHT_TIER_ORDER[f >> 1],
    };
  }
  return out;
}

// --- bundle -------------------------------------------------------------------
// topology / districts / bounds / raster are small or already typed (the raster
// is an Int16Array) — left native; structured clone handles them cheaply.
export type CityBundleWire = {
  roads: {
    topology: CityBundle["roads"]["topology"];
    arterials: RoadsWire;
    minorStreets: RoadsWire;
    districts: CityBundle["roads"]["districts"];
    bounds: CityBundle["roads"]["bounds"];
    raster: CityBundle["roads"]["raster"];
  };
  city: {
    buildings: BuildingsWire;
    districts: CityBundle["city"]["districts"];
    topology: CityBundle["city"]["topology"];
    arterials: RoadsWire;
    streets: RoadsWire;
  };
  lights: LightsWire;
};

export function packBundle(b: CityBundle): CityBundleWire {
  return {
    roads: {
      topology: b.roads.topology,
      arterials: packRoads(b.roads.arterials),
      minorStreets: packRoads(b.roads.minorStreets),
      districts: b.roads.districts,
      bounds: b.roads.bounds,
      raster: b.roads.raster,
    },
    city: {
      buildings: packBuildings(b.city.buildings),
      districts: b.city.districts,
      topology: b.city.topology,
      arterials: packRoads(b.city.arterials),
      streets: packRoads(b.city.streets),
    },
    lights: packLights(b.lights),
  };
}

export function unpackBundle(w: CityBundleWire): CityBundle {
  return {
    roads: {
      topology: w.roads.topology,
      arterials: unpackRoads(w.roads.arterials),
      minorStreets: unpackRoads(w.roads.minorStreets),
      districts: w.roads.districts,
      bounds: w.roads.bounds,
      raster: w.roads.raster,
    },
    city: {
      buildings: unpackBuildings(w.city.buildings),
      districts: w.city.districts,
      topology: w.city.topology,
      arterials: unpackRoads(w.city.arterials),
      streets: unpackRoads(w.city.streets),
    },
    lights: unpackLights(w.lights),
  };
}
