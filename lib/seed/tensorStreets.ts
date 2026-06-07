import seedrandom from "seedrandom";
import { computeLattice } from "./lattice";
import { buildTensorField, alignDir, type TensorField, type Vec2 } from "./tensorField";
import type { RoadPoly, RoadTier } from "./streets";
import { genScale } from "./topology";
import type { ShapeMask } from "./cityShape";
import { buildRadialDensity, CORE_T, SUBURB_T, RURAL_T } from "./density";

// Tensor-field streets. Roads are streamlines of the tensor field. Both the
// MAJOR and MINOR eigenvector families are traced at TWO separation scales:
//   - a sparse pass → ARTERIALS (wide, ~210m apart)
//   - a dense pass  → minor STREETS (~84m apart), seeded off the arterials
// Because both tiers are traced in both families, arterials form their own
// criss-crossing grid and streets form theirs — not one family perpendicular to
// the other. Same-family roads separate by distance (parallel spacing); cross-
// family roads are never distance-blocked, so they criss-cross freely.
//
// Determinism: tracing is pure; seeding is strictly two-phase (drain a sorted
// arterial-endpoint queue with no PRNG, then a seeded PRNG fallback).

const DSTEP = 4;
// Streamline point cap — keyed to the gen extent (tier) so far roads reach the
// full extent. A function (not a module const) so the tier can change at runtime.
const maxPts = () => Math.round(420 * genScale());
const MIN_PTS = 6;
const SEED_TRIES = 200;

const ART_DSEP = 210;
const ART_DTEST = 185;
const ST_DSEP = 64; // denser local streets → smaller blocks, more street frontage
const ST_DTEST = 54;

// --- #49 density-graded road network -----------------------------------------
// The night-view gradient is decided HERE, not just by lamps/buildings: an
// arterial grid traced uniformly to the rim keeps the whole map lit at 28 m
// spacing (measured: main-road lamps/km² were FLAT core→suburb). Both knobs
// read the RADIAL density field — districts derive from the arterials below,
// so the per-district field would be circular.
//
// 1. Arterial seed gate — arterials are the URBAN backbone (the plan's rural
//    rule): new arterials stop being BORN as density falls; streamlines seeded
//    in the core still run outward to the rim, and those through-lines ARE the
//    radial connector spokes the suburbs keep (~1 per district, toward centre).
// 2. Street separation ramp — local streets stay tight through the suburbs
//    (subdivision must read — the Stage-0 spike over-coarsened here) and open
//    up to sparse country lanes through rural/fringe.
const ART_KEEP_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.02],
  [RURAL_T, 0.05],
  [SUBURB_T, 0.3],
  [0.45, 1],
  [CORE_T, 1],
];
// Arterial separation ramp — the seed gate alone is not enough: core-seeded
// through-lines run to the rim at the full 210 m grid density (measured: rural
// main-road lamps barely moved under the gate). Widening the separation TEST
// with falling density makes converging through-lines TERMINATE at the band
// edge (trace stops where the widened test meets a neighbour) while the
// earliest-traced line survives to the rim — arterials taper to a few radial
// spokes, exactly the plan's rural rule.
const ART_SEP_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 3.0],
  [RURAL_T, 2.4],
  [SUBURB_T, 1.5],
  [0.45, 1.15],
  [CORE_T, 1],
];
const ST_SEP_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 3.2],
  [RURAL_T, 2.6],
  [SUBURB_T, 1.25],
  [CORE_T, 1],
];
function anchorLerp(anchors: ReadonlyArray<readonly [number, number]>, d: number): number {
  if (d <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [d1, v1] = anchors[i];
    if (d <= d1) {
      const [d0, v0] = anchors[i - 1];
      return v0 + ((d - d0) / (d1 - d0)) * (v1 - v0);
    }
  }
  return anchors[anchors.length - 1][1];
}

type BBox = { minX: number; maxX: number; minZ: number; maxZ: number };

