// Tenancy layout: place a building's REAL tenants (featured households +
// businesses) as volumetric units on the facade, bay-aligned to the window grid,
// scattered by floor + unit letter, and sized by scale (a big employer takes a
// whole floor or several). No filler — only nameable, selectable tenants.
// Ported + evolved from public/prototypes/tenancy-layout.html (see
// wiki/projects/persona-presence-editorial).
//
// Determinism: pure function on its own `${seed}::personas::tenancy::${buildingId}`
// stream — never perturbs generation, re-rolls nothing.
//
// Coords are the building's CENTRED unit box: x,z in [-0.5, 0.5] (floor plate),
// floor indices in [0, floors). A unit's outward face sits on the plate edge so
// it lines up with windows; the box extends inward by `depth`. A corner unit
// touches two edges, so it wraps the corner.

import type { Building } from "./cityGen";
import type { Household, Business } from "./personas";
import type { WorkplaceType } from "./personaData";
import type { DistrictCharacter } from "./district";

export type TenantKind = "home" | "penthouse" | "office" | "storefront" | "department" | "civic" | "industrial";

export type LightSignature = { hex: string; intensity: number; variance: number; darkChance: number };

export type TenantRegion = {
  kind: TenantKind;
  label: string;
  householdIndex?: number;
  businessId?: string;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  floorStart: number;
  floorEnd: number; // exclusive
  light: LightSignature;
};

type Box = { xMin: number; xMax: number; zMin: number; zMax: number };

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const SHOP_CHARACTERS: ReadonlySet<DistrictCharacter> = new Set([
  "downtown",
  "subcentre",
  "heritage",
  "mixed-use",
]);
const RETAIL_KINDS: ReadonlySet<WorkplaceType> = new Set<WorkplaceType>(["retail", "shop", "restaurant"]);
const OFFICE_KINDS: ReadonlySet<WorkplaceType> = new Set<WorkplaceType>([
  "office",
  "civic",
  "lab",
  "studio",
  "hospital",
]);
const INDUSTRIAL_KINDS: ReadonlySet<WorkplaceType> = new Set<WorkplaceType>(["factory", "warehouse"]);
const CORE_PROXIMITY_DOWNTOWN = 0.4;

const HOME_LIGHTS = ["#f2a24a", "#f0b060", "#e8974e", "#ffb968"];
const SHOP_LIGHTS_MAIN = ["#f0b060", "#d6efe8", "#ff6bb0", "#67f2a6", "#5bb8ff", "#f2a24a", "#ffd27a"];
const SHOP_LIGHTS_DOWNTOWN = ["#f0b060", "#d6efe8", "#f2a24a", "#eaf2ff"];

function lightFor(kind: TenantKind, character: DistrictCharacter, rng: () => number): LightSignature {
  switch (kind) {
    case "department":
      return { hex: "#eef4ff", intensity: 0.95, variance: 0.12, darkChance: 0.02 };
    case "office":
      return { hex: "#cfe0f2", intensity: 0.6, variance: 0.55, darkChance: 0.5 };
    case "civic":
      return { hex: "#e6ecf0", intensity: 0.7, variance: 0.4, darkChance: 0.35 };
    case "industrial":
      return { hex: "#cdd6c8", intensity: 0.4, variance: 0.5, darkChance: 0.55 };
    case "penthouse":
      return { hex: "#ffd27a", intensity: 0.9, variance: 0.3, darkChance: 0.1 };
    case "home":
      return { hex: pick(rng, HOME_LIGHTS), intensity: 0.58, variance: 0.55, darkChance: 0.36 };
    case "storefront": {
      const mainStreet = character === "heritage" || character === "mixed-use";
      return {
        hex: pick(rng, mainStreet ? SHOP_LIGHTS_MAIN : SHOP_LIGHTS_DOWNTOWN),
        intensity: mainStreet ? 0.55 + rng() * 0.45 : 0.72 + rng() * 0.28,
        variance: 0.3,
        darkChance: mainStreet ? 0.16 : 0.05,
      };
    }
    default:
      return { hex: "#8896a4", intensity: 0.5, variance: 0.4, darkChance: 0.3 };
  }
}

