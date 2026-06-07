import seedrandom from "seedrandom";
import { CITY_CENTER, maxHalfExtent } from "./topology";
import type { DistrictCharacter, DistrictField } from "./district";

// Development-density field (#49: suburbs + density gradient).
// See wiki/notes/plan-metro-suburbs-highways.md.
//
// A metro fades from a bright dense core through curvilinear suburbs and rural
// land to undeveloped fringe. Density is a scalar in [0,1]; bands quantize it:
//
//   core ≥ 0.62 · suburban ≥ 0.30 · rural ≥ 0.12 · fringe < 0.12
//
// Two layers, two consumers:
//
//   1. RADIAL field — pure spatial: Clark's-law exponential falloff on ABSOLUTE
//      distance from the city centre (Clark 1951: density declines ~exp(-r/r0)
//      from the CBD; same rationale as district.ts's absolute character bands).
//      Absolute metres, NOT normalised by the tier extent — growing the tier
//      ADDS outer bands (rural, then fringe) instead of stretching the same
//      gradient over a bigger canvas. Seeded angular harmonics wobble the band
//      edges so the city is an organic blob, not a bullseye. No district
//      dependency, so ROAD generation (arterial gating, street spacing, suburb
//      winding) can consume it BEFORE districts exist — districts derive from
//      arterials, so a per-district field would be circular there.
//
//   2. PER-DISTRICT field — the radial base sampled at each district centroid,
//      jittered per district, with hard per-character floors (downtown is never
//      thinned by an unlucky centroid). Follows the irregular district layout,
//      which is what BUILDING / LAMP / WINDOW consumers want: a whole district
//      reads as one development era, and the core→fringe fade lands on real
//      district seams instead of cutting through blocks.
//
// Determinism: two dedicated sub-streams (`::density::radial`, drawn a fixed
// number of times; `::density::districts`, drawn once per district in stable
// index order). No existing stream gains or loses a draw — the road network and
// building layout are byte-identical until a consumer opts in.

export type DensityBand = "core" | "suburban" | "exurban" | "rural" | "fringe";

// --- Population profile (user 2026-06-08: "tools to help influence the
// population gradient and density… mark population centers and radiate out
// from there, gradient curves and overflows") ---------------------------------
// Runtime authoring knobs over the radial field. Same module-mirror pattern as
// setCityTier / setFieldDeviation: the store is the source of truth, gen reads
// this at call time, every gen cache keys on densityProfileKey().
//   centres   — 1 = the classic single CBD; 2–6 add SEEDED satellite centres
//               fanned evenly around the core in the mid/suburban ring (each
//               radiates its own gradient). UI labels use "centers".
//   spread    — × on the falloff radius R0 (how far the city reaches).
//   shoulder  — × on the exponent P (flat mid-city plateau vs sharp peak).
//   satellite — strength of the satellite centres (0..1 of the primary).
// Centres combine as a soft-OR (1 − Π(1 − dᵢ)) — overlapping gradients
// OVERFLOW into each other and merge into conurbations instead of clipping.
export type DensityProfile = {
  centres: number;
  spread: number;
  shoulder: number;
  satellite: number;
};
// Satellite slots always drawn (stream stability) → centres caps at 1 + slots.
export const SAT_SLOTS = 5;
export const MAX_CENTRES = 1 + SAT_SLOTS;
// Defaults per user 2026-06-08: a polycentric metro out of the box — 4 centres,
// wider reach, softer shoulder.
export const DEFAULT_DENSITY_PROFILE: DensityProfile = {
  centres: 4,
  spread: 1.2,
  shoulder: 0.8,
  satellite: 0.7,
};
let profile: DensityProfile = { ...DEFAULT_DENSITY_PROFILE };
export function setDensityProfile(p: DensityProfile): void {
  profile = p;
}
export function densityProfile(): DensityProfile {
  return profile;
}
export function densityProfileKey(): string {
  return `${profile.centres}:${profile.spread}:${profile.shoulder}:${profile.satellite}`;
}