// #63 profiling — opt-in counters for the trace hot loop. Off = one null check
// per call site. Emit-only (no rng, no state): a profiled run is byte-identical
// to a clean one; only wall-clock differs from the timer overhead.
export type StreetsProfile = {
  fieldSamples: number;
  fieldMs: number; // includes ~1 timer-pair per sample — calibrate in the caller
  isFreeCalls: number;
  blockedMs: number;
  tracesAccepted: number;
  tracesRejected: number;
  acceptedTraceMs: number; // includes fieldMs/blockedMs spent inside those traces
  rejectedTraceMs: number;
  acceptedPts: number;
  tiers: { majA: number; minA: number; majS: number; minS: number };
};
let prof: StreetsProfile | null = null;
export function startStreetsProfile(): void {
  prof = {
    fieldSamples: 0,
    fieldMs: 0,
    isFreeCalls: 0,
    blockedMs: 0,
    tracesAccepted: 0,
    tracesRejected: 0,
    acceptedTraceMs: 0,
    rejectedTraceMs: 0,
    acceptedPts: 0,
    tiers: { majA: 0, minA: 0, majS: 0, minS: 0 },
  };
}
export function endStreetsProfile(): StreetsProfile | null {
  const p = prof;
  prof = null;
  return p;
}

// #63: cells key on a packed integer, points stored as interleaved [x,z,...]
// number arrays. isFree is a pure predicate over the stored point set, so the
// storage layout is free to change — the old string keys + Vec2[] cost ~7M
// string allocs/hashes per metro gen (was ~30% of roads time). Key packing is
// exact for |cell index| < 2048, i.e. coordinates within ±131 km at the 64 m+
// cell sizes used here — far beyond any tier extent.
class GridStorage {
  private cells = new Map<number, number[]>();
  constructor(private size: number) {}
  add(p: Vec2) {
    const k =
      (Math.floor(p.x / this.size) + 2048) * 4096 + (Math.floor(p.z / this.size) + 2048);
    const list = this.cells.get(k);
    if (list) list.push(p.x, p.z);
    else this.cells.set(k, [p.x, p.z]);
  }
  // true if no stored sample lies within `d` of p.
  isFree(p: Vec2, d: number): boolean {
    const ci = Math.floor(p.x / this.size);
    const cj = Math.floor(p.z / this.size);
    const r = Math.max(1, Math.ceil(d / this.size));
    const d2 = d * d;
    for (let i = ci - r; i <= ci + r; i++) {
      const rowBase = (i + 2048) * 4096 + 2048;
      for (let j = cj - r; j <= cj + r; j++) {
        const list = this.cells.get(rowBase + j);
        if (!list) continue;
        for (let n = 0; n < list.length; n += 2) {
          const dx = list[n] - p.x;
          const dz = list[n + 1] - p.z;
          if (dx * dx + dz * dz < d2) return false;
        }
      }
    }
    return true;
  }
}

type Sep = { s: GridStorage; d: number };

// `mul` (≥1) scales every separation test at p — the #49 street-sep ramp
// (wider spacing → fewer, bigger blocks in the low-density periphery). 1 = core.
function blocked(sep: Sep[], p: Vec2, mul = 1): boolean {
  if (prof) {
    const t0 = performance.now();
    let hit = false;
    for (const { s, d } of sep) {
      prof.isFreeCalls++;
      if (!s.isFree(p, d * mul)) {
        hit = true;
        break; // same short-circuit as the clean path
      }
    }
    prof.blockedMs += performance.now() - t0;
    return hit;
  }
  for (const { s, d } of sep) if (!s.isFree(p, d * mul)) return true;
  return false;
}

function inBounds(p: Vec2, b: BBox) {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
}