// Mirrors unitFor() in personas.ts: a household's floor is a deterministic spread
// up the building, so a highlight lands on the same floor its "4B" label names.
function homeFloor(index: number, count: number, floors: number): number {
  if (count <= 1) return Math.min(1, floors - 1);
  return 1 + Math.floor((index / count) * (Math.max(2, floors) - 1));
}

// A bay-aligned unit on one face, extended inward by `depth`. Face ids match the
// cityInstanced shader: 0=+X, 1=-X, 2=+Z, 3=-Z. Bays run along Z for X-faces and
// along X for Z-faces (matching the shader's cell mapping).
function faceBox(face: number, bay0: number, bay1: number, cols: number, depth: number): Box {
  const u0 = bay0 / cols - 0.5;
  const u1 = bay1 / cols - 0.5;
  const inner = 0.5 - depth;
  if (face === 0) return { xMin: inner, xMax: 0.5, zMin: u0, zMax: u1 };
  if (face === 1) return { xMin: -0.5, xMax: -inner, zMin: u0, zMax: u1 };
  if (face === 2) return { xMin: u0, xMax: u1, zMin: inner, zMax: 0.5 };
  return { xMin: u0, xMax: u1, zMin: -0.5, zMax: -inner };
}

// A corner unit spanning `bays` on both adjacent faces (wraps the corner).
// corner: 0=+X+Z, 1=-X+Z, 2=+X-Z, 3=-X-Z (maps unit letter A/B/C/D → a position).
function cornerBox(corner: number, bays: number, cols: number): Box {
  const w = Math.min(0.48, bays / cols);
  const xPos = corner === 0 || corner === 2;
  const zPos = corner === 0 || corner === 1;
  return {
    xMin: xPos ? 0.5 - w : -0.5,
    xMax: xPos ? 0.5 : -0.5 + w,
    zMin: zPos ? 0.5 - w : -0.5,
    zMax: zPos ? 0.5 : -0.5 + w,
  };
}

const FULL_PLATE: Box = { xMin: -0.5, xMax: 0.5, zMin: -0.5, zMax: 0.5 };

