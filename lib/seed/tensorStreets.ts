import seedrandom from "seedrandom";
import { computeLattice } from "./lattice";
import { buildTensorField, alignDir, type TensorField, type Vec2 } from "./tensorField";
import type { RoadPoly, RoadTier } from "./streets";
import { genScale } from "./topology";
import type { ShapeMask } from "./cityShape";
import { buildRadialDensity, suburbAmount, CORE_T, SUBURB_T, RURAL_T } from "./density";
import { sampleSuburbNodes, type SuburbNode } from "./suburbField";

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
  [0, 3.4],
  [RURAL_T, 2.9],
  [SUBURB_T, 2.6],
  [0.5, 1.5],
  [CORE_T, 1],
];
// Past the band edge the GLOBAL street grid is simply NOT TRACED (#49 node
// rebuild, Stage 2 — see wiki/notes/plan-suburb-node-fields.md): through-
// streamlines are the lattice topology no warp or branch-grower could hide.
// Suburban fabric is traced per-POD against the node field below instead. The
// global grid keeps a gentle opening ramp through the transition ring it still
// owns (core → grid edge), so the seam isn't a density cliff.
const ST_SEP_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 2.2],
  [SUBURB_T, 1.8],
  [0.45, 1.3],
  [CORE_T, 1],
];
// suburbAmount past which global street streamlines stop (and street seeds are
// rejected). 0.28 ≈ density 0.48 — the grid owns the core + the streetcar-
// suburb transition ring (~1.2 km on the standard profile) and then hands the
// fabric to the pods. (First cut sat at 0.6 ≈ density 0.32 — at small tiers
// that radius IS the rim, so the grid never actually yielded.)
const ST_BAND_STOP = 0.28;
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

// Sum of n seeded plane waves, normalised to ±1 — cheap smooth quasi-noise.
function planeNoise(
  rng: () => number,
  n: number,
  lambdaMin: number,
  lambdaMax: number,
): (x: number, z: number) => number {
  const waves = Array.from({ length: n }, () => {
    const dir = rng() * Math.PI * 2;
    const k = (Math.PI * 2) / (lambdaMin + rng() * (lambdaMax - lambdaMin));
    const phase = rng() * Math.PI * 2;
    return { ux: Math.cos(dir), uz: Math.sin(dir), k, phase };
  });
  return (x, z) => {
    let v = 0;
    for (const w of waves) v += Math.sin((x * w.ux + z * w.uz) * w.k + w.phase);
    return v / n;
  };
}

// --- #49 suburban subdivisions (Stage 2, redo) ---------------------------------
// The first Stage-2 cut traced concentric rings off per-node radial tensor
// bases — and read as exactly that: circles, some connected to nothing (user
// review). Real suburbs are not bullseyes. Per Southworth & Ben-Joseph's
// pattern taxonomy (wiki/research/suburban-street-patterns.md), post-war
// fabric is "loops and lollipops" / "lollipops on a stick":
//
//   arterial → COLLECTOR SPINE (1–2 mouths, gently S-curved through the pod)
//            → LOOP streets (leave the spine, bulge 60–120 m, return 150–300 m
//              later — the kidney beans)
//            → CUL-DE-SACS (curved stubs off spine + loops, ≤ ~140 m)
//
// Everything is a low-curvature spline ANCHORED to the network it grew from —
// collector to the nearest existing road, loops twice to the collector, culs
// once. Connectivity is by construction: a pod whose spine can't reach any
// road is not built at all (no orphan developments). Accepted geometry joins
// the anchor index, so later pods can hang their collectors off earlier ones —
// the tangential pod-to-pod links of the node plan.
//
// Determinism: one stream (`::suburb::subdiv`), nodes walked in array order;
// draw count varies per pod but the order is fixed, so the output is a pure
// function of (seed, extent).

const SUB_STEP = 8; // spline sample spacing (m)
const SUB_SEP_OWN = 38; // subdivision street to subdivision street (m)
const SUB_SEP_ST = 38; // to the global street grid at the seam
const SUB_SEP_ART = 46; // to arterials — pods are sealed by the section lines
// Arc near a curve's anchored end(s) exempt from sep tests. MUST exceed the
// largest sep distance: a curve departs its host roughly perpendicular, so at
// arc < sep it is still inside the host's own separation band — with the
// exemption smaller than the sep, every curve dies at its first tested point
// (the bug that produced zero subdivisions on the first run).
const SUB_EXEMPT = 62;

