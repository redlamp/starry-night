import seedrandom from "seedrandom";
import { generateCity, type Building, type Archetype } from "./cityGen";
import type { DistrictCharacter } from "./district";
import { buildingPopulation } from "./population";
import { buildCityNames, TREE_NAMES, type CityNames } from "./naming";
import { firstNameForBirthYear } from "./nameCohorts";
import { maxHalfExtent } from "./topology";
import { sketchKey } from "./citySketch";
import { fieldDeviation } from "./tensorField";
import { densityProfileKey } from "./density";
import type { CityShapeSetting } from "./cityShape";
import {
  MASCULINE_FIRST_NAMES,
  FEMININE_FIRST_NAMES,
  LAST_NAMES,
  PROFESSIONS,
  ETHNICITY_WEIGHTS,
  SURNAME_AFFINITY,
  EDUCATION_LABELS,
  DEGREE_SUBJECTS,
  MBTI_AXIS_WEIGHTS,
  MBTI_NICKNAMES,
  WESTERN_ZODIAC,
  westernSignFor,
  chineseSignFor,
  type Profession,
  type ProfessionCategory,
  type WorkplaceType,
  type Ethnicity,
  type GenderIdentity,
  type WesternSign,
  type ChineseSign,
  type EducationTier,
} from "./personaData";
import { weaveStories, type PersonaStory, type ShiftKind, type CityLoreEntry } from "./personaStory";

// Story layer types ride along for consumers (panel, scripts).
export type { PersonaStory, StoryRelation, CityLoreEntry, ShiftKind } from "./personaStory";

// Persona layer: a *featured* subset of each building's estimated residents,
// fully realised as characters — names, birthdays (→ zodiac signs), MBTI,
// demographics, education, professions, households/family trees, and a
// city-wide weave of jobs and dating pairs. Everything is a pure function of
// the master seed on its own `${seed}::personas::*` streams; existing
// generators' draw order is untouched. The featured count deliberately
// undershoots buildingPopulation() — these are the residents whose windows you
// happen to look into, not a census (the panel shows both numbers).

// The in-world "tonight". Ages and years-in-city are measured against this
// fixed date, never Date.now() — the city is one endless night.
export const CITY_EPOCH = { year: 2026, month: 7, day: 1 } as const;

// --- Types ---------------------------------------------------------------------

export type PersonaId = string; // "p:<buildingId>:<household>:<slot>"

export type RelationshipStatus = "single" | "dating" | "married" | "widowed" | "divorced";

export type CommuteMode = "walk" | "cycle" | "transit" | "drive" | "bus";

export type WorkStatus =
  | "employed"
  | "works from home"
  | "commutes out of the city"
  | "between jobs"
  | "retired"
  | "student"
  | "homemaker";

export type FamilyRole = "partner" | "parent" | "child" | "sibling";

export type FamilyLink = { role: FamilyRole; personaId: PersonaId };

// A relative who exists only as a name — lives outside the city (or outside
// the featured set). Deliberate negative space for the player to fill.
export type OffstageRelative = { role: string; name: string };

export type Persona = {
  id: PersonaId;
  givenName: string;
  middleInitial?: string;
  familyName: string;
  fullName: string;
  age: number;
  birthday: { year: number; month: number; day: number };
  westernSign: WesternSign; // the sun sign
  // The rest of the "big three" — fake ephemeris, seeded per persona (real
  // moon/ascendant need birth-time astronomy; these are character flavour).
  moonSign: string;
  risingSign: string;
  birthHour: number; // 0-23, the "birth time" the rising sign hangs off
  chineseSign: ChineseSign;
  // Physical descriptors (adults only; undefined for kids).
  heightCm?: number;
  build?: string;
  mbti: string;
  mbtiNickname: string;
  ethnicity: Ethnicity;
  genderIdentity: GenderIdentity;
  pronouns: string;
  // Place
  homeBuildingId: number;
  homeDistrictId: string;
  householdIndex: number;
  unit?: string; // "4B" — only in multi-household buildings
  yearsInCity: number; // === age means born here
  bornHere: boolean;
  // Work & education
  profession?: Profession;
  workStatus: WorkStatus;
  businessId?: string; // when employed at a featured business
  schoolId?: string; // school-age kids: the school Business they attend
  // How they get to work/school, with the straight-line distance in metres.
  commute?: { mode: CommuteMode; distance: number };
  // Where the commute arc lands: the work building for the employed, the
  // school building for kids. Resolved here so overlays don't re-derive it.
  commuteTargetBuildingId?: number;
  education: string;
  educationDetail?: string; // "Nursing, Fairhaven State University"
  // Relationships
  relationshipStatus: RelationshipStatus;
  partnerId?: PersonaId;
  family: FamilyLink[];
  offstage: OffstageRelative[];
  // Story layer — filled by weaveStories() as the directory's final pass.
  schedule: { shift: ShiftKind };
  story: PersonaStory;
  // The Grinblat "domain word": one concrete noun-world this persona's lines
  // orbit (crows, tide charts, matchbooks). Coherence through repetition.
  domain: string;
};

export type Business = {
  id: string; // "biz:<buildingId>:<n>"
  name: string;
  kind: WorkplaceType;
  buildingId: number;
  employeeIds: PersonaId[];
  // Profession categories this business reads as belonging to ("Mendoza &
  // Partners" should employ paralegals, not bellhops). Employment prefers an
  // affine match; undefined = takes anyone with the right workplace kind.
  affinity?: ProfessionCategory[];
  // Sharper than affinity: exact titles this business exists for ("{F} Dental"
  // hires dentists and hygienists, not paramedics).
  titleAffinity?: string[];
  // Schools only: the kids enrolled here (staff stay in employeeIds).
  studentIds?: PersonaId[];
  // Schools only: which tier of kid this school takes.
  schoolTier?: "elementary" | "middle" | "high";
};

export type Household = {
  buildingId: number;
  index: number;
  unit?: string;
  memberIds: PersonaId[];
  label: string; // "The Ramos family", "Chen & Novak (roommates)"
};