// Band thresholds on the density scalar. EXURB (user 2026-06-08): a new tier
// between the residential belt and rural — the belt itself densifies (see
// SUBURB_ANCHORS) and this band inherits the belt's OLD look, so the fade
// gains a step: packed residential → today's looser residential → rural.
export const CORE_T = 0.62;
export const SUBURB_T = 0.3;
export const EXURB_T = 0.2;
export const RURAL_T = 0.12;

export function bandOf(density: number): DensityBand {
  if (density >= CORE_T) return "core";
  if (density >= SUBURB_T) return "suburban";
  if (density >= EXURB_T) return "exurban";
  if (density >= RURAL_T) return "rural";
  return "fringe";
}

// Generalized-exponential falloff: exp(−(r/R0)^P). P > 1 flattens the shoulder
// — a wide mid-city of full-density, mid-rise fabric wraps the CBD before the
// roll-off — and pushes the suburban band toward the map periphery (user
// 2026-06-08: "downtown should be surrounded by much more midsized non-spire
// blocks… the suburbs should really be at the periphery"; the pure exponential
// made the hand-off sudden at ~800 m). Unwarped band edges: core→suburban
// ~1.1 km, suburban→rural ~2.05 km, rural→fringe ~3.06 km — Town/City tiers
// read core + peripheral suburbs; rural opens at tier 5+, fringe at 7+ (the
// absolute-distance contract holds: bigger tiers ADD bands). R0 1929 → 1768:
// the first cut left the 4 km tier's suburb band mostly past the map edge —
// the subdivisions had no land to build on.
const R0 = 1768;
const P = 1.5;
// Faint base so the far fringe never hits exact zero (consumers add their own
// floors — e.g. lamps keep a "never zero" spacing floor).
const DENSITY_FLOOR = 0.02;

// Angular harmonics: rEff = r · (1 + Σ aᵢ·sin(kᵢθ + φᵢ)). Low orders so the
// blob stays coherent; total amplitude ≤ ~0.2 so a band edge breathes by ±20%
// of its radius across bearings.
const HARMONICS: ReadonlyArray<{ k: number; baseAmp: number }> = [
  { k: 2, baseAmp: 0.07 },
  { k: 3, baseAmp: 0.055 },
  { k: 5, baseAmp: 0.035 },
];

export type RadialDensity = {
  at: (x: number, z: number) => number;
  // Radius (m) where the warped profile crosses `threshold` along bearing
  // theta (radians from the city centre). Used by the /plan contour overlay.
  radiusAt: (threshold: number, theta: number) => number;
};

export function buildRadialDensity(
  masterSeed: string,
  // Preview override (Density panel draft): evaluate the field under a profile
  // WITHOUT touching the module mirror — gen caches never see draft values.
  profileOverride?: DensityProfile,
): RadialDensity {
  const { centres, spread, shoulder, satellite } = profileOverride ?? profile;
  const R0e = R0 * spread;
  const Pe = P * shoulder;
  const rng = seedrandom(`${masterSeed}::density::radial`);
  // Fixed draw order: amp then phase per harmonic.
  const harm = HARMONICS.map(({ k, baseAmp }) => ({
    k,
    amp: baseAmp * (0.5 + rng()),
    phase: rng() * Math.PI * 2,
  }));
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;

  // Satellite population centres — ALWAYS draw every slot (fixed 1 + 3·SAT_SLOTS
  // draws) after the harmonics, so the stream never shifts when `centres` is
  // tuned. Active satellites fan evenly around the core (stratified sectors +
  // in-sector jitter, seeded global phase) so 3+ centres never clump on one
  // side; placement in the mid/suburban ring, clamped inside the tier's land.
  const nSats = Math.min(SAT_SLOTS, Math.max(0, Math.round(centres) - 1));
  const phase = rng() * Math.PI * 2;
  const sats: Array<{ x: number; z: number; r0: number }> = [];
  for (let i = 0; i < SAT_SLOTS; i++) {
    const jitter = rng();
    const dist = Math.min(1500 + rng() * 1100, maxHalfExtent() * 0.8);
    const scale = 0.32 + rng() * 0.16;
    if (i < nSats) {
      const ang = phase + ((i + jitter) / nSats) * Math.PI * 2;
      sats.push({ x: cx + Math.cos(ang) * dist, z: cz + Math.sin(ang) * dist, r0: R0e * scale });
    }
  }

  const warpAt = (theta: number): number => {
    let w = 1;
    for (const h of harm) w += h.amp * Math.sin(h.k * theta + h.phase);
    return Math.max(0.5, w); // harmonics can't collapse a bearing entirely
  };

  const at = (x: number, z: number): number => {
    const dx = x - cx;
    const dz = z - cz;
    const r = Math.hypot(dx, dz);
    if (r < 1) return 1;
    const rEff = r * warpAt(Math.atan2(dz, dx));
    // Soft-OR over centres: overlapping gradients overflow into each other.
    let inv = 1 - Math.exp(-Math.pow(rEff / R0e, Pe));
    for (const s of sats) {
      const d = Math.hypot(x - s.x, z - s.z);
      inv *= 1 - satellite * Math.exp(-Math.pow(d / s.r0, Pe));
    }
    return DENSITY_FLOOR + (1 - DENSITY_FLOOR) * (1 - inv);
  };

  // Primary-centre inverse — the /plan contour rings. With satellites the true
  // iso-lines bulge toward them; this stays the primary's approximation.
  const radiusAt = (threshold: number, theta: number): number => {
    const t = Math.min(1 - 1e-6, Math.max(DENSITY_FLOOR + 1e-6, threshold));
    const base = R0e * Math.pow(-Math.log((t - DENSITY_FLOOR) / (1 - DENSITY_FLOOR)), 1 / Pe);
    return base / warpAt(theta);
  };

  return { at, radiusAt };
}

