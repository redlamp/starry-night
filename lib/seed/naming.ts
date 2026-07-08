import seedrandom from "seedrandom";
import { generateCity, type Building } from "./cityGen";
import type { District, DistrictCharacter } from "./district";
import { maxHalfExtent } from "./topology";
import { sketchKey } from "./citySketch";
import { fieldDeviation } from "./tensorField";
import { densityProfileKey } from "./density";
import type { CityShapeSetting } from "./cityShape";
import { LAST_NAMES } from "./personaData";

// Deterministic naming layer: the city gets a name, districts get proper names,
// roads get street names, buildings get street addresses (and sometimes names
// of their own). Everything is derived from the master seed on its own rng
// streams (`${seed}::names::*`) — generateCity's draw order is never touched,
// so the city golden stays byte-identical.

// --- Name part pools ---------------------------------------------------------

export const CITY_PREFIXES = [
  "Ash", "Bel", "Clear", "Cold", "Crest", "Fair", "Glen", "Gold", "Grey",
  "Haven", "Iron", "Kings", "Lake", "Mill", "North", "Oak", "Port", "Ridge",
  "Silver", "Spring", "Stone", "Summer", "West", "Winter", "Harbor", "Marble",
];

export const CITY_SUFFIXES = [
  "field", "ford", "haven", "mont", "port", "view", "wood", "brook", "bridge",
  "crest", "dale", "gate", "hollow", "shore", "side", "vale", "water", "burgh",
];

// Two-word city forms ("Cedar Falls") — first words deliberately overlap the
// street-tree pool so the city name echoes its own streets.
export const CITY_FIRST_WORDS = [
  "Cedar", "Alder", "Juniper", "Copper", "Slate", "Harbor", "Anchor", "Winter",
  "Vernon", "Calder", "Marrow", "Halcyon", "Arden", "Bramble", "Corvid",
];
export const CITY_SECOND_WORDS = [
  "Falls", "Heights", "Landing", "Junction", "Point", "Crossing", "Bluffs",
  "Bay", "Reach", "Hollow",
];

export const TREE_NAMES = [
  "Oak", "Maple", "Cedar", "Birch", "Elm", "Willow", "Aspen", "Sycamore",
  "Juniper", "Alder", "Chestnut", "Magnolia", "Poplar", "Hawthorn", "Linden",
  "Laurel", "Cypress", "Rowan", "Hazel", "Mulberry",
];

export const NATURE_NAMES = [
  "River", "Lake", "Hill", "Meadow", "Summit", "Valley", "Prairie", "Canyon",
  "Brook", "Ridge", "Garden", "Grove", "Spring", "Harbor", "Bluff", "Fern",
];

export const BIRD_NAMES = [
  "Heron", "Finch", "Sparrow", "Osprey", "Kestrel", "Swift", "Starling",
  "Wren", "Plover", "Cormorant", "Nightjar", "Killdeer",
];

// Founders share the resident surname pool on purpose — a persona named Ramos
// living on Ramos Avenue is the kind of coincidence players build stories from.
const FOUNDER_NAMES = LAST_NAMES;

export const ARTERIAL_SUFFIXES = ["Avenue", "Boulevard", "Road", "Drive", "Parkway"];
export const MINOR_SUFFIXES = ["Street", "Lane", "Court", "Place", "Way", "Terrace", "Row", "Walk"];

const ORDINALS = [
  "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
  "11th", "12th", "13th", "14th",
];