export type PersonaDirectory = {
  personas: Map<PersonaId, Persona>;
  households: Household[];
  byHomeBuilding: Map<number, Household[]>;
  businesses: Map<string, Business>;
  byWorkBuilding: Map<number, Business[]>;
  names: CityNames;
  lore: CityLoreEntry[];
  totals: { personas: number; households: number; businesses: number };
};

// --- Tuning ---------------------------------------------------------------------

// People-equivalent → featured households: one household per ~40 population,
// capped so towers don't become phone books. A global soft cap rescales in
// huge extent tiers so the directory stays a few thousand personas.
const POP_PER_HOUSEHOLD = 40;
const MAX_HOUSEHOLDS_PER_BUILDING = 6;
const TARGET_MAX_PERSONAS = 4000;

// Residential capacity by archetype — mirrors population.ts's occupancy story.
const RESIDENTIAL_ARCHETYPES: ReadonlySet<Archetype> = new Set([
  "residential-tower",
  "mid-rise",
  "low-rise",
]);

// Which archetypes host featured businesses, and what kinds they lean toward.
const BUSINESS_KINDS: Partial<Record<Archetype, WorkplaceType[]>> = {
  spire: ["office", "office", "office", "civic", "lab"],
  "office-block": ["office", "office", "hospital", "civic", "studio", "lab"],
  "narrow-tower": ["office", "studio", "office"],
  warehouse: ["warehouse", "factory", "transit"],
  "mid-rise": ["retail", "restaurant", "shop", "studio", "school"],
  "low-rise": ["retail", "restaurant", "shop", "school"],
};

// How many businesses a hosting building carries.
const BUSINESS_COUNT: Partial<Record<Archetype, number>> = {
  spire: 3,
  "office-block": 2,
  "narrow-tower": 1,
  warehouse: 1,
  "mid-rise": 1,
  "low-rise": 1,
};

// Ground-floor shops only make sense where the street life is — mirrors the
// #86 storefront shader flag's districts.
const SHOP_DISTRICTS: ReadonlySet<DistrictCharacter> = new Set([
  "downtown",
  "subcentre",
  "heritage",
  "mixed-use",
]);

// Home-district → profession-category multipliers. Light thumbs on the scale
// (people plausibly live near their work), never hard rules.
const DISTRICT_CATEGORY_WEIGHT: Partial<
  Record<DistrictCharacter, Partial<Record<ProfessionCategory, number>>>
> = {
  downtown: { Technology: 2, Finance: 2.5, Legal: 2, Management: 1.8, "Arts & Media": 1.4 },
  subcentre: { Technology: 1.6, Finance: 1.5, "Office & Admin": 1.5, Sales: 1.4 },
  heritage: { "Arts & Media": 2, "Food Service": 1.6, "Personal Care": 1.4, Retail: 1.3 },
  residential: { Education: 1.6, Healthcare: 1.4, "Office & Admin": 1.2 },
  industrial: { Manufacturing: 3, Transportation: 2.2, "Construction & Trades": 2 },
  "mixed-use": { Retail: 1.5, "Food Service": 1.5, Hospitality: 1.3 },
};

// Business display names per kind: `{F}` founder surname, `{G}` a resident-style
// given name, `{S}` the building's street base name, `{C}` city name.
// Office businesses split into typed subpools so the name matches the staff:
// a bellhop belongs at "The Alder Hotel", a paralegal at "{F} & Partners".
export const OFFICE_SUBTYPES: Array<{ templates: string[]; affinity?: ProfessionCategory[]; weight: number }> = [
  {
    templates: ["{F} & {F2}", "{F} & Partners", "{C} Mutual", "{F} Capital"],
    affinity: ["Legal", "Finance"],
    weight: 3,
  },
  {
    templates: ["{F} Consulting", "Meridian {F} Group", "{F} Logistics", "{C} Standard Group"],
    weight: 4, // general corporate — takes any office worker
  },
  {
    templates: ["{S} Digital", "Northgate Systems", "Blue {T} Software"],
    affinity: ["Technology"],
    weight: 2,
  },
  {
    templates: ["The {T} Hotel", "Hotel {C}", "The {F} Arms Hotel"],
    affinity: ["Hospitality"],
    weight: 2,
  },
];

// Hospital-kind subpools: dental practices only make sense staffed by dental
// professions; clinics and urgent care take the rest of healthcare.
export const HOSPITAL_SUBTYPES: Array<{ templates: string[]; titleAffinity?: string[]; weight: number }> = [
  { templates: ["{S} Clinic", "{F} Family Practice", "{C} Urgent Care"], weight: 4 },
  { templates: ["{F} Dental"], titleAffinity: ["Dentist", "Dental Hygienist"], weight: 1 },
  { templates: ["{S} Animal Hospital"], titleAffinity: ["Veterinarian"], weight: 1 },
];

export const BUSINESS_TEMPLATES: Record<WorkplaceType, string[]> = {
  // office/hospital handled by their subtype tables; these pools are fallbacks.
  office: ["{F} Consulting", "Meridian {F} Group", "{F} Logistics"],
  hospital: ["{S} Clinic", "{F} Family Practice", "{C} Urgent Care"],
  school: ["{S} Learning Center", "Little {C} Daycare", "{F} Music School"],
  retail: ["{S} Market", "{F}'s Grocery", "{C} Hardware", "The {S} Bodega", "Night Owl Convenience"],
  restaurant: [
    "{G}'s Diner", "The {S} Café", "{F}'s Kitchen", "Bar {G}", "The Night Kitchen",
    "{S} Noodle House", "The Blue Plate",
  ],
  factory: ["{C} Fabrication", "{F} Machine Works", "{S} Plating Co."],
  warehouse: ["{F} Freight", "{C} Cold Storage", "Bay {N} Logistics", "{F} & Sons Moving"],
  civic: ["{C} Public Library", "{C} Records Office", "{S} Precinct", "{C} Transit Authority"],
  home: ["{G}'s Studio"],
  outdoor: ["{C} Parks Crew", "{F} Landscaping"],
  transit: ["{C} Transit Depot", "{F} Haulage"],
  studio: ["{S} Studio", "{G} & Co. Design", "{C} {P} Office", "Third Shift Media"],
  lab: ["{C} Diagnostics", "{F} Labs", "Meridian Research"],
  shop: [
    "{S} Street Books", "{F}'s Barbershop", "{G}'s Flowers", "The {S} Tailor",
    "{S} Records", "Lucky {N} Laundry", "{F} Shoe Repair",
  ],
};