// Hard per-character density FLOOR. The character pass (district.ts) already
// encodes the radial plan — downtown is the CBD, subcentres the secondary
// clusters — so density may never undercut what the character demands: the
// planned core stays the bright core regardless of centroid luck or jitter.
// Subcentre ≥ CORE_T pins it to the core band ("subcentre stays lit like core",
// Stage-0 review). Residential/industrial floors are near-zero so the outer
// bands are free to fade through rural to fringe.
const CHARACTER_FLOOR: Record<DistrictCharacter, number> = {
  downtown: 0.82, // always core
  subcentre: 0.66, // always core (≥ CORE_T)
  heritage: 0.5, // dense old fabric → upper suburban at worst
  "mixed-use": 0.38, // transition belt → suburban
  residential: 0.08, // free to fade out
  industrial: 0, // edge yards may read as fringe
};

// ± per-district wobble so equal-radius neighbours can land in different bands
// and the transition follows district seams, not a clean circle.
const JITTER = 0.12;

// 0 at the core threshold → 1 at the rural threshold: "how far into the
// low-density regime" a point is. The shared easing for consumers (archetype
// mix, building size, lamp spacing) so they all thin in lockstep.
// Piecewise (user 2026-06-08, was linear CORE_T→RURAL_T): the residential belt
// densifies — at SUBURB_T the easing now reads 0.45 where the old line gave
// 0.64 (bigger archetypes, less shrink, tighter lamps) — and the exurban band
// spans 0.45→0.84, so its middle (~0.65) lands on the belt's OLD value: the
// new tier looks like residential used to.
const SUBURB_EASE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [CORE_T, 0],
  [SUBURB_T, 0.45],
  [EXURB_T, 0.84],
  [RURAL_T, 1],
];
export function suburbAmount(density: number): number {
  if (density >= CORE_T) return 0;
  if (density <= RURAL_T) return 1;
  for (let i = 1; i < SUBURB_EASE_ANCHORS.length; i++) {
    const [d1, s1] = SUBURB_EASE_ANCHORS[i];
    if (density >= d1) {
      const [d0, s0] = SUBURB_EASE_ANCHORS[i - 1];
      return s0 + ((d0 - density) / (d0 - d1)) * (s1 - s0);
    }
  }
  return 1;
}