// District proper-name pools, by planning character. `{F}` = founder surname,
// `{T}` = tree/nature word. Each district draws a template, then fills it.
export const DISTRICT_TEMPLATES: Record<DistrictCharacter, string[]> = {
  downtown: [
    "The Exchange", "Meridian Center", "{F} Square", "The Core", "Beacon Hill",
    "Union Center", "Grand Circle", "The Spires", "Capitol Row",
  ],
  subcentre: [
    "{F} Junction", "{T} Crossing", "Midtown", "The Interchange", "{F} Gate",
    "Uptown", "Century Circle",
  ],
  heritage: [
    "Old Towne", "The Brickworks", "{F} Row", "Cannery Quarter", "The Landmark",
    "Cobble Hill", "Gaslight Quarter", "The Old Mill", "Founders' Quarter",
  ],
  residential: [
    "{T} Heights", "{T} Park", "{T} Glen", "{T} Commons", "{T} Hollow",
    "{F} Park", "{T} Terrace", "{T} Gardens", "The {T}s",
  ],
  industrial: [
    "The Foundry", "{F} Yards", "Dockside", "Millrace", "The Works",
    "Freight Row", "Slag Flats", "The Depot Lands", "Tank Farm Flats",
  ],
  "mixed-use": [
    "{F} Market", "{T} Village", "{F} Corners", "The Wharves", "Little Harbor",
    "{T} Quarter", "Market East", "The Arcades",
  ],
};

// Building proper names by archetype. `{F}` founder, `{T}` tree/nature,
// `{B}` bird. Only some buildings are named (probability per archetype below).
export const BUILDING_TEMPLATES: Record<Building["archetype"], string[]> = {
  spire: [
    "The {T} Spire", "{F} Tower", "One {T} Plaza", "The Meridian", "{F} Centre",
    "The Pinnacle", "Union Spire",
  ],
  "narrow-tower": ["{F} Tower", "The {B} Building", "{T} Point", "The Needle", "{F} Exchange"],
  "office-block": [
    "{F} Building", "The {B} Block", "{T} House", "{F} & {F2}", "The Annex",
    "{F} Trade Hall",
  ],
  "residential-tower": [
    "The {T} Apartments", "{T} Court", "{F} House", "The {B}'s Nest", "{T} View",
    "Skyline Terrace",
  ],
  "mid-rise": ["The {T} Arms", "{F} Lofts", "{T} Mansions", "The {B} Rooms"],
  "low-rise": ["{F}'s Corner", "The {T} House", "{B} Cottage Row"],
  warehouse: [
    "{F} & Sons Storage", "Bay {N} Depot", "{F} Freight", "The {T} Warehouse",
    "Terminal {N}",
  ],
};

const NAMED_BUILDING_PROB: Record<Building["archetype"], number> = {
  spire: 1.0,
  "narrow-tower": 0.6,
  "office-block": 0.45,
  "residential-tower": 0.5,
  "mid-rise": 0.15,
  "low-rise": 0.08,
  warehouse: 0.35,
};

export const PAPER_NAMES = ["Ledger", "Herald", "Gazette", "Star-Courier", "Register", "Signal"];

// --- Types -------------------------------------------------------------------

export type CityIdentity = {
  name: string;
  university: string;
  college: string;
  hospital: string;
  newspaper: string;
  transitLine: string; // the rail spine
  busLines: string[]; // named bus routes (mapping actual routes: issue TBD)
};

export type Address = {
  number: number;
  street: string; // full street name, e.g. "Maple Street"
  roadId: string;
  districtId: string;
};

export type CityNames = {
  city: CityIdentity;
  // District.id → proper name (e.g. "Alder Heights"); District.displayName
  // ("Northwest Residential") stays available as a subtitle.
  districtNames: Map<string, string>;
  // RoadPoly.id / Highway.id → street name.
  streetNames: Map<string, string>;
  // Building.id → street address.
  addresses: Map<number, Address>;
  // Building.id → proper name, only for the ~named subset.
  buildingNames: Map<number, string>;
  // Road id → the buildings addressed onto it (the road-hover list).
  buildingsByRoad: Map<string, number[]>;
  // Widest address number in the city (digit count). List renderers size a
  // right-aligned `${n}ch` column with tabular-nums so numbers + street names
  // align down a list.
  maxAddressDigits: number;
};

