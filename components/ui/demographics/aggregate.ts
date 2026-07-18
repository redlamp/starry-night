import type { PersonaDirectory, WorkStatus, CommuteMode } from "@/lib/seed/personas";
import type { Building } from "@/lib/seed/cityGen";
import { residentialCapacity } from "@/lib/seed/population";
import { approxMagnitude } from "@/lib/utils";

// Demographics aggregation (#97): one O(n) pass over the directory's personas
// (plus one over households) into census-style bins. Deterministic — no rng,
// no Date.now. Called lazily the first time the report panel opens, never from
// the directory's eager build.

export type Scope = "listed" | "full";

// Age bands 0-9 … 70-79, 80+. Index = min(8, floor(age / 10)).
const AGE_BANDS = ["0-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"];

// Work-status render order + friendly labels (the union's raw strings are
// already prose; a couple read better trimmed for an axis).
const WORK_STATUS_ORDER: Array<{ key: WorkStatus; label: string }> = [
  { key: "employed", label: "Employed" },
  { key: "works from home", label: "Works From Home" },
  { key: "commutes out of the city", label: "Commutes Out" },
  { key: "between jobs", label: "Between Jobs" },
  { key: "retired", label: "Retired" },
  { key: "student", label: "Student" },
  { key: "homemaker", label: "Homemaker" },
];

const COMMUTE_MODE_ORDER: Array<{ key: CommuteMode; label: string }> = [
  { key: "walk", label: "Walk" },
  { key: "cycle", label: "Cycle" },
  { key: "transit", label: "Transit" },
  { key: "drive", label: "Drive" },
  { key: "bus", label: "Bus" },
];

// Commute distance histogram buckets, in metres (upper bound exclusive).
const DISTANCE_BUCKETS: Array<{ label: string; max: number }> = [
  { label: "<1km", max: 1000 },
  { label: "1-3km", max: 3000 },
  { label: "3-5km", max: 5000 },
  { label: "5-10km", max: 10000 },
  { label: "10km+", max: Infinity },
];

// Employment for the header "Jobs" estimate — the working population, however
// they get there.
const WORKING_STATUSES: ReadonlySet<WorkStatus> = new Set<WorkStatus>([
  "employed",
  "works from home",
  "commutes out of the city",
]);

export type DemographicsData = {
  // Header stats. population/households/jobs are whole-population estimates
  // (approxMagnitude'd, shown with ~); listed is the exact featured count.
  header: { population: number; listed: number; households: number; jobs: number };
  scope: Scope;
  scale: number; // full-city multiplier (1 in "listed" scope)
  agePyramid: Array<{ band: string; men: number; women: number; nonbinary: number }>;
  workStatus: Array<{ label: string; count: number }>;
  commuteMode: Array<{ label: string; count: number }>;
  commuteDistance: Array<{ label: string; count: number }>;
  households: Array<{ label: string; count: number }>;
};

export type DistrictOption = { id: string; label: string };

// Whole-city population estimate per district (and total). Must be the same
// census-capacity sum as PersonaDirectory.city.population (#96) or the panel
// contradicts the directory masthead (user 2026-07-18) — both now use
// residentialCapacity(), the mixed-use-aware model.
export function cityPopulationByDistrict(buildings: Building[]): {
  total: number;
  byDistrict: Map<string, number>;
} {
  const byDistrict = new Map<string, number>();
  let total = 0;
  for (const b of buildings) {
    const pop = residentialCapacity(b);
    if (pop === 0) continue;
    total += pop;
    byDistrict.set(b.districtId, (byDistrict.get(b.districtId) ?? 0) + pop);
  }
  return { total, byDistrict };
}

export function aggregateDemographics(
  directory: PersonaDirectory,
  buildingById: Map<number, Building>,
  cityPop: { total: number; byDistrict: Map<string, number> },
  districtId: string | "all",
  scope: Scope,
): DemographicsData {
  const age = AGE_BANDS.map((band) => ({ band, men: 0, women: 0, nonbinary: 0 }));
  const work = new Map<WorkStatus, number>();
  const commute = new Map<CommuteMode, number>();
  const distance = DISTANCE_BUCKETS.map(() => 0);
  const hhSize = [0, 0, 0, 0, 0]; // sizes 1,2,3,4,5+

  let listed = 0;
  let working = 0;

  // One pass over personas.
  for (const p of directory.personas.values()) {
    if (districtId !== "all" && p.homeDistrictId !== districtId) continue;
    listed++;

    const bandIdx = Math.min(8, Math.max(0, Math.floor(p.age / 10)));
    const g = p.genderIdentity;
    if (g === "cis man" || g === "trans man") age[bandIdx].men++;
    else if (g === "cis woman" || g === "trans woman") age[bandIdx].women++;
    else age[bandIdx].nonbinary++;

    work.set(p.workStatus, (work.get(p.workStatus) ?? 0) + 1);
    if (WORKING_STATUSES.has(p.workStatus)) working++;

    if (p.commute) {
      commute.set(p.commute.mode, (commute.get(p.commute.mode) ?? 0) + 1);
      const bi = DISTANCE_BUCKETS.findIndex((b) => p.commute!.distance < b.max);
      if (bi >= 0) distance[bi]++;
    }
  }

  // One pass over households (bin by member count, filtered to the district).
  let listedHouseholds = 0;
  for (const hh of directory.households) {
    if (districtId !== "all") {
      const b = buildingById.get(hh.buildingId);
      if (!b || b.districtId !== districtId) continue;
    }
    listedHouseholds++;
    hhSize[Math.min(5, Math.max(1, hh.memberIds.length)) - 1]++;
  }

  // Whole-population estimate for the current filter, and the scale that lifts
  // the listed sample up to it.
  const truePop =
    districtId === "all" ? cityPop.total : (cityPop.byDistrict.get(districtId) ?? listed);
  const scale = scope === "full" && listed > 0 ? truePop / listed : 1;

  // In "full" scope every bin count is scaled and rounded to an approximate
  // magnitude; in "listed" scope counts are exact.
  const s = (n: number) => (scope === "full" ? approxMagnitude(n * scale) : Math.round(n));

  const avgHouseholdSize = listedHouseholds > 0 ? listed / listedHouseholds : 1;

  return {
    // Header values stay RAW; the panel formats them with the same
    // approxCount() the directory masthead uses, so the two surfaces can never
    // disagree on rounding (user 2026-07-18).
    header: {
      population: Math.round(truePop),
      listed,
      households: Math.round(truePop / avgHouseholdSize),
      // Whole-city jobs come from the canonical #96 figure (sum of full
      // headcounts) so this header can't contradict the directory masthead;
      // the employment-rate scale is only a fallback for district slices,
      // where no canonical figure exists.
      jobs: Math.round(
        districtId === "all"
          ? directory.city.jobs
          : listed > 0
            ? (working / listed) * truePop
            : 0,
      ),
    },
    scope,
    scale,
    agePyramid: age.map((a) => ({
      band: a.band,
      men: s(a.men),
      women: s(a.women),
      nonbinary: s(a.nonbinary),
    })),
    workStatus: WORK_STATUS_ORDER.map(({ key, label }) => ({ label, count: s(work.get(key) ?? 0) })),
    commuteMode: COMMUTE_MODE_ORDER.map(({ key, label }) => ({
      label,
      count: s(commute.get(key) ?? 0),
    })),
    commuteDistance: DISTANCE_BUCKETS.map((b, i) => ({ label: b.label, count: s(distance[i]) })),
    households: hhSize.map((c, i) => ({ label: i === 4 ? "5+" : String(i + 1), count: s(c) })),
  };
}