// Density → probability that a development CELL is built at all. Piecewise on
// band anchors (explicit + tunable): the core is never thinned; suburbs read as
// FILLED with occasional whole-block gaps (parks, vacant parcels); rural keeps
// scattered clusters; the fringe a stray structure. The Stage-0 review's
// "whole-block dropout, keep developed blocks filled" — the in-cell fabric
// stays dense, the cell either exists or doesn't.
// 2026-06-08: the belt densifies (SUBURB_T 0.45 → 0.62, upper belt 0.85 →
// 0.9); the new exurban band inherits the belt's OLD 0.45 keep.
const KEEP_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.02],
  [RURAL_T, 0.08],
  [EXURB_T, 0.45],
  [SUBURB_T, 0.62],
  [0.45, 0.9],
  [CORE_T, 1],
];
export function keepProbForDensity(density: number): number {
  if (density >= CORE_T) return 1;
  if (density <= 0) return KEEP_ANCHORS[0][1];
  for (let i = 1; i < KEEP_ANCHORS.length; i++) {
    const [d1, p1] = KEEP_ANCHORS[i];
    if (density <= d1) {
      const [d0, p0] = KEEP_ANCHORS[i - 1];
      return p0 + ((density - d0) / (d1 - d0)) * (p1 - p0);
    }
  }
  return 1;
}

// Block-coherent development dropout (#49). Buildings are kept or dropped by
// ~150 m development CELL, not per lot — the Stage-0 spike's per-lot skip read
// as sparse lone "warehouse" boxes (random missing teeth); real low-density
// areas develop or skip whole parcels. Each cell's roll is hash-seeded from its
// coordinates (order-independent → stable under crop, walk order, and code
// reshuffles within a seed), drawn lazily and memoised. The keep PROBABILITY is
// the caller's local district density, so one cell straddling a density seam is
// kept on the denser side and dropped on the sparser — dropout edges follow
// district seams, not the cell grid.
export const DEV_CELL = 150;

export type DevelopmentMask = {
  keepAt: (x: number, z: number, density: number) => boolean;
};

export function buildDevelopmentMask(masterSeed: string): DevelopmentMask {
  // Seeded grid origin so cell boundaries never sit at the same world lines
  // across seeds.
  const offRng = seedrandom(`${masterSeed}::devcell::origin`);
  const ox = offRng() * DEV_CELL;
  const oz = offRng() * DEV_CELL;
  const rolls = new Map<string, number>();
  const keepAt = (x: number, z: number, density: number): boolean => {
    const p = keepProbForDensity(density);
    if (p >= 1) return true;
    const key = `${Math.floor((x + ox) / DEV_CELL)},${Math.floor((z + oz) / DEV_CELL)}`;
    let r = rolls.get(key);
    if (r === undefined) {
      r = seedrandom(`${masterSeed}::devcell::${key}`)();
      rolls.set(key, r);
    }
    return r < p;
  };
  return { keepAt };
}

export type DensityField = {
  // Per district index (matches DistrictField.classify / District.index).
  byIndex: number[];
  bandByIndex: DensityBand[];
  radial: RadialDensity;
  // World point → owning district's density; falls back to the raw radial field
  // off-district (classify === -1, i.e. outside the gen bounds).
  densityAt: (x: number, z: number) => number;
  bandAt: (x: number, z: number) => DensityBand;
};

export function buildDensityField(masterSeed: string, field: DistrictField): DensityField {
  const radial = buildRadialDensity(masterSeed);
  const rng = seedrandom(`${masterSeed}::density::districts`);

  const byIndex: number[] = [];
  const bandByIndex: DensityBand[] = [];
  for (const d of field.districts) {
    // Draw for EVERY district in index order so the stream stays aligned.
    const jitter = (rng() - 0.5) * 2 * JITTER;
    const base = radial.at(d.centroidX, d.centroidZ) + jitter;
    // Jitter applies to the radial base only — floors are hard minimums.
    const density = Math.min(1, Math.max(base, CHARACTER_FLOOR[d.character], 0));
    byIndex[d.index] = density;
    bandByIndex[d.index] = bandOf(density);
  }

  const densityAt = (x: number, z: number): number => {
    const idx = field.classify(x, z);
    if (idx < 0) return radial.at(x, z);
    return byIndex[idx] ?? radial.at(x, z);
  };
  const bandAt = (x: number, z: number): DensityBand => bandOf(densityAt(x, z));

  return { byIndex, bandByIndex, radial, densityAt, bandAt };
}