// --- Small helpers ----------------------------------------------------------------

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick<T>(rng: () => number, entries: Array<{ value: T; weight: number }>): T {
  let total = 0;
  for (const e of entries) total += e.weight;
  let r = rng() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.value;
  }
  return entries[entries.length - 1].value;
}

// Triangular-ish int in [min, max] biased toward mid — ages, gaps, counts.
function midInt(rng: () => number, min: number, max: number): number {
  return Math.round(min + ((rng() + rng()) / 2) * (max - min));
}

function ageOn(epoch: typeof CITY_EPOCH, y: number, m: number, d: number): number {
  let age = epoch.year - y;
  if (m > epoch.month || (m === epoch.month && d > epoch.day)) age -= 1;
  return age;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Draw a birthday that lands the persona at exactly `targetAge` tonight.
function drawBirthday(
  rng: () => number,
  targetAge: number,
): { year: number; month: number; day: number } {
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * DAYS_IN_MONTH[month - 1]);
  const passed =
    month < CITY_EPOCH.month || (month === CITY_EPOCH.month && day <= CITY_EPOCH.day);
  const year = CITY_EPOCH.year - targetAge - (passed ? 0 : 1);
  return { year, month, day };
}

// --- Person assembly ----------------------------------------------------------------

type PersonSpec = {
  slot: number;
  presentation: "m" | "f"; // name-pool selector; identity drawn separately
  age: number;
  familyName: string;
  ethnicity: Ethnicity;
};

function drawEthnicity(rng: () => number): Ethnicity {
  return weightedPick(
    rng,
    ETHNICITY_WEIGHTS.map((e) => ({ value: e.ethnicity, weight: e.weight })),
  );
}

// Prefer (never force) an ethnicity-affine surname so names correlate softly.
function drawFamilyName(rng: () => number, ethnicity: Ethnicity): string {
  const affine = SURNAME_AFFINITY[ethnicity];
  if (affine && affine.length > 0 && rng() < 0.7) {
    const inPool = affine.filter((n) => LAST_NAMES.includes(n));
    if (inPool.length > 0) return pick(rng, inPool);
  }
  return pick(rng, LAST_NAMES);
}

function drawGenderIdentity(rng: () => number, presentation: "m" | "f"): GenderIdentity {
  // Slightly above current US population estimates by design (user
  // 2026-07-08) — see wiki/notes/pronoun-distribution.md for sources.
  const r = rng();
  if (r < 0.008) return presentation === "m" ? "trans man" : "trans woman";
  if (r < 0.033) return "nonbinary";
  return presentation === "m" ? "cis man" : "cis woman";
}

// Pronouns are drawn, not mapped 1:1 from identity — she/they and he/they
// exist among cis folks, and a slice of nonbinary residents use neopronouns.
function drawPronouns(rng: () => number, identity: GenderIdentity): string {
  const r = rng();
  switch (identity) {
    case "nonbinary":
      if (r < 0.7) return "they/them";
      if (r < 0.8) return "she/they";
      if (r < 0.9) return "he/they";
      return r < 0.95 ? "xe/xem" : "ze/zir";
    case "trans man":
      return r < 0.9 ? "he/him" : "he/they";
    case "trans woman":
      return r < 0.9 ? "she/her" : "she/they";
    case "cis man":
      return r < 0.97 ? "he/him" : "he/they";
    case "cis woman":
      return r < 0.96 ? "she/her" : "she/they";
  }
}

// T-shirt sizing for body descriptors (user 2026-07-08) — impersonal and
// judgment-free. Repeats weight the draw toward M/L.
const BUILDS = ["XS", "S", "S", "M", "M", "M", "M", "L", "L", "L", "XL", "XL", "XXL"];

function drawMbti(rng: () => number): string {
  return (
    (rng() < MBTI_AXIS_WEIGHTS.I ? "I" : "E") +
    (rng() < MBTI_AXIS_WEIGHTS.S ? "S" : "N") +
    (rng() < MBTI_AXIS_WEIGHTS.T ? "T" : "F") +
    (rng() < MBTI_AXIS_WEIGHTS.J ? "J" : "P")
  );
}

function drawProfession(rng: () => number, character: DistrictCharacter): Profession {
  const weights = DISTRICT_CATEGORY_WEIGHT[character] ?? {};
  return weightedPick(
    rng,
    PROFESSIONS.map((p) => ({ value: p, weight: weights[p.category] ?? 1 })),
  );
}

function drawEducation(
  rng: () => number,
  profession: Profession | undefined,
  age: number,
  names: CityNames,
): { education: string; educationDetail?: string } {
  if (age < 18) return { education: "In school" };
  // Attained level: profession's typical tier, nudged ±1 by life's variance.
  let tier: EducationTier = profession?.educationTier ?? 1;
  const wobble = rng();
  if (wobble < 0.15 && tier > 0) tier = (tier - 1) as EducationTier;
  else if (wobble > 0.88 && tier < 4) tier = (tier + 1) as EducationTier;
  if (age < 22 && tier > 2) tier = 2; // too young to have finished
  const education = pick(rng, EDUCATION_LABELS[tier]);
  if (tier < 2 || !profession) return { education };
  const subjects = DEGREE_SUBJECTS[profession.category];
  if (!subjects || rng() < 0.35) return { education };
  const school =
    rng() < 0.4 ? names.city.university : rng() < 0.5 ? names.city.college : undefined;
  return {
    education,
    educationDetail: school ? `${pick(rng, subjects)}, ${school}` : pick(rng, subjects),
  };
}

// --- Household composition -------------------------------------------------------------

type HouseholdKind =
  | "single"
  | "couple"
  | "family"
  | "single-parent"
  | "roommates"
  | "multigen"
  | "widowed-elder";