function rk4(field: TensorField, p: Vec2, prevDir: Vec2, major: boolean): Vec2 | null {
  const k1 = alignDir(field.sample(p.x, p.z, major), prevDir);
  if (!k1) return null;
  const p2 = { x: p.x + (k1.x * DSTEP) / 2, z: p.z + (k1.z * DSTEP) / 2 };
  const k2 = alignDir(field.sample(p2.x, p2.z, major), k1) ?? k1;
  const p3 = { x: p.x + (k2.x * DSTEP) / 2, z: p.z + (k2.z * DSTEP) / 2 };
  const k3 = alignDir(field.sample(p3.x, p3.z, major), k2) ?? k2;
  const p4 = { x: p.x + k3.x * DSTEP, z: p.z + k3.z * DSTEP };
  const k4 = alignDir(field.sample(p4.x, p4.z, major), k3) ?? k3;
  const dx = (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6;
  const dz = (k1.z + 2 * k2.z + 2 * k3.z + k4.z) / 6;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  return { x: dx / len, z: dz / len };
}

// Trace one streamline through `seed`, stopping at the bbox or where `sep`
// blocks it (a same-family road too close).
function trace(
  field: TensorField,
  seed: Vec2,
  major: boolean,
  sep: Sep[],
  b: BBox,
  mask: ShapeMask,
  sepMul: (x: number, z: number) => number,
): Vec2[] {
  const grow = (sign: number): Vec2[] => {
    const pts: Vec2[] = [];
    let prev = alignDir(field.sample(seed.x, seed.z, major), null);
    if (!prev) return pts;
    if (sign < 0) prev = { x: -prev.x, z: -prev.z };
    let p = { ...seed };
    const cap = maxPts();
    for (let n = 0; n < cap; n++) {
      const dir = rk4(field, p, prev, major);
      if (!dir) break;
      const next = { x: p.x + dir.x * DSTEP, z: p.z + dir.z * DSTEP };
      if (!inBounds(next, b)) break;
      if (mask(next.x, next.z) < 0.5) break; // left the organic city footprint
      if (blocked(sep, next, sepMul(next.x, next.z))) break;
      pts.push(next);
      prev = dir;
      p = next;
    }
    return pts;
  };
  return [...grow(-1).reverse(), { ...seed }, ...grow(1)];
}

function traceTier(
  field: TensorField,
  major: boolean,
  dsep: number,
  rng: () => number,
  b: BBox,
  seedQueue: Vec2[],
  own: GridStorage,
  sep: Sep[],
  mask: ShapeMask,
  onLine?: (pts: Vec2[]) => void,
  // #49: position-dependent separation multiplier (street-sep ramp) and seed
  // keep-probability (arterial density gate). Defaults = pre-#49 behaviour.
  sepMul: (x: number, z: number) => number = () => 1,
  seedKeep?: (x: number, z: number) => number,
): Vec2[][] {
  const lines: Vec2[][] = [];
  const accept = (seed: Vec2): boolean => {
    if (mask(seed.x, seed.z) < 0.5) return false; // seed outside the footprint
    if (prof) prof.isFreeCalls++;
    if (!own.isFree(seed, dsep * sepMul(seed.x, seed.z))) return false;
    const t0 = prof ? performance.now() : 0;
    const line = trace(field, seed, major, sep, b, mask, sepMul);
    if (prof) {
      const dt = performance.now() - t0;
      if (line.length < MIN_PTS) {
        prof.tracesRejected++;
        prof.rejectedTraceMs += dt;
      } else {
        prof.tracesAccepted++;
        prof.acceptedTraceMs += dt;
        prof.acceptedPts += line.length;
      }
    }
    if (line.length < MIN_PTS) return false;
    for (const p of line) own.add(p);
    lines.push(line);
    onLine?.(line); // EMIT-ONLY (#59 streaming) — consumes no rng, alters no state
    return true;
  };
  for (const s of seedQueue) accept(s);
  let fails = 0;
  while (fails < SEED_TRIES) {
    const seed = { x: b.minX + rng() * (b.maxX - b.minX), z: b.minZ + rng() * (b.maxZ - b.minZ) };
    // #49 density gate: a candidate seed survives with probability seedKeep —
    // arterials stop being born as density falls. One rng draw per candidate
    // whatever the outcome, so the stream stays aligned.
    if (seedKeep && rng() >= seedKeep(seed.x, seed.z)) {
      fails++;
      continue;
    }
    if (accept(seed)) fails = 0;
    else fails++;
  }
  return lines;
}

function endpointsSorted(...sets: Vec2[][][]): Vec2[] {
  const pts: Vec2[] = [];
  for (const lines of sets) {
    for (const l of lines) {
      if (l.length) {
        pts.push(l[0], l[l.length - 1]);
      }
    }
  }
  pts.sort((p, q) => {
    const px = Math.round(p.x * 100);
    const qx = Math.round(q.x * 100);
    if (px !== qx) return px - qx;
    return Math.round(p.z * 100) - Math.round(q.z * 100);
  });
  return pts;
}

function toPolys(lines: Vec2[][], width: number, tier: RoadTier, prefix: string): RoadPoly[] {
  return lines.map((pts, i) => ({
    id: `${prefix}-${i}`,
    vertices: pts.map((p) => ({ x: p.x, z: p.z })),
    width,
    closed: false as const,
    tier,
  }));
}

// Optional streaming hook (#59): fired once per ACCEPTED streamline, in trace
// order, with the raw polyline + its tier. Emit-only — the hook consumes no rng
// and mutates nothing, so a hooked run is byte-identical to an unhooked one.
export type StreetTraceHook = (pts: Vec2[], tier: "arterial" | "minor") => void;

export function generateTensorStreets(
  masterSeed: string,
  bounds: BBox,
  mask: ShapeMask = () => 1,
  onLine?: StreetTraceHook,
  // #40 prototype: trace through an externally-built field (e.g. one recovered
  // from a hand sketch) instead of the seeded basis field. Undefined = exactly
  // the original path, byte-identical.
  fieldOverride?: TensorField,
): { arterials: RoadPoly[]; minorStreets: RoadPoly[] } {
  const tfBase = fieldOverride ?? buildTensorField(masterSeed, computeLattice(masterSeed));
  // #63 profiling: wrap sample() to count/time field evaluation. Returns the
  // inner result untouched, so traced geometry is byte-identical.
  const p63 = prof;
  const tf: TensorField = p63
    ? {
        ...tfBase,
        sample: (x, z, major) => {
          p63.fieldSamples++;
          const t0 = performance.now();
          const r = tfBase.sample(x, z, major);
          p63.fieldMs += performance.now() - t0;
          return r;
        },
      }
    : tfBase;
  const timed = (slot: keyof StreetsProfile["tiers"], run: () => Vec2[][]): Vec2[][] => {
    if (!p63) return run();
    const t0 = performance.now();
    const lines = run();
    p63.tiers[slot] += performance.now() - t0;
    return lines;
  };
  const b: BBox = bounds;

  // #49 density-graded network. The radial field (no district dependency)
  // drives the arterial seed gate + the street-sep ramp. A sketched city (#40)
  // bypasses both — its ink is the author's intent, ungated.
  const radial = buildRadialDensity(masterSeed);
  const artKeep = fieldOverride
    ? undefined
    : (x: number, z: number) => anchorLerp(ART_KEEP_ANCHORS, radial.at(x, z));
  const artSepMul = fieldOverride
    ? undefined
    : (x: number, z: number) => anchorLerp(ART_SEP_ANCHORS, radial.at(x, z));
  const stSepMul = fieldOverride
    ? undefined
    : (x: number, z: number) => anchorLerp(ST_SEP_ANCHORS, radial.at(x, z));

  // Per-family, per-tier separation storages (cell ≥ finest dsep).
  const SmajA = new GridStorage(80);
  const SminA = new GridStorage(80);
  const SmajS = new GridStorage(80);
  const SminS = new GridStorage(80);

  const artRng = seedrandom(`${masterSeed}::tensor::seeds::art`);
  const stRng = seedrandom(`${masterSeed}::tensor::seeds::st`);

  // Arterials — both families, wide separation → a coarse criss-cross grid in
  // the core; the #49 seed gate stops new ones being born as density falls,
  // while core-seeded through-lines still run to the rim (the radial spokes).
  const majA = timed("majA", () =>
    traceTier(
      tf,
      true,
      ART_DSEP,
      artRng,
      b,
      [],
      SmajA,
      [{ s: SmajA, d: ART_DTEST }],
      mask,
      onLine ? (l) => onLine(l, "arterial") : undefined,
      artSepMul,
      artKeep,
    ),
  );
  const minA = timed("minA", () =>
    traceTier(
      tf,
      false,
      ART_DSEP,
      artRng,
      b,
      [],
      SminA,
      [{ s: SminA, d: ART_DTEST }],
      mask,
      onLine ? (l) => onLine(l, "arterial") : undefined,
      artSepMul,
      artKeep,
    ),
  );

  // Streets — both families, fine separation, seeded off arterial endpoints so
  // they branch from the arterials. Each street separates from same-family
  // streets AND same-family arterials (parallel spacing), but crosses the
  // perpendicular family freely → a fine criss-cross street grid between arterials.
  const artEnds = endpointsSorted(majA, minA);
  const majS = timed("majS", () =>
    traceTier(
      tf,
      true,
      ST_DSEP,
      stRng,
      b,
      artEnds,
      SmajS,
      [
        { s: SmajS, d: ST_DTEST },
        { s: SmajA, d: ST_DTEST },
      ],
      mask,
      onLine ? (l) => onLine(l, "minor") : undefined,
      stSepMul,
    ),
  );
  const minS = timed("minS", () =>
    traceTier(
      tf,
      false,
      ST_DSEP,
      stRng,
      b,
      artEnds,
      SminS,
      [
        { s: SminS, d: ST_DTEST },
        { s: SminA, d: ST_DTEST },
      ],
      mask,
      onLine ? (l) => onLine(l, "minor") : undefined,
      stSepMul,
    ),
  );

  const arterials = [
    ...toPolys(majA, 16, "arterial", "art-maj"),
    ...toPolys(minA, 16, "arterial", "art-min"),
  ];
  const minorStreets = [
    ...toPolys(majS, 9, "minor", "st-maj"),
    ...toPolys(minS, 9, "minor", "st-min"),
  ];

  return { arterials, minorStreets };
}