// --- City identity -----------------------------------------------------------

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function makeCityName(rng: () => number): string {
  if (rng() < 0.45) {
    return `${pick(rng, CITY_FIRST_WORDS)} ${pick(rng, CITY_SECOND_WORDS)}`;
  }
  const prefix = pick(rng, CITY_PREFIXES);
  // Reject suffixes that echo the prefix ("Oakwood" is fine, "Portport" is not).
  let suffix = pick(rng, CITY_SUFFIXES);
  for (let i = 0; i < 4 && prefix.toLowerCase().endsWith(suffix.slice(0, 2)); i++) {
    suffix = pick(rng, CITY_SUFFIXES);
  }
  return prefix + suffix;
}

function makeCityIdentity(masterSeed: string): CityIdentity {
  const rng = seedrandom(`${masterSeed}::names::city`);
  const name = makeCityName(rng);
  const founder = pick(rng, FOUNDER_NAMES);
  return {
    name,
    university: rng() < 0.5 ? `${name} State University` : `University of ${name}`,
    college: `${founder} College`,
    hospital: rng() < 0.5 ? `${name} General` : `St. ${pick(rng, FOUNDER_NAMES)} Medical Center`,
    newspaper: `The ${name} ${pick(rng, PAPER_NAMES)}`,
    transitLine: `${pick(rng, ["Blue", "Green", "Copper", "Harbor", "Crosstown"])} Line`,
    busLines: [
      `the ${1 + Math.floor(rng() * 8)} bus`,
      `the ${10 + Math.floor(rng() * 30)} bus`,
      `the ${pick(rng, ["Nightowl", "Circulator", "Express", "Limited"])}`,
    ],
  };
}

// --- Template filling ----------------------------------------------------------

function fillTemplate(rng: () => number, template: string): string {
  return template
    .replace("{F2}", pick(rng, FOUNDER_NAMES))
    .replace("{F}", pick(rng, FOUNDER_NAMES))
    .replace("{T}", pick(rng, rng() < 0.7 ? TREE_NAMES : NATURE_NAMES))
    .replace("{B}", pick(rng, BIRD_NAMES))
    .replace("{N}", String(1 + Math.floor(rng() * 19)));
}