const HOUSEHOLD_MIX: Array<{ value: HouseholdKind; weight: number }> = [
  { value: "single", weight: 26 },
  { value: "couple", weight: 22 },
  { value: "family", weight: 26 },
  { value: "single-parent", weight: 8 },
  { value: "roommates", weight: 9 },
  { value: "multigen", weight: 5 },
  { value: "widowed-elder", weight: 4 },
];

function unitFor(building: Building, householdIndex: number, count: number): string | undefined {
  if (count <= 1) return undefined;
  const floors = Math.max(2, building.floors);
  // Spread units up the tower; letter cycles within a floor.
  const floor = 1 + Math.floor((householdIndex / count) * (floors - 1));
  const letter = String.fromCharCode(65 + (householdIndex % 4));
  return `${floor}${letter}`;
}

// --- The build --------------------------------------------------------------------------

function buildDirectoryImpl(
  masterSeed: string,
  shape: CityShapeSetting,
  shapeScale: number,
): PersonaDirectory {
  const city = generateCity(masterSeed, shape, shapeScale);
  const names = buildCityNames(masterSeed, shape, shapeScale);
  const districtById = new Map(city.districts.map((d) => [d.id, d]));

  const personas = new Map<PersonaId, Persona>();
  const households: Household[] = [];
  const byHomeBuilding = new Map<number, Household[]>();
  const businesses = new Map<string, Business>();
  const byWorkBuilding = new Map<number, Business[]>();

  // Buildings in ascending-id order — the canonical iteration order for every
  // pass, so the whole directory is order-stable.
  const buildings = [...city.buildings].sort((a, b) => a.id - b.id);

  // Global soft cap: estimate the featured count, derive one scale factor.
  let estimated = 0;
  const rawHouseholds = new Map<number, number>();
  for (const b of buildings) {
    if (!RESIDENTIAL_ARCHETYPES.has(b.archetype)) continue;
    const n = Math.max(
      1,
      Math.min(MAX_HOUSEHOLDS_PER_BUILDING, Math.round(buildingPopulation(b) / POP_PER_HOUSEHOLD)),
    );
    rawHouseholds.set(b.id, n);
    estimated += n * 2.4;
  }
  const hhScale = estimated > TARGET_MAX_PERSONAS ? TARGET_MAX_PERSONAS / estimated : 1;

  // ---- Pass 1: households + people ----
  for (const b of buildings) {
    const raw = rawHouseholds.get(b.id);
    if (!raw) continue;
    const count = Math.max(1, Math.floor(raw * hhScale));
    const district = districtById.get(b.districtId);
    const character: DistrictCharacter = district?.character ?? "residential";
    const homeList: Household[] = [];

    for (let h = 0; h < count; h++) {
      const rng = seedrandom(`${masterSeed}::personas::hh::${b.id}::${h}`);
      const kind = weightedPick(rng, HOUSEHOLD_MIX);

      // Shared household facts.
      const baseEthnicity = drawEthnicity(rng);
      const familyName = drawFamilyName(rng, baseEthnicity);
      const unit = unitFor(b, h, count);

      // Compose member specs (presentation/age/surname), then realise each.
      const specs: PersonSpec[] = [];
      const partnerEthnicity = rng() < 0.8 ? baseEthnicity : drawEthnicity(rng);
      const adultAge = () => midInt(rng, 23, 78);
      const pres = (): "m" | "f" => (rng() < 0.5 ? "m" : "f");

      switch (kind) {
        case "single": {
          specs.push({ slot: 0, presentation: pres(), age: midInt(rng, 22, 70), familyName, ethnicity: baseEthnicity });
          break;
        }
        case "couple": {
          const a = adultAge();
          const p1 = pres();
          const p2 = rng() < 0.9 ? (p1 === "m" ? "f" : "m") : p1;
          const sharedName = rng() < 0.65;
          specs.push({ slot: 0, presentation: p1, age: a, familyName, ethnicity: baseEthnicity });
          specs.push({
            slot: 1, presentation: p2, age: Math.max(21, a + midInt(rng, -6, 6)),
            familyName: sharedName ? familyName : drawFamilyName(rng, partnerEthnicity),
            ethnicity: partnerEthnicity,
          });
          break;
        }
        case "family": {
          const a = midInt(rng, 30, 52);
          const p1 = pres();
          const p2 = rng() < 0.9 ? (p1 === "m" ? "f" : "m") : p1;
          specs.push({ slot: 0, presentation: p1, age: a, familyName, ethnicity: baseEthnicity });
          specs.push({
            slot: 1, presentation: p2, age: Math.max(23, a + midInt(rng, -5, 5)),
            familyName: rng() < 0.75 ? familyName : drawFamilyName(rng, partnerEthnicity),
            ethnicity: partnerEthnicity,
          });
          const kids = 1 + Math.floor(rng() * (rng() < 0.75 ? 2 : 3));
          const mixed = "Multiracial";
          for (let k = 0; k < kids; k++) {
            specs.push({
              slot: 2 + k, presentation: pres(),
              age: Math.max(0, Math.min(a - 21, midInt(rng, 1, 17))),
              familyName,
              ethnicity: baseEthnicity === partnerEthnicity ? baseEthnicity : (mixed as Ethnicity),
            });
          }
          break;
        }
        case "single-parent": {
          const a = midInt(rng, 27, 48);
          specs.push({ slot: 0, presentation: pres(), age: a, familyName, ethnicity: baseEthnicity });
          const kids = 1 + Math.floor(rng() * 2);
          for (let k = 0; k < kids; k++) {
            specs.push({
              slot: 1 + k, presentation: pres(),
              age: Math.max(0, Math.min(a - 20, midInt(rng, 1, 16))),
              familyName, ethnicity: baseEthnicity,
            });
          }
          break;
        }
        case "roommates": {
          const n = 2 + Math.floor(rng() * 2);
          const base = midInt(rng, 22, 33);
          for (let k = 0; k < n; k++) {
            const eth = drawEthnicity(rng);
            specs.push({
              slot: k, presentation: pres(), age: Math.max(20, base + midInt(rng, -3, 4)),
              familyName: drawFamilyName(rng, eth), ethnicity: eth,
            });
          }
          break;
        }
        case "multigen": {
          const parentAge = midInt(rng, 36, 50);
          const p1 = pres();
          specs.push({ slot: 0, presentation: p1, age: parentAge, familyName, ethnicity: baseEthnicity });
          specs.push({
            slot: 1, presentation: p1 === "m" ? "f" : "m", age: Math.max(25, parentAge + midInt(rng, -4, 4)),
            familyName, ethnicity: partnerEthnicity,
          });
          specs.push({
            slot: 2, presentation: pres(), age: Math.max(1, Math.min(parentAge - 22, midInt(rng, 3, 15))),
            familyName,
            ethnicity: baseEthnicity === partnerEthnicity ? baseEthnicity : ("Multiracial" as Ethnicity),
          });
          specs.push({
            slot: 3, presentation: pres(), age: parentAge + midInt(rng, 24, 32),
            familyName, ethnicity: baseEthnicity,
          });
          break;
        }
        case "widowed-elder": {
          specs.push({ slot: 0, presentation: pres(), age: midInt(rng, 68, 90), familyName, ethnicity: baseEthnicity });
          break;
        }
      }

      // Realise each spec into a full persona.
      const memberIds: PersonaId[] = [];
      for (const spec of specs) {
        const id: PersonaId = `p:${b.id}:${h}:${spec.slot}`;
        const genderIdentity = drawGenderIdentity(rng, spec.presentation);
        const birthday = drawBirthday(rng, spec.age);
        const age = ageOn(CITY_EPOCH, birthday.year, birthday.month, birthday.day);

        // Names cohort-date people: drawn from the birth decade's real SSA
        // popularity table (nameCohorts.ts), so a 1948-born persona reads as
        // Barbara/Linda and a 2000-born one as Madison/Hannah.
        const namePoolKey: "m" | "f" =
          genderIdentity === "nonbinary" ? (rng() < 0.5 ? "m" : "f") : spec.presentation;
        const givenName = firstNameForBirthYear(rng, namePoolKey, birthday.year);
        const middleInitial =
          rng() < 0.22 ? String.fromCharCode(65 + Math.floor(rng() * 26)) : undefined;

        const isAdult = age >= 18;
        const retirable = age >= 66;
        let profession: Profession | undefined;
        let workStatus: WorkStatus;
        if (!isAdult) {
          workStatus = "student";
        } else if (retirable && rng() < 0.82) {
          workStatus = "retired";
          profession = drawProfession(rng, character); // their old line of work
        } else if (age <= 23 && rng() < 0.35) {
          workStatus = "student";
        } else {
          profession = drawProfession(rng, character);
          const r = rng();
          if (profession.workplaceType === "home") workStatus = "works from home";
          else if (r < 0.05) workStatus = "between jobs";
          else if (r < 0.09) workStatus = "homemaker";
          else workStatus = "employed";
        }

        // Kids inherit the household's move history: they can't have been in
        // the city longer than the adults who brought them (a kid "3y in
        // city" under a born-here parent reads as a bug, not a story).
        let bornHere = rng() < (character === "residential" || character === "heritage" ? 0.5 : 0.35);
        let yearsInCity = bornHere ? age : Math.min(age, midInt(rng, 1, Math.max(2, age - 2)));
        if (!isAdult) {
          const adultYears = memberIds
            .map((mid) => personas.get(mid)!)
            .filter((m) => m.age >= 18)
            .map((m) => m.yearsInCity);
          if (adultYears.length > 0) {
            const householdTenure = Math.max(...adultYears);
            yearsInCity = Math.min(age, householdTenure);
            bornHere = yearsInCity >= age;
          }
        }

        const mbti = drawMbti(rng);
        const edu = drawEducation(rng, profession, age, names);

        const pronouns = drawPronouns(rng, genderIdentity);
        // Fake-ephemeris big three: moon + rising drawn per persona; the
        // rising sign notionally hangs off a generated birth hour.
        const birthHour = Math.floor(rng() * 24);
        const moonSign = WESTERN_ZODIAC[Math.floor(rng() * 12)].name;
        const risingSign = WESTERN_ZODIAC[Math.floor(rng() * 12)].name;
        // Physical descriptors, adults only.
        const heightCm = isAdult
          ? Math.round(
              (spec.presentation === "m" ? 178 : 164) + (rng() + rng() + rng() - 1.5) * 9,
            )
          : undefined;
        const build = isAdult ? pick(rng, BUILDS) : undefined;

        // Sparse offstage relatives — negative space, not a full tree.
        const offstage: OffstageRelative[] = [];
        if (isAdult && rng() < 0.4) {
          const roles = ["mother", "father", "brother", "sister", "aunt", "uncle", "grandmother", "college roommate"];
          const pool = rng() < 0.5 ? MASCULINE_FIRST_NAMES : FEMININE_FIRST_NAMES;
          offstage.push({ role: pick(rng, roles), name: pick(rng, pool) });
        }

        personas.set(id, {
          id,
          givenName,
          middleInitial,
          familyName: spec.familyName,
          fullName: middleInitial
            ? `${givenName} ${middleInitial}. ${spec.familyName}`
            : `${givenName} ${spec.familyName}`,
          age,
          birthday,
          westernSign: westernSignFor(birthday.month, birthday.day),
          chineseSign: chineseSignFor(birthday.year),
          mbti,
          mbtiNickname: MBTI_NICKNAMES[mbti] ?? "",
          ethnicity: spec.ethnicity,
          genderIdentity,
          pronouns,
          moonSign,
          risingSign,
          birthHour,
          heightCm,
          build,
          homeBuildingId: b.id,
          homeDistrictId: b.districtId,
          householdIndex: h,
          unit,
          yearsInCity,
          bornHere,
          profession,
          workStatus,
          education: edu.education,
          educationDetail: edu.educationDetail,
          relationshipStatus: "single",
          family: [],
          offstage,
          // Placeholders — weaveStories() overwrites these before the
          // directory is returned.
          schedule: { shift: "day" },
          story: { hook: "", loreRefs: [] },
          domain: "",
        });
        memberIds.push(id);
      }

      // In-household family links + statuses.
      const link = (a: PersonaId, role: FamilyRole, to: PersonaId) => {
        personas.get(a)!.family.push({ role, personaId: to });
      };
      const setStatus = (pid: PersonaId, s: RelationshipStatus, partner?: PersonaId) => {
        const p = personas.get(pid)!;
        p.relationshipStatus = s;
        if (partner) p.partnerId = partner;
      };
      const ids = memberIds;
      if (kind === "couple" || kind === "family" || kind === "multigen") {
        const married = rng() < (kind === "couple" ? 0.7 : 0.9);
        setStatus(ids[0], married ? "married" : "dating", ids[1]);
        setStatus(ids[1], married ? "married" : "dating", ids[0]);
        link(ids[0], "partner", ids[1]);
        link(ids[1], "partner", ids[0]);
      }
      if (kind === "family" || kind === "multigen" || kind === "single-parent") {
        const parents = kind === "single-parent" ? [ids[0]] : [ids[0], ids[1]];
        const kids =
          kind === "single-parent" ? ids.slice(1) : kind === "multigen" ? [ids[2]] : ids.slice(2);
        for (const parent of parents)
          for (const kid of kids) {
            link(parent, "child", kid);
            link(kid, "parent", parent);
          }
        for (let i = 0; i < kids.length; i++)
          for (let j = i + 1; j < kids.length; j++) {
            link(kids[i], "sibling", kids[j]);
            link(kids[j], "sibling", kids[i]);
          }
        if (kind === "single-parent") {
          setStatus(ids[0], rng() < 0.6 ? "divorced" : "single");
        }
        if (kind === "multigen") {
          // Grandparent (slot 3) is parent of the slot-0 adult.
          link(ids[3], "child", ids[0]);
          link(ids[0], "parent", ids[3]);
          setStatus(ids[3], rng() < 0.7 ? "widowed" : "divorced");
        }
      }
      if (kind === "widowed-elder") setStatus(ids[0], "widowed");

      const surnames = [...new Set(ids.map((pid) => personas.get(pid)!.familyName))];
      const label =
        kind === "roommates"
          ? `${surnames.join(" & ")} (roommates)`
          : surnames.length === 1
            ? `The ${surnames[0]} ${ids.length > 1 ? "family" : "household"}`
            : `${surnames.join(" & ")} household`;

      const household: Household = { buildingId: b.id, index: h, unit, memberIds, label };
      households.push(household);
      homeList.push(household);
    }
    if (homeList.length > 0) byHomeBuilding.set(b.id, homeList);
  }

  // ---- Pass 2: businesses ----
  for (const b of buildings) {
    const kinds = BUSINESS_KINDS[b.archetype];
    if (!kinds) continue;
    const district = districtById.get(b.districtId);
    const character: DistrictCharacter = district?.character ?? "residential";
    const isShopHost = RESIDENTIAL_ARCHETYPES.has(b.archetype);
    // Residential archetypes only host ground-floor shops in street-life
    // districts; dedicated work archetypes host everywhere.
    if (isShopHost && !SHOP_DISTRICTS.has(character)) continue;
    const rng = seedrandom(`${masterSeed}::personas::biz::${b.id}`);
    if (isShopHost && rng() > 0.45) continue; // not every block has a storefront
    const count = BUSINESS_COUNT[b.archetype] ?? 1;
    const list: Business[] = [];
    const address = names.addresses.get(b.id);
    const streetBase = address ? address.street.split(" ").slice(0, -1).join(" ") : "Harbor";
    for (let n = 0; n < count; n++) {
      const kind = pick(rng, kinds);
      let templates = BUSINESS_TEMPLATES[kind];
      let affinity: ProfessionCategory[] | undefined;
      let titleAffinity: string[] | undefined;
      if (kind === "office") {
        const subtype = weightedPick(
          rng,
          OFFICE_SUBTYPES.map((s) => ({ value: s, weight: s.weight })),
        );
        templates = subtype.templates;
        affinity = subtype.affinity;
      } else if (kind === "hospital") {
        const subtype = weightedPick(
          rng,
          HOSPITAL_SUBTYPES.map((s) => ({ value: s, weight: s.weight })),
        );
        templates = subtype.templates;
        titleAffinity = subtype.titleAffinity;
      }
      const name = pick(rng, templates)
        .replace("{F2}", pick(rng, LAST_NAMES))
        .replace("{F}", pick(rng, LAST_NAMES))
        .replace("{G}", pick(rng, rng() < 0.5 ? MASCULINE_FIRST_NAMES : FEMININE_FIRST_NAMES))
        .replace("{S}", streetBase)
        .replace("{T}", pick(rng, TREE_NAMES))
        .replace("{C}", names.city.name)
        .replace("{P}", pick(rng, ["Design", "Media", "Print"]))
        .replace("{N}", String(1 + Math.floor(rng() * 19)));
      const biz: Business = {
        id: `biz:${b.id}:${n}`,
        name,
        kind,
        buildingId: b.id,
        employeeIds: [],
        affinity,
        titleAffinity,
      };
      businesses.set(biz.id, biz);
      list.push(biz);
    }
    if (list.length > 0) byWorkBuilding.set(b.id, list);
  }

  // ---- Pass 2.5: schools ----
  // Real schools in real buildings, before the employment weave so teachers
  // hire into them via the ordinary kind-matching ladder. Every district with
  // featured households gets its own elementary (kids walk to school in their
  // own neighbourhood by construction); middle schools serve ~3 districts,
  // highs ~5 (min one citywide). Kids are then assigned to the NEAREST school
  // of their age tier — no rng, pure distance — and get a walk/bus commute.
  {
    const rng = seedrandom(`${masterSeed}::personas::schools`);
    const CARDINAL_WORD: Record<string, string> = {
      n: "North", s: "South", e: "East", w: "West",
      ne: "Northeast", nw: "Northwest", se: "Southeast", sw: "Southwest",
    };
    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    // Districts that actually house featured residents, in stable index order.
    const homeDistricts: string[] = [];
    {
      const seen = new Set<string>();
      for (const buildingId of byHomeBuilding.keys()) {
        const b = buildingById.get(buildingId);
        if (b && !seen.has(b.districtId)) {
          seen.add(b.districtId);
          homeDistricts.push(b.districtId);
        }
      }
    }
    // School sites: roomy low/mid-rise, biggest footprints first; one school
    // per building.
    const usedSites = new Set<number>();
    const siteFor = (districtIds: string[]): Building | undefined => {
      for (const districtId of districtIds) {
        const candidates = buildings
          .filter(
            (b) =>
              b.districtId === districtId &&
              !usedSites.has(b.id) &&
              (b.archetype === "low-rise" || b.archetype === "mid-rise"),
          )
          .sort((a, b) => b.width * b.depth - a.width * a.depth)
          .slice(0, 5);
        if (candidates.length > 0) {
          const pickIdx = Math.floor(rng() * candidates.length);
          usedSites.add(candidates[pickIdx].id);
          return candidates[pickIdx];
        }
      }
      return undefined;
    };
    const addSchool = (
      site: Building,
      name: string,
      schoolTier: NonNullable<Business["schoolTier"]>,
    ): void => {
      const school: Business = {
        id: `biz:${site.id}:school`,
        name,
        kind: "school",
        buildingId: site.id,
        employeeIds: [],
        studentIds: [],
        schoolTier,
        // Teachers/aides/admin route here via kind matching; no title gate.
      };
      businesses.set(school.id, school);
      const list = byWorkBuilding.get(site.id) ?? [];
      list.push(school);
      byWorkBuilding.set(site.id, list);
    };
    const streetBaseOf = (b: Building): string => {
      const street = names.addresses.get(b.id)?.street ?? "Harbor Street";
      return street.split(" ").slice(0, -1).join(" ") || street;
    };

    // Elementaries: one per home district.
    for (const districtId of homeDistricts) {
      const site = siteFor([districtId]);
      if (site) addSchool(site, `${streetBaseOf(site)} Elementary`, "elementary");
    }
    // Middles: one per ~3 home districts; highs: one per ~5 (min 1).
    for (let i = 0; i < homeDistricts.length; i += 3) {
      const site = siteFor(homeDistricts.slice(i, i + 3));
      if (site) addSchool(site, `${pick(rng, LAST_NAMES)} Middle School`, "middle");
    }
    const highGroups = Math.max(1, Math.floor(homeDistricts.length / 5));
    for (let g = 0; g < highGroups; g++) {
      const group = homeDistricts.slice(g * 5, g * 5 + 5);
      const site = siteFor(group.length > 0 ? group : homeDistricts);
      if (!site) continue;
      const cardinal = CARDINAL_WORD[site.districtId.split("-")[0]] ?? "";
      addSchool(
        site,
        g === 0 ? `${names.city.name} High School` : `${cardinal} ${names.city.name} High`,
        "high",
      );
    }

    // Enrollment: nearest school of the age tier, pure distance.
    const byTier = new Map<string, Array<{ school: Business; site: Building }>>();
    for (const biz of businesses.values()) {
      if (!biz.schoolTier) continue;
      const site = buildingById.get(biz.buildingId);
      if (!site) continue;
      const list = byTier.get(biz.schoolTier) ?? [];
      list.push({ school: biz, site });
      byTier.set(biz.schoolTier, list);
    }
    for (const p of personas.values()) {
      if (p.age < 5 || p.age >= 18) continue;
      const tier = p.age < 11 ? "elementary" : p.age < 14 ? "middle" : "high";
      const options = byTier.get(tier);
      const home = buildingById.get(p.homeBuildingId);
      if (!options || options.length === 0 || !home) continue;
      let best: { school: Business; site: Building } | null = null;
      let bestDist = Infinity;
      for (const opt of options) {
        const d = Math.hypot(opt.site.x - home.x, opt.site.z - home.z);
        if (d < bestDist) {
          bestDist = d;
          best = opt;
        }
      }
      if (!best) continue;
      p.schoolId = best.school.id;
      p.commuteTargetBuildingId = best.site.id;
      best.school.studentIds!.push(p.id);
      const distance = Math.round(bestDist);
      p.commute = { mode: distance < 900 ? "walk" : "bus", distance };
    }
  }

  // ---- Pass 3: employment weave ----
  {
    const rng = seedrandom(`${masterSeed}::personas::employment`);
    const byKind = new Map<WorkplaceType, Business[]>();
    for (const biz of businesses.values()) {
      const list = byKind.get(biz.kind) ?? [];
      list.push(biz);
      byKind.set(biz.kind, list);
    }
    // Stable worker order: persona insertion order is already building-ascending.
    for (const p of personas.values()) {
      if (p.workStatus !== "employed" || !p.profession) continue;
      const candidates = byKind.get(p.profession.workplaceType);
      if (!candidates || candidates.length === 0) {
        p.workStatus = "commutes out of the city";
        continue;
      }
      // Preference ladder: exact title match ("{F} Dental" wants dentists) >
      // category match (bellhops to the hotel, paralegals to the law firm) >
      // unmarked businesses > anything with the right workplace kind.
      const category = p.profession.category;
      const title = p.profession.title;
      const byTitle = candidates.filter((c) => c.titleAffinity?.includes(title));
      const byCategory = candidates.filter((c) => c.affinity?.includes(category) && !c.titleAffinity);
      const open = candidates.filter((c) => !c.affinity && !c.titleAffinity);
      const pool =
        byTitle.length > 0 ? byTitle : byCategory.length > 0 ? byCategory : open.length > 0 ? open : candidates;
      const biz = pool[Math.floor(rng() * pool.length)];
      p.businessId = biz.id;
      biz.employeeIds.push(p.id);
    }
  }

  // ---- Pass 3.2: commute modes ----
  // Distance decides the plausible set; age and district character thumb the
  // scale inside it. Downtown/subcentre/mixed homes sit on the transit spine,
  // so their mid-range commuters ride; everyone else defaults to the car.
  {
    const rng = seedrandom(`${masterSeed}::personas::commute`);
    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    for (const p of personas.values()) {
      if (!p.businessId) continue;
      const biz = businesses.get(p.businessId);
      const home = buildingById.get(p.homeBuildingId);
      const work = biz ? buildingById.get(biz.buildingId) : undefined;
      if (!home || !work) continue;
      const distance = Math.round(Math.hypot(work.x - home.x, work.z - home.z));
      p.commuteTargetBuildingId = work.id;
      const character = districtById.get(p.homeDistrictId)?.character ?? "residential";
      const onTransitSpine =
        character === "downtown" || character === "subcentre" || character === "mixed-use";
      const canCycle = p.age <= 62;
      let mode: CommuteMode;
      const r = rng();
      if (distance < 700) {
        mode = r < 0.75 ? "walk" : canCycle && r < 0.92 ? "cycle" : "walk";
      } else if (distance < 2400) {
        if (canCycle && r < 0.3) mode = "cycle";
        else if (r < (onTransitSpine ? 0.72 : 0.45)) mode = "transit";
        else mode = "drive";
      } else {
        mode = r < (onTransitSpine ? 0.55 : 0.22) ? "transit" : "drive";
      }
      p.commute = { mode, distance };
    }
  }

  // ---- Pass 3.5: cross-building family weave ----
  // Adult children whose parents live across town (and vice versa). Matching
  // requires a shared surname + a parent-shaped age gap, so the links read as
  // discovered genealogy rather than assignment: "Diaz, 34, Little Harbor"
  // clicks through to "Diaz, 63, Chestnut Hollow".
  {
    const rng = seedrandom(`${masterSeed}::personas::family`);
    // Elders indexed by surname; only heads-of-household adults qualify (a
    // 60-year-old already living with their kids shouldn't gain extras).
    const eldersBySurname = new Map<string, Persona[]>();
    for (const p of personas.values()) {
      if (p.age < 48) continue;
      const list = eldersBySurname.get(p.familyName) ?? [];
      list.push(p);
      eldersBySurname.set(p.familyName, list);
    }
    const extraChildren = new Map<PersonaId, number>();
    for (const p of personas.values()) {
      if (p.age < 25 || p.age > 45) continue;
      // Skip anyone who already has an in-city parent (multigen households).
      if (p.family.some((l) => l.role === "parent")) continue;
      if (rng() > 0.22) continue;
      const candidates = (eldersBySurname.get(p.familyName) ?? []).filter(
        (e) =>
          e.homeBuildingId !== p.homeBuildingId &&
          e.age - p.age >= 22 &&
          e.age - p.age <= 38 &&
          (extraChildren.get(e.id) ?? 0) < 2,
      );
      if (candidates.length === 0) continue;
      const parent = candidates[Math.floor(rng() * candidates.length)];
      p.family.push({ role: "parent", personaId: parent.id });
      parent.family.push({ role: "child", personaId: p.id });
      extraChildren.set(parent.id, (extraChildren.get(parent.id) ?? 0) + 1);
      // The parent's spouse (same household) is a parent too.
      if (parent.partnerId) {
        const spouse = personas.get(parent.partnerId);
        if (spouse && spouse.homeBuildingId === parent.homeBuildingId) {
          p.family.push({ role: "parent", personaId: spouse.id });
          spouse.family.push({ role: "child", personaId: p.id });
        }
      }
    }
  }

  // ---- Pass 4: dating weave (cross-building) ----
  {
    const rng = seedrandom(`${masterSeed}::personas::dating`);
    // Eligible: single adults (not widowed elders), some fraction looking.
    const seekers: Persona[] = [];
    for (const p of personas.values()) {
      if (p.relationshipStatus !== "single" || p.age < 20 || p.age > 70) continue;
      if (rng() < 0.45) seekers.push(p);
    }
    // Seeded shuffle, then greedy compatible pairing.
    for (let i = seekers.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [seekers[i], seekers[j]] = [seekers[j], seekers[i]];
    }
    const seeksSame = new Map<PersonaId, boolean>();
    for (const p of seekers) seeksSame.set(p.id, rng() < 0.12);
    const woman = (p: Persona) => p.genderIdentity === "cis woman" || p.genderIdentity === "trans woman";
    const compatible = (a: Persona, b: Persona) => {
      if (a.homeBuildingId === b.homeBuildingId && a.householdIndex === b.householdIndex) return false;
      if (Math.abs(a.age - b.age) > 12) return false;
      const same = woman(a) === woman(b);
      return (seeksSame.get(a.id) ?? false) === same && (seeksSame.get(b.id) ?? false) === same;
    };
    const paired = new Set<PersonaId>();
    for (let i = 0; i < seekers.length; i++) {
      const a = seekers[i];
      if (paired.has(a.id)) continue;
      for (let j = i + 1; j < seekers.length; j++) {
        const b = seekers[j];
        if (paired.has(b.id) || !compatible(a, b)) continue;
        a.relationshipStatus = "dating";
        b.relationshipStatus = "dating";
        a.partnerId = b.id;
        b.partnerId = a.id;
        paired.add(a.id);
        paired.add(b.id);
        break;
      }
    }
  }

  const directory: PersonaDirectory = {
    personas,
    households,
    byHomeBuilding,
    businesses,
    byWorkBuilding,
    names,
    lore: [],
    totals: {
      personas: personas.size,
      households: households.length,
      businesses: businesses.size,
    },
  };

  // ---- Pass 5: story weave (schedules, epithets, hooks, one-sided relations) ----
  weaveStories(masterSeed, directory);

  return directory;
}

// Memoised with the shared cache-key recipe (see population.ts).
const dirCache = new Map<string, PersonaDirectory>();

export function buildPersonaDirectory(
  masterSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
): PersonaDirectory {
  const key = `${masterSeed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}::${densityProfileKey()}`;
  const hit = dirCache.get(key);
  if (hit) return hit;
  const result = buildDirectoryImpl(masterSeed, shape, shapeScale);
  if (dirCache.size > 8) dirCache.clear();
  dirCache.set(key, result);
  return result;
}