export function tenancyLayout(
  building: Building,
  households: readonly Household[],
  businesses: readonly Business[],
  character: DistrictCharacter,
  rng: () => number,
): TenantRegion[] {
  const cols = building.colsPerFace;
  const floors = building.floors;
  const isCore = building.coreProximity > CORE_PROXIMITY_DOWNTOWN;
  const hasShops = SHOP_CHARACTERS.has(character);
  const regions: TenantRegion[] = [];

  const retail = businesses.filter((b) => RETAIL_KINDS.has(b.kind));
  const work = businesses.filter((b) => OFFICE_KINDS.has(b.kind));
  const heavy = businesses.filter((b) => INDUSTRIAL_KINDS.has(b.kind));
  const schools = businesses.filter((b) => b.kind === "school");

  // Single-use shell: a school / factory / warehouse fills the whole building.
  const solo =
    households.length === 0 && work.length === 0 && retail.length === 0 ? (schools[0] ?? heavy[0]) : undefined;
  if (solo) {
    const kind: TenantKind = solo.kind === "school" || solo.kind === "civic" ? "civic" : "industrial";
    return [
      {
        kind,
        label: solo.name,
        businessId: solo.id,
        ...FULL_PLATE,
        floorStart: 0,
        floorEnd: floors,
        light: lightFor(kind, character, rng),
      },
    ];
  }

  const depth = Math.min(0.34, Math.max(0.18, 2.2 / Math.max(3, cols))); // ~2 bays deep
  const cornerBays = Math.max(2, Math.min(4, Math.round(cols / 3)));
  const shopW = Math.max(2, Math.min(cols, 3));

  // Ground-floor retail in shop districts — storefronts around the base.
  if (hasShops && retail.length > 0) {
    retail.forEach((biz, i) => {
      const kind: TenantKind = isCore && floors >= 8 ? "department" : "storefront";
      const face = i % 4;
      const b0 = Math.min(Math.max(0, cols - shopW), (i * 2) % Math.max(1, cols - shopW + 1));
      regions.push({
        kind,
        label: biz.name,
        businessId: biz.id,
        ...faceBox(face, b0, b0 + shopW, cols, depth),
        floorStart: 0,
        floorEnd: 1,
        light: lightFor(kind, character, rng),
      });
    });
  }

  // Work tenants: sized by headcount (a big employer takes a full floor, or
  // several), distributed up the building.
  const workStart = hasShops && retail.length > 0 ? 1 : 0;
  work.forEach((biz, i) => {
    // Full headcount comes from the directory build now (#96) — same seeded
    // estimate this file used to own, so unit sizing is unchanged.
    const emp = biz.totalHeadcount;
    const floor = Math.min(
      floors - 1,
      Math.max(workStart, Math.round(((i + 0.5) / Math.max(1, work.length)) * (floors - 1))),
    );
    let box: Box;
    let span = 1;
    if (emp >= 24) {
      box = FULL_PLATE;
      span = Math.min(3, 1 + Math.floor(emp / 30));
    } else if (emp >= 8) {
      box = FULL_PLATE;
    } else {
      const face = i % 4;
      const b0 = Math.min(Math.max(0, cols - shopW), (i * 3) % Math.max(1, cols - shopW + 1));
      box = faceBox(face, b0, b0 + shopW, cols, depth);
    }
    regions.push({
      kind: "office",
      label: biz.name,
      businessId: biz.id,
      ...box,
      floorStart: floor,
      floorEnd: Math.min(floors, floor + span),
      light: lightFor("office", character, rng),
    });
  });

  // Households: scattered by unit letter (→ corner) on their real floor, so
  // "1A" and "2B" don't stack in a column.
  const count = households.length;
  households.forEach((h) => {
    const floor = Math.min(floors - 1, homeFloor(h.index, count, floors));
    const penthouse = isCore && floors >= 12 && !building.archetype.startsWith("low") && floor >= floors - 1;
    const kind: TenantKind = penthouse ? "penthouse" : "home";
    regions.push({
      kind,
      label: h.label,
      householdIndex: h.index,
      ...cornerBox(h.index % 4, cornerBays, cols),
      floorStart: floor,
      floorEnd: floor + 1,
      light: lightFor(kind, character, rng),
    });
  });

  return regions;
}

export function regionForHousehold(regions: readonly TenantRegion[], householdIndex: number): TenantRegion | undefined {
  return regions.find((r) => r.householdIndex === householdIndex);
}

export function regionForBusiness(regions: readonly TenantRegion[], businessId: string): TenantRegion | undefined {
  return regions.find((r) => r.businessId === businessId);
}

/** The unit under a local-space facade hit — the SMALLEST containing region wins
 *  (a household corner beats a full-floor office slab on the same floor). */
export function regionAtLocal(
  regions: readonly TenantRegion[],
  x: number,
  z: number,
  floor: number,
): TenantRegion | undefined {
  let best: TenantRegion | undefined;
  let bestArea = Infinity;
  for (const r of regions) {
    if (floor < r.floorStart || floor >= r.floorEnd) continue;
    if (x < r.xMin || x > r.xMax || z < r.zMin || z > r.zMax) continue;
    const area = (r.xMax - r.xMin) * (r.zMax - r.zMin) * (r.floorEnd - r.floorStart);
    if (area < bestArea) {
      best = r;
      bestArea = area;
    }
  }
  return best;
}