// Draw until unused (bounded); fall back to a numbered variant so the loop
// always terminates even when a pool runs dry.
function uniqueFill(rng: () => number, templates: string[], used: Set<string>): string {
  for (let i = 0; i < 12; i++) {
    const name = fillTemplate(rng, pick(rng, templates));
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const base = fillTemplate(rng, pick(rng, templates));
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

// --- Districts -----------------------------------------------------------------

function nameDistricts(masterSeed: string, districts: District[]): Map<string, string> {
  const rng = seedrandom(`${masterSeed}::names::districts`);
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const d of districts) {
    out.set(d.id, uniqueFill(rng, DISTRICT_TEMPLATES[d.character], used));
  }
  return out;
}

// --- Streets -------------------------------------------------------------------

type NamedRoad = {
  id: string;
  vertices: Array<{ x: number; z: number }>;
  tier: "highway" | "arterial" | "minor";
  width: number;
};

function nameStreets(masterSeed: string, roads: NamedRoad[]): Map<string, string> {
  const rng = seedrandom(`${masterSeed}::names::streets`);
  const used = new Set<string>();
  const out = new Map<string, string>();

  // A seeded per-city street "theme": which base-name pools this town leans on.
  // Trees are always in; the rest shuffles per seed so cities feel distinct.
  const pools: string[][] = [TREE_NAMES, FOUNDER_NAMES, NATURE_NAMES, BIRD_NAMES];
  const poolWeights = [0.4, 0.25 + rng() * 0.2, 0.2, rng() < 0.5 ? 0.15 : 0];

  const baseName = (): string => {
    let r = rng() * poolWeights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pools.length; i++) {
      r -= poolWeights[i];
      if (r <= 0) return pick(rng, pools[i]);
    }
    return pick(rng, TREE_NAMES);
  };

  let highwayNumber = 1 + Math.floor(rng() * 8); // odd routes feel more real
  if (highwayNumber % 2 === 0) highwayNumber += 1;

  // Downtown ordinal grid: a run of minor streets gets numbered names instead,
  // capped so ordinals stay a flavour, not the norm.
  let ordinalsLeft = Math.floor(rng() * ORDINALS.length);
  const ordinalSuffix = rng() < 0.5 ? "Street" : "Avenue";
  let nextOrdinal = 0;

  for (const road of roads) {
    let name: string;
    if (road.tier === "highway") {
      const style = rng();
      name =
        style < 0.45
          ? `Highway ${highwayNumber}`
          : style < 0.75
            ? `${baseName()} Expressway`
            : `The ${pick(rng, ["Loop", "Beltway", "Crosstown", "Bypass"])}`;
      highwayNumber += 2 + 2 * Math.floor(rng() * 3);
      // Highways may share a display name across segments in reality, but our
      // ids are per-polyline; keep them unique for lookups.
      if (used.has(name)) name = `${name} North`;
      used.add(name);
    } else if (road.tier === "minor" && ordinalsLeft > 0 && nextOrdinal < ORDINALS.length && rng() < 0.3) {
      name = `${ORDINALS[nextOrdinal++]} ${ordinalSuffix}`;
      ordinalsLeft--;
      used.add(name);
    } else {
      // Suffix pool follows the road's actual LENGTH, not just its tier — a
      // 2 km "minor" road named Court reads wrong (user 2026-07-08).
      let length = 0;
      for (let i = 0; i < road.vertices.length - 1; i++) {
        length += Math.hypot(
          road.vertices[i + 1].x - road.vertices[i].x,
          road.vertices[i + 1].z - road.vertices[i].z,
        );
      }
      const suffixes =
        road.tier === "arterial" || length > 1200
          ? ARTERIAL_SUFFIXES
          : length > 500
            ? ["Street", "Street", "Way", "Terrace", "Row"]
            : MINOR_SUFFIXES;
      for (let attempt = 0; ; attempt++) {
        const candidate = `${baseName()} ${pick(rng, suffixes)}`;
        if (!used.has(candidate)) {
          name = candidate;
          used.add(candidate);
          break;
        }
        if (attempt >= 20) {
          // Pools exhausted (huge cities): extend with a cardinal.
          name = `${candidate.replace(/ /, " " + pick(rng, ["North", "South", "East", "West"]) + " ")}`;
          used.add(name);
          break;
        }
      }
    }
    out.set(road.id, name);
  }
  return out;
}

// --- Addresses -----------------------------------------------------------------

// Nearest-road lookup via a spatial hash of road segments — the brute-force
// scan was O(buildings × segments) ≈ 20 s at the 6 km tier; the grid brings the
// whole address pass under a second.
type Segment = {
  road: NamedRoad;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  len: number;
  cumStart: number; // arc length along the road at this segment's start
};

const ADDR_CELL = 150; // metres per hash cell

function cellKey(cx: number, cz: number): number {
  // Offset into positive space; city coords stay well inside ±2^15 cells.
  return (cx + 32768) * 65536 + (cz + 32768);
}

function buildSegmentGrid(roads: NamedRoad[]): Map<number, Segment[]> {
  const grid = new Map<number, Segment[]>();
  for (const road of roads) {
    const v = road.vertices;
    let cursor = 0;
    for (let i = 0; i < v.length - 1; i++) {
      const ax = v[i].x;
      const az = v[i].z;
      const bx = v[i + 1].x;
      const bz = v[i + 1].z;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const seg: Segment = { road, ax, az, bx, bz, len, cumStart: cursor };
      cursor += len;
      // Insert into every cell the segment's bbox overlaps.
      const minCx = Math.floor(Math.min(ax, bx) / ADDR_CELL);
      const maxCx = Math.floor(Math.max(ax, bx) / ADDR_CELL);
      const minCz = Math.floor(Math.min(az, bz) / ADDR_CELL);
      const maxCz = Math.floor(Math.max(az, bz) / ADDR_CELL);
      for (let cx = minCx; cx <= maxCx; cx++)
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = cellKey(cx, cz);
          const list = grid.get(key);
          if (list) list.push(seg);
          else grid.set(key, [seg]);
        }
    }
  }
  return grid;
}

