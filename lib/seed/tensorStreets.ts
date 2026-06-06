import seedrandom from "seedrandom";
import { computeLattice } from "./lattice";
import { buildTensorField, alignDir, type TensorField, type Vec2 } from "./tensorField";
import type { RoadPoly, RoadTier } from "./streets";
import { genScale } from "./topology";
import type { ShapeMask } from "./cityShape";

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

class GridStorage {
  private cells = new Map<string, Vec2[]>();
  constructor(private size: number) {}
  add(p: Vec2) {
    const k = `${Math.floor(p.x / this.size)},${Math.floor(p.z / this.size)}`;
    const list = this.cells.get(k);
    if (list) list.push(p);
    else this.cells.set(k, [p]);
  }
  // true if no stored sample lies within `d` of p.
  isFree(p: Vec2, d: number): boolean {
    const ci = Math.floor(p.x / this.size);
    const cj = Math.floor(p.z / this.size);
    const r = Math.max(1, Math.ceil(d / this.size));
    const d2 = d * d;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const list = this.cells.get(`${i},${j}`);
        if (!list) continue;
        for (const q of list) {
          const dx = q.x - p.x;
          const dz = q.z - p.z;
          if (dx * dx + dz * dz < d2) return false;
        }
      }
    }
    return true;
  }
}

type Sep = { s: GridStorage; d: number };

function blocked(sep: Sep[], p: Vec2): boolean {
  if (prof) {
    const t0 = performance.now();
    let hit = false;
    for (const { s, d } of sep) {
      prof.isFreeCalls++;
      if (!s.isFree(p, d)) {
        hit = true;
        break; // same short-circuit as the clean path
      }
    }
    prof.blockedMs += performance.now() - t0;
    return hit;
  }
  for (const { s, d } of sep) if (!s.isFree(p, d)) return true;
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
      if (blocked(sep, next)) break;
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
): Vec2[][] {
  const lines: Vec2[][] = [];
  const accept = (seed: Vec2): boolean => {
    if (mask(seed.x, seed.z) < 0.5) return false; // seed outside the footprint
    if (prof) prof.isFreeCalls++;
    if (!own.isFree(seed, dsep)) return false;
    const t0 = prof ? performance.now() : 0;
    const line = trace(field, seed, major, sep, b, mask);
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

  // Per-family, per-tier separation storages (cell ≥ finest dsep).
  const SmajA = new GridStorage(80);
  const SminA = new GridStorage(80);
  const SmajS = new GridStorage(80);
  const SminS = new GridStorage(80);

  const artRng = seedrandom(`${masterSeed}::tensor::seeds::art`);
  const stRng = seedrandom(`${masterSeed}::tensor::seeds::st`);

  // Arterials — both families, wide separation → a coarse criss-cross grid.
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