// Uniform Catmull-Rom through `ctrl`, sampled every ~`step` m. Endpoints are
// duplicated so the curve passes through all control points. Gentle-curvature
// control layouts only — no self-intersection at subdivision scales.
function catmullRom(ctrl: Vec2[], step: number): Vec2[] {
  if (ctrl.length < 2) return [...ctrl];
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out: Vec2[] = [];
  for (let i = 0; i < P.length - 3; i++) {
    const p0 = P[i];
    const p1 = P[i + 1];
    const p2 = P[i + 2];
    const p3 = P[i + 3];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(1, Math.round(segLen / step));
    for (let s = i === 0 ? 0 : 1; s <= n; s++) {
      const t = s / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        z:
          0.5 *
          (2 * p1.z +
            (-p0.z + p2.z) * t +
            (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
            (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      });
    }
  }
  return out;
}

// Nearest-point index over existing road geometry — collectors anchor onto it.
class AnchorIndex {
  private cells = new Map<number, number[]>();
  constructor(private size: number) {}
  add(p: Vec2) {
    const k = (Math.floor(p.x / this.size) + 2048) * 4096 + (Math.floor(p.z / this.size) + 2048);
    const list = this.cells.get(k);
    if (list) list.push(p.x, p.z);
    else this.cells.set(k, [p.x, p.z]);
  }
  addLine(pts: Vec2[], stride = 3) {
    for (let i = 0; i < pts.length; i += stride) this.add(pts[i]);
  }
  nearest(x: number, z: number, maxD: number): Vec2 | null {
    const ci = Math.floor(x / this.size);
    const cj = Math.floor(z / this.size);
    const r = Math.max(1, Math.ceil(maxD / this.size));
    let bd = maxD * maxD;
    let best: Vec2 | null = null;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const list = this.cells.get((i + 2048) * 4096 + (j + 2048));
        if (!list) continue;
        for (let n = 0; n < list.length; n += 2) {
          const dx = list[n] - x;
          const dz = list[n + 1] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) {
            bd = d2;
            best = { x: list[n], z: list[n + 1] };
          }
        }
      }
    }
    return best;
  }
}

// Arc-length helpers over a sampled polyline: total length, point + unit
// tangent at a given arc position (binary search over the cumulative table).
function arcWalker(pts: Vec2[]) {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  const len = cum[pts.length - 1] ?? 0;
  const at = (a: number): Vec2 => {
    const t = Math.max(0, Math.min(len, a));
    let lo = 0;
    let hi = cum.length - 1;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m] <= t) lo = m;
      else hi = m;
    }
    const span = cum[hi] - cum[lo] || 1;
    const f = (t - cum[lo]) / span;
    return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * f, z: pts[lo].z + (pts[hi].z - pts[lo].z) * f };
  };
  const tangentAt = (a: number): Vec2 => {
    const p0 = at(Math.max(0, a - 6));
    const p1 = at(Math.min(len, a + 6));
    const d = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    return { x: (p1.x - p0.x) / d, z: (p1.z - p0.z) / d };
  };
  return { len, at, tangentAt };
}