type SegmentHit = { seg: Segment; dist: number; along: number; side: 0 | 1 };

function nearestSegment(grid: Map<number, Segment[]>, x: number, z: number): SegmentHit | null {
  const cx0 = Math.floor(x / ADDR_CELL);
  const cz0 = Math.floor(z / ADDR_CELL);
  let best: SegmentHit | null = null;
  // Expand square rings until the best hit provably beats anything a farther
  // ring could contain (ring r's cells start at (r-1)*CELL away), capped for
  // pathological empty maps.
  for (let r = 0; r <= 24; r++) {
    if (best && best.dist < (r - 1) * ADDR_CELL) break;
    for (let cx = cx0 - r; cx <= cx0 + r; cx++)
      for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
        if (Math.max(Math.abs(cx - cx0), Math.abs(cz - cz0)) !== r) continue; // ring only
        const segs = grid.get(cellKey(cx, cz));
        if (!segs) continue;
        for (const seg of segs) {
          const dx = seg.bx - seg.ax;
          const dz = seg.bz - seg.az;
          let t = ((x - seg.ax) * dx + (z - seg.az) * dz) / (seg.len * seg.len);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = seg.ax + t * dx;
          const pz = seg.az + t * dz;
          const d = Math.hypot(x - px, z - pz);
          if (!best || d < best.dist) {
            best = {
              seg,
              dist: d,
              along: seg.cumStart + t * seg.len,
              side: (x - seg.ax) * dz - (z - seg.az) * dx >= 0 ? 0 : 1,
            };
          }
        }
      }
  }
  return best;
}

function assignAddresses(
  buildings: Building[],
  roads: NamedRoad[],
  streetNames: Map<string, string>,
): Map<number, Address> {
  const out = new Map<number, Address>();
  // Highways don't take addresses — buildings front local streets/arterials.
  const grid = buildSegmentGrid(roads.filter((r) => r.tier !== "highway"));
  const taken = new Set<string>();
  for (const b of buildings) {
    const hit = nearestSegment(grid, b.x, b.z);
    if (!hit) continue;
    // US-style numbering: hundreds advance per ~85 m block; evens on one side,
    // odds on the other; numbers advance along the street.
    const block = Math.floor(hit.along / 85) + 1;
    const withinBlock = 2 * Math.floor(((hit.along % 85) / 85) * 24);
    let number = block * 100 + withinBlock + hit.side;
    const street = streetNames.get(hit.seg.road.id) ?? "Unnamed Road";
    // Two buildings can project to the same along-position (front/back of the
    // same lot) — bump by a full house-number step until the address is unique.
    while (taken.has(`${street}#${number}`)) number += 2;
    taken.add(`${street}#${number}`);
    out.set(b.id, {
      number,
      street,
      roadId: hit.seg.road.id,
      districtId: b.districtId,
    });
  }
  return out;
}

// --- Building names --------------------------------------------------------------

function nameBuildings(masterSeed: string, buildings: Building[]): Map<number, string> {
  const rng = seedrandom(`${masterSeed}::names::buildings`);
  const used = new Set<string>();
  const out = new Map<number, string>();
  for (const b of buildings) {
    // One draw per building whether named or not, so the stream stays aligned
    // if probabilities are tuned later.
    const roll = rng();
    if (roll < NAMED_BUILDING_PROB[b.archetype]) {
      out.set(b.id, uniqueFill(rng, BUILDING_TEMPLATES[b.archetype], used));
    }
  }
  return out;
}

// --- Entry point ------------------------------------------------------------------

function namedRoadsFor(masterSeed: string, shape: CityShapeSetting, shapeScale: number): NamedRoad[] {
  const city = generateCity(masterSeed, shape, shapeScale);
  return [
    ...city.topology.highways.map((h) => ({ id: h.id, vertices: h.vertices, tier: "highway" as const, width: h.width })),
    ...city.arterials.map((r) => ({ id: r.id, vertices: r.vertices, tier: "arterial" as const, width: r.width })),
    ...city.streets.map((r) => ({ id: r.id, vertices: r.vertices, tier: "minor" as const, width: r.width })),
  ];
}

function buildCityNamesImpl(
  masterSeed: string,
  shape: CityShapeSetting,
  shapeScale: number,
): CityNames {
  const city = generateCity(masterSeed, shape, shapeScale);
  const roads = namedRoadsFor(masterSeed, shape, shapeScale);
  const streetNames = nameStreets(masterSeed, roads);
  const addresses = assignAddresses(city.buildings, roads, streetNames);
  const buildingsByRoad = new Map<string, number[]>();
  for (const [buildingId, address] of addresses) {
    const list = buildingsByRoad.get(address.roadId) ?? [];
    list.push(buildingId);
    buildingsByRoad.set(address.roadId, list);
  }
  // Present in address (block) order so a hover list reads like a street walk.
  for (const list of buildingsByRoad.values()) {
    list.sort((a, b) => (addresses.get(a)?.number ?? 0) - (addresses.get(b)?.number ?? 0));
  }
  let maxAddressDigits = 1;
  for (const address of addresses.values()) {
    maxAddressDigits = Math.max(maxAddressDigits, String(address.number).length);
  }
  return {
    city: makeCityIdentity(masterSeed),
    districtNames: nameDistricts(masterSeed, city.districts),
    streetNames,
    addresses,
    buildingNames: nameBuildings(masterSeed, city.buildings),
    buildingsByRoad,
    maxAddressDigits,
  };
}

// --- Road hover query ---------------------------------------------------------

export type RoadHit = {
  roadId: string;
  name: string;
  tier: "highway" | "arterial" | "minor";
  width: number;
  dist: number; // metres from the query point to the centreline
  vertices: Array<{ x: number; z: number }>;
};

export type RoadQuery = { nearestRoad(x: number, z: number, slack?: number): RoadHit | null };

// Cursor → road lookup for the inspect-mode road hover. Separate grid from the
// address pass: this one includes highways (they have names too) and returns a
// hit only when the point is actually ON the roadbed (within width/2 + slack).
const roadQueryCache = new Map<string, RoadQuery>();

export function roadQueryFor(
  masterSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
): RoadQuery {
  const key = `${masterSeed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}::${densityProfileKey()}`;
  const hit = roadQueryCache.get(key);
  if (hit) return hit;
  const roads = namedRoadsFor(masterSeed, shape, shapeScale);
  const names = buildCityNames(masterSeed, shape, shapeScale);
  const roadById = new Map(roads.map((r) => [r.id, r]));
  const grid = buildSegmentGrid(roads);
  const query: RoadQuery = {
    nearestRoad(x, z, slack = 4) {
      const seg = nearestSegment(grid, x, z);
      if (!seg) return null;
      const road = roadById.get(seg.seg.road.id);
      if (!road || seg.dist > road.width / 2 + slack) return null;
      return {
        roadId: road.id,
        name: names.streetNames.get(road.id) ?? "Unnamed Road",
        tier: road.tier,
        width: road.width,
        dist: seg.dist,
        vertices: road.vertices,
      };
    },
  };
  if (roadQueryCache.size > 8) roadQueryCache.clear();
  roadQueryCache.set(key, query);
  return query;
}

// Memoised like generateCity/buildPopulationField — same cache-key recipe so
// anything that changes the city (tier extent, sketch, deviation) misses here.
const namesCache = new Map<string, CityNames>();

export function buildCityNames(
  masterSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
): CityNames {
  const key = `${masterSeed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}::${densityProfileKey()}`;
  const hit = namesCache.get(key);
  if (hit) return hit;
  const result = buildCityNamesImpl(masterSeed, shape, shapeScale);
  if (namesCache.size > 16) namesCache.clear();
  namesCache.set(key, result);
  return result;
}