function buildSubdivisions(
  masterSeed: string,
  nodes: SuburbNode[],
  b: BBox,
  mask: ShapeMask,
  storages: { majA: GridStorage; minA: GridStorage; majS: GridStorage; minS: GridStorage },
  roadLines: Vec2[][],
): { spines: Vec2[][]; loops: Vec2[][]; culs: Vec2[][] } {
  const rng = seedrandom(`${masterSeed}::suburb::subdiv`);
  const ownSub = new GridStorage(64);
  const sep: Sep[] = [
    { s: storages.majA, d: SUB_SEP_ART },
    { s: storages.minA, d: SUB_SEP_ART },
    { s: storages.majS, d: SUB_SEP_ST },
    { s: storages.minS, d: SUB_SEP_ST },
    { s: ownSub, d: SUB_SEP_OWN },
  ];
  const anchors = new AnchorIndex(300);
  for (const l of roadLines) anchors.addLine(l);

  const spines: Vec2[][] = [];
  const loops: Vec2[][] = [];
  const culs: Vec2[][] = [];

  // Whole-curve validation: in bounds + in footprint everywhere; sep-tested
  // except within SUB_EXEMPT arc of the anchored start (and end, for loops —
  // both ends sit ON their host road by construction).
  const curveOk = (pts: Vec2[], exemptEnd: boolean): boolean => {
    if (pts.length < 2) return false;
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    const total = cum[pts.length - 1];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!inBounds(p, b) || mask(p.x, p.z) < 0.5) return false;
      if (cum[i] < SUB_EXEMPT) continue;
      if (exemptEnd && total - cum[i] < SUB_EXEMPT) continue;
      if (blocked(sep, p)) return false;
    }
    return true;
  };
  const accept = (pts: Vec2[], into: Vec2[][]) => {
    for (const p of pts) ownSub.add(p);
    anchors.addLine(pts);
    into.push(pts);
  };

  for (const n of nodes) {
    const u = Math.min(n.r, 280);

    // --- Collector spine: anchored to the nearest existing road ---
    const A = anchors.nearest(n.x, n.z, Math.min(1400, Math.max(520, n.r * 1.7)));
    if (!A) continue; // unreachable pod — never build an orphan development
    let dirX = n.x - A.x;
    let dirZ = n.z - A.z;
    const dLen = Math.hypot(dirX, dirZ);
    if (dLen < 30) {
      // Pod centred on a road — pick a seeded heading instead.
      const th = rng() * Math.PI * 2;
      dirX = Math.cos(th);
      dirZ = Math.sin(th);
    } else {
      dirX /= dLen;
      dirZ /= dLen;
    }
    // Build + trim a candidate spine along (dx, dz); blocked mid-way → it ends
    // there (single-entry); the start (and intact B-end) stay exempt.
    const buildSpine = (dx: number, dz: number): Vec2[] => {
      const px_ = -dz;
      const pz_ = dx;
      const C = { x: n.x + (rng() - 0.5) * u * 0.3, z: n.z + (rng() - 0.5) * u * 0.3 };
      const E = { x: C.x + dx * u * 0.85, z: C.z + dz * u * 0.85 };
      // Second mouth (fire-code loop collector) when another road is reachable
      // beyond the pod and clearly distinct from A; else a single-entry stick.
      const B0 = anchors.nearest(E.x, E.z, u * 1.3);
      const useB = B0 && Math.hypot(B0.x - A.x, B0.z - A.z) > u * 0.9 ? B0 : null;
      const endP = useB ?? E;
      const bow1 = (rng() - 0.5) * u * 0.5;
      const bow2 = (rng() - 0.5) * u * 0.5;
      const m1 = { x: (A.x + C.x) / 2 + px_ * bow1, z: (A.z + C.z) / 2 + pz_ * bow1 };
      const m2 = { x: (C.x + endP.x) / 2 + px_ * bow2, z: (C.z + endP.z) / 2 + pz_ * bow2 };
      const pts = catmullRom([A, m1, C, m2, endP], SUB_STEP);
      const cum: number[] = [0];
      for (let i = 1; i < pts.length; i++) {
        cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      }
      const total = cum[pts.length - 1];
      let cut = pts.length;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!inBounds(p, b) || mask(p.x, p.z) < 0.5) {
          cut = i;
          break;
        }
        if (cum[i] < SUB_EXEMPT) continue;
        if (useB && total - cum[i] < SUB_EXEMPT) continue;
        if (blocked(sep, p)) {
          cut = i;
          break;
        }
      }
      return pts.slice(0, cut);
    };
    // First heading: through the pod centre. If that direction is hemmed in
    // (seam pods often are), retry rotated ±55° — a development grows where
    // the land is open, not where the centroid happened to fall.
    let spine = buildSpine(dirX, dirZ);
    if (arcWalker(spine).len < 70) {
      const s = rng() < 0.5 ? 1 : -1;
      const rot = 0.96 * s; // ±55°
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      spine = buildSpine(dirX * c - dirZ * sn, dirX * sn + dirZ * c);
    }
    const walker = arcWalker(spine);
    if (walker.len < 70) continue; // hemmed in on both tries — skip the pod
    accept(spine, spines);

    // --- The subdivision network: a host QUEUE, not one station walk ---
    // The spine seeds the queue; accepted BRANCH collectors and LOOPS join it,
    // so streets keep sprouting off every generation until the pod's land is
    // saturated (the separation tests are the stopping condition) or the
    // curve budget runs out. User 2026-06-08: the block should be PACKED with
    // a network of roads that connect to each other — loops connect by
    // construction, and a branch whose tip comes close to another road SNAPS
    // onto it (a through-connection), so the interior reads as a web, not a
    // stick with fruit.
    const pBranch = 0.28;
    const pLoop = n.density >= 0.28 ? 0.42 : 0.3;
    let budget = Math.round(12 + 30 * Math.min(1, n.density * 2.2));
    const hosts: Array<{ pts: Vec2[]; gen: number }> = [{ pts: spine, gen: 0 }];
    for (let qi = 0; qi < hosts.length && budget > 0; qi++) {
      const w = arcWalker(hosts[qi].pts);
      const gen = hosts[qi].gen;
      let sideFlip = rng() < 0.5 ? 1 : -1;
      let arcPos = 44 + rng() * 40;
      while (arcPos < w.len - 30 && budget > 0) {
        const side = (rng() < 0.25 ? -1 : 1) * sideFlip;
        sideFlip = -sideFlip;
        const t = w.tangentAt(arcPos);
        const nx = -t.z * side;
        const nz = t.x * side;
        const P = w.at(arcPos);
        const what = rng();
        let advance = 62 + rng() * 36;

        if (what < pBranch && gen < 2) {
          // BRANCH collector: heads into the block; if its far end lands near
          // another road, snap to it — an interconnection, not a dead end.
          const len = 130 + rng() * 170;
          const bend = (rng() - 0.5) * 0.5;
          const jit = (rng() - 0.5) * 0.3 * len;
          const cb = Math.cos(bend);
          const sb = Math.sin(bend);
          for (const flip of [1, -1]) {
            const dx = (nx * cb - nz * sb) * flip;
            const dz = (nx * sb + nz * cb) * flip;
            const tip = { x: P.x + dx * len, z: P.z + dz * len };
            const snap = anchors.nearest(tip.x, tip.z, 80);
            // Snap only to genuinely OTHER geometry — a hit near this very
            // station is just the host again.
            const end =
              snap && Math.hypot(snap.x - P.x, snap.z - P.z) > len * 0.62 ? snap : tip;
            const cm = {
              x: P.x + dx * len * 0.5 + t.x * jit,
              z: P.z + dz * len * 0.5 + t.z * jit,
            };
            const branch = catmullRom([P, cm, end], SUB_STEP);
            if (!curveOk(branch, end !== tip)) continue;
            accept(branch, spines);
            hosts.push({ pts: branch, gen: gen + 1 });
            budget--;
            break;
          }
        } else if (what < pBranch + pLoop && arcPos + 130 < w.len - 24) {
          // LOOP: out at arcPos, back at arcPos+delta, apex `depth` to one
          // side. If that side is hemmed in (mask edge, grid seam), retry
          // mirrored — a plat builds its bean on the open side.
          const delta = Math.min(120 + rng() * 150, w.len - 24 - arcPos);
          const depth = 56 + rng() * 54;
          for (const flip of [1, -1]) {
            const lnx = nx * flip;
            const lnz = nz * flip;
            const P2 = w.at(arcPos + delta);
            const mid = { x: (P.x + P2.x) / 2 + lnx * depth, z: (P.z + P2.z) / 2 + lnz * depth };
            const q1 = {
              x: P.x + (P2.x - P.x) * 0.22 + lnx * depth * 0.8,
              z: P.z + (P2.z - P.z) * 0.22 + lnz * depth * 0.8,
            };
            const q2 = {
              x: P.x + (P2.x - P.x) * 0.78 + lnx * depth * 0.8,
              z: P.z + (P2.z - P.z) * 0.78 + lnz * depth * 0.8,
            };
            const loop = catmullRom([P, q1, mid, q2, P2], SUB_STEP);
            if (!curveOk(loop, true)) continue;
            accept(loop, loops);
            hosts.push({ pts: loop, gen: gen + 1 }); // culs/branches sprout off it
            budget--;
            advance = delta * 0.45 + 40 + rng() * 30;
            break;
          }
        } else {
          // CUL-DE-SAC: a gently bent stub into the block interior (≤ ~140 m —
          // the 700 ft suburban cap). Mirrored retry, as for loops.
          const len = 52 + rng() * 88;
          const bend = (rng() - 0.5) * 0.7;
          const jit = (rng() - 0.5) * 0.35 * len;
          const cb = Math.cos(bend);
          const sb = Math.sin(bend);
          for (const flip of [1, -1]) {
            const dx = (nx * cb - nz * sb) * flip;
            const dz = (nx * sb + nz * cb) * flip;
            const cm = { x: P.x + dx * len * 0.5 + t.x * jit, z: P.z + dz * len * 0.5 + t.z * jit };
            const tip = { x: P.x + dx * len, z: P.z + dz * len };
            const cul = catmullRom([P, cm, tip], SUB_STEP);
            if (!curveOk(cul, false)) continue;
            accept(cul, culs);
            budget--;
            break;
          }
        }
        arcPos += advance;
      }
    }
  }
  return { spines, loops, culs };
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
// blocks it (a same-family road too close). `stopAt` (#49 Stage 2) terminates
// the streamline where it enters the suburban band — draw-free, so the core
// trace streams stay aligned with the pre-pod generator.
function trace(
  field: TensorField,
  seed: Vec2,
  major: boolean,
  sep: Sep[],
  b: BBox,
  mask: ShapeMask,
  sepMul: (x: number, z: number) => number,
  stopAt?: (x: number, z: number) => boolean,
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
      if (stopAt && stopAt(next.x, next.z)) break; // entered the pod band
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
  // #49 Stage 2: hard band stop (streets only) — seeds inside it are rejected
  // WITHOUT an rng draw and streamlines terminate at its edge, so the global
  // grid is simply never traced where the node pods own the fabric.
  stopAt?: (x: number, z: number) => boolean,
): Vec2[][] {
  const lines: Vec2[][] = [];
  const accept = (seed: Vec2): boolean => {
    if (mask(seed.x, seed.z) < 0.5) return false; // seed outside the footprint
    if (stopAt && stopAt(seed.x, seed.z)) return false; // seed inside the pod band
    if (prof) prof.isFreeCalls++;
    if (!own.isFree(seed, dsep * sepMul(seed.x, seed.z))) return false;
    const t0 = prof ? performance.now() : 0;
    const line = trace(field, seed, major, sep, b, mask, sepMul, stopAt);
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
  const subAt = (x: number, z: number) => suburbAmount(radial.at(x, z));
  const artKeep = fieldOverride
    ? undefined
    : (x: number, z: number) => anchorLerp(ART_KEEP_ANCHORS, radial.at(x, z));
  const artSepMul = fieldOverride
    ? undefined
    : (x: number, z: number) => anchorLerp(ART_SEP_ANCHORS, radial.at(x, z));
  // Street separation = density ramp × per-area block-size jitter (#49 review:
  // the spike coarsened uniformly). Low-frequency noise, suburbs only — the
  // core grid stays exactly on ST_DSEP.
  const blockJitter = planeNoise(seedrandom(`${masterSeed}::tensor::blockjitter`), 3, 380, 700);
  const stSepMul = fieldOverride
    ? undefined
    : (x: number, z: number) => {
        const sub = subAt(x, z);
        const jitter = 1 + 0.25 * blockJitter(x, z) * Math.min(1, sub * 2);
        return anchorLerp(ST_SEP_ANCHORS, radial.at(x, z)) * jitter;
      };
  // #49 Stage 2: the global street grid ends where the pod band begins.
  const stStop = fieldOverride ? undefined : (x: number, z: number) => subAt(x, z) > ST_BAND_STOP;

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
      undefined,
      stStop,
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
      undefined,
      stStop,
    ),
  );

  // #49 suburban subdivisions (Stage 2 redo; skipped for sketch cities —
  // author's intent). Past the band stop the fabric is loops-and-lollipops
  // subdivisions: collector spines anchored to the existing network, loop
  // streets and cul-de-sacs hung off them. Connectivity by construction.
  let subSpines: Vec2[][] = [];
  let subLoops: Vec2[][] = [];
  let subCuls: Vec2[][] = [];
  if (!fieldOverride) {
    const nodes = sampleSuburbNodes(masterSeed, radial, mask);
    ({ spines: subSpines, loops: subLoops, culs: subCuls } = buildSubdivisions(
      masterSeed,
      nodes,
      b,
      mask,
      { majA: SmajA, minA: SminA, majS: SmajS, minS: SminS },
      [...majA, ...minA, ...majS, ...minS],
    ));
    if (onLine) {
      for (const s of [...subSpines, ...subLoops, ...subCuls]) onLine(s, "minor"); // EMIT-ONLY (#59)
    }
  }

  const arterials = [
    ...toPolys(majA, 16, "arterial", "art-maj"),
    ...toPolys(minA, 16, "arterial", "art-min"),
  ];
  const minorStreets = [
    ...toPolys(majS, 9, "minor", "st-maj"),
    ...toPolys(minS, 9, "minor", "st-min"),
    ...toPolys(subSpines, 9, "minor", "sub-spine"),
    ...toPolys(subLoops, 8, "minor", "sub-loop"),
    ...toPolys(subCuls, 7, "minor", "sub-cul"),
  ];

  return { arterials, minorStreets };
}
