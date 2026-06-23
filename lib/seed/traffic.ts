import seedrandom from "seedrandom";
import { generateCity } from "./cityGen";
import { buildPopulationField } from "./population";
import type { CityShapeSetting } from "./cityShape";

// Deterministic car head/tail-light placement (research strand D). Each "car" is
// a point pinned to ONE road segment; it slides start→end via the shader using
// fract(uTime·speed + phase), looping (segment-local, no multi-segment path math
// on the GPU). Two streams per road, offset to opposite lanes and flowing in
// opposite directions: warm white headlights one way, red taillights the other —
// the classic top-down night-traffic read. All randomness is seeded + baked here
// (no per-frame CPU, no RNG in the render path); motion is pure uTime in-shader.

export type TrafficData = {
  count: number;
  aA: Float32Array; // n·3 — travel-start point (lane-offset, raised to CAR_Y)
  aB: Float32Array; // n·3 — travel-end point
  aPhase: Float32Array; // n  — per-car phase 0..1
  aSpeed: Float32Array; // n  — segment fractions per second
  aColor: Float32Array; // n·3 — per-car HEADLIGHT colour (bulb-pool pick)
  aTail: Float32Array; // n·3 — per-car TAILLIGHT colour
  aHead: Float32Array; // n  — 1 if car flows "headlight-first" (top-down ribbon read)
  aReveal: Float32Array; // n  — per-car intro reveal time 0..1 (density ramp)
  aSize: Float32Array; // n  — base point size (px, before attenuation)
  maxRadius: number; // furthest car from city centre — normalises the center-out wake
};

type Vert = { x: number; z: number };

// Per-car bulb-colour pools (#45). sRGB-display values from the headlight
// colour-temperature research strand, weighted to the on-road install base:
// halogen still dominant, LEDs rising, aftermarket-blue rare. Taillights split
// incandescent vs LED red. Used raw (matching the existing traffic treatment) —
// linearise (square each channel) here if they wash out under tone-mapping.
type Bulb = { c: [number, number, number]; w: number };
const HEAD_POOL: Bulb[] = [
  { c: [1.0, 0.71, 0.42], w: 0.3 }, // ~3000K halogen (warm)
  { c: [1.0, 0.85, 0.7], w: 0.22 }, // ~4300K xenon / HID
  { c: [1.0, 0.89, 0.81], w: 0.28 }, // ~5000K LED
  { c: [1.0, 0.98, 1.0], w: 0.15 }, // ~6500K cool LED
  { c: [0.89, 0.91, 1.0], w: 0.05 }, // ~8000K aftermarket blue
];
const TAIL_POOL: Bulb[] = [
  { c: [1.0, 0.12, 0.04], w: 0.45 }, // incandescent
  { c: [1.0, 0.05, 0.05], w: 0.55 }, // LED red
];
function pickBulb(pool: Bulb[], r: number): [number, number, number] {
  const total = pool.reduce((s, b) => s + b.w, 0);
  let x = r * total;
  for (const b of pool) {
    if (x < b.w) return b.c;
    x -= b.w;
  }
  return pool[pool.length - 1].c;
}

const CAR_Y = 1.4; // sit just above the road surface (road y ≈ 0.05)
const MAX_CARS = 5000; // hard cap — logged by the caller if exceeded
const MIN_SEG = 6; // drop a macro-segment shorter than this (m)
// Tensor road polylines are finely sampled (RK4 streamline steps ~2-4 m), so
// raw vertex pairs are far too short to slide a car along. Chunk each polyline
// into ~CHUNK-metre macro-segments (straight chords) and place cars on those —
// the gentle tensor curvature means a chord barely deviates from the road.
const CHUNK = 55;

type TierCfg = {
  carsPerM: number;
  speed: number;
  laneHalf: number; // offset (m) from centreline to the innermost lane (median gap)
  laneWidth: number; // spacing (m) between adjacent lanes within one direction
  lanes: number; // lanes per direction
  size: number;
};

function tierCfg(tier: "highway" | "arterial" | "minor"): TierCfg {
  switch (tier) {
    case "highway":
      return { carsPerM: 0.02, speed: 24, laneHalf: 4.0, laneWidth: 4.0, lanes: 3, size: 7 };
    case "arterial":
      return { carsPerM: 0.012, speed: 14, laneHalf: 3.0, laneWidth: 3.2, lanes: 2, size: 5.5 };
    default:
      return { carsPerM: 0.008, speed: 8, laneHalf: 2.5, laneWidth: 0, lanes: 1, size: 4 }; // minor
  }
}

// Population coupling (user 2026-06-07): a road's business reflects the area
// it's in. Per macro-segment, local population (0..1) maps to a car-count
// multiplier — downtown arterials keep their stream, remote ones carry a
// trickle. The floor keeps no road completely dead; the sub-linear exponent
// stops mid-density suburbs from emptying out. Highways are EXEMPT: they carry
// through-traffic that doesn't care who lives beside the embankment (same
// reasoning as the streetlight "mains exempt" rule).
const BUSY_FLOOR = 0.12;
const BUSY_GAMMA = 0.7;
// Local pop (0..1) at which a road reads "fully busy" — saturating well below
// the p99 peak keeps downtown at its established traffic level; the coupling
// only ever *removes* cars from the quiet bands.
const BUSY_REF = 0.45;
function busyness(pop: number): number {
  return BUSY_FLOOR + (1 - BUSY_FLOOR) * Math.min(1, Math.pow(pop / BUSY_REF, BUSY_GAMMA));
}

type Tier = "highway" | "arterial" | "minor";

type RawSeg = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  len: number;
  cfg: TierCfg;
  mult: number;
};

// Shared macro-segment builder — the SAME chunking + population-busyness logic
// buildTraffic uses to place cars, factored out so the traffic-density debug
// overlay can compute each segment's EXPECTED density from the identical inputs
// (no behavioural change to buildTraffic — it calls this and proceeds as before).
function buildTrafficSegments(
  masterSeed: string,
  tierMul: { highway: number; arterial: number; minor: number },
  shape: CityShapeSetting,
  shapeScale: number,
  popCoupling: number,
): RawSeg[] {
  const city = generateCity(masterSeed, shape, shapeScale);
  const pop = popCoupling > 0 ? buildPopulationField(masterSeed, shape, shapeScale) : null;

  const segs: RawSeg[] = [];
  const collect = (verts: Vert[], tier: Tier) => {
    const cfg = tierCfg(tier);
    const baseMult = tierMul[tier];
    if (verts.length < 2) return;
    let startIdx = 0;
    let accum = 0;
    for (let i = 1; i < verts.length; i++) {
      accum += Math.hypot(verts[i].x - verts[i - 1].x, verts[i].z - verts[i - 1].z);
      const last = i === verts.length - 1;
      if (accum >= CHUNK || last) {
        const a = verts[startIdx];
        const b = verts[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z); // chord length
        if (len >= MIN_SEG) {
          let mult = baseMult;
          if (pop && tier !== "highway") {
            const p = pop.sample((a.x + b.x) / 2, (a.z + b.z) / 2);
            mult *= 1 + (busyness(p) - 1) * popCoupling;
          }
          segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, len, cfg, mult });
        }
        startIdx = i;
        accum = 0;
      }
    }
  };
  for (const h of city.topology.highways) collect(h.vertices, "highway");
  for (const a of city.arterials) collect(a.vertices, "arterial");
  for (const s of city.streets) collect(s.vertices, "minor");
  return segs;
}

// One macro-segment's EXPECTED car count (pre-MAX_CARS-cap) — the intended
// density. Mirrors buildTraffic's `expected` line exactly.
function segExpected(s: RawSeg, density: number): number {
  return s.len * s.cfg.carsPerM * density * s.mult * s.cfg.lanes;
}

export type TrafficDensitySeg = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  density: number; // 0..1, normalised across all segments (relative to p99)
  raw: number; // raw EXPECTED car count for the segment (pre-cap)
};

export type TrafficDensityField = {
  segments: TrafficDensitySeg[];
  maxRaw: number; // the p99 raw density used to normalise (debug readout)
};

// Per-segment EXPECTED traffic density for the debug overlay (#78). Uses the
// SAME macro-segments + per-tier cfg + population-busyness multiplier as
// buildTraffic, and the SAME `len × carsPerM × density × busyness × lanes`
// formula — but reports the EXPECTED count BEFORE the MAX_CARS cap and the rng
// rounding, so the intended distribution is legible. Normalised against a high
// percentile (p99, like the population field) so one busy downtown chord can't
// crush the rest of the ramp toward the cool end. Pure derivation, no rng.
export function buildTrafficDensity(
  masterSeed: string,
  density = 1,
  tierMul: { highway: number; arterial: number; minor: number } = {
    highway: 1,
    arterial: 1,
    minor: 1,
  },
  shape: CityShapeSetting = "square",
  shapeScale = 1,
  popCoupling = 1,
): TrafficDensityField {
  const segs = buildTrafficSegments(masterSeed, tierMul, shape, shapeScale, popCoupling);
  const raws = segs.map((s) => segExpected(s, density));
  // Per-metre intensity (count / length) drives the COLOUR — otherwise a long
  // highway chord always out-colours a short busy downtown block purely on
  // length. Normalise that against p99 so the ramp reads the road hierarchy.
  const perM = segs.map((s, i) => (s.len > 0 ? raws[i] / s.len : 0));
  const sorted = [...perM].sort((a, b) => a - b);
  const p99 = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] || 0 : 0;
  const norm = p99 > 0 ? p99 : 1;
  const segments: TrafficDensitySeg[] = segs.map((s, i) => ({
    ax: s.ax,
    az: s.az,
    bx: s.bx,
    bz: s.bz,
    density: Math.min(1, perM[i] / norm),
    raw: raws[i],
  }));
  return { segments, maxRaw: p99 };
}

export function buildTraffic(
  masterSeed: string,
  density = 1,
  tierMul: { highway: number; arterial: number; minor: number } = {
    highway: 1,
    arterial: 1,
    minor: 1,
  },
  shape: CityShapeSetting = "square",
  shapeScale = 1,
  popCoupling = 1, // 0 = uniform (old look), 1 = fully population-driven
): TrafficData {
  const rng = seedrandom(`${masterSeed}::traffic`);
  const segs = buildTrafficSegments(masterSeed, { ...tierMul }, shape, shapeScale, popCoupling);

  // First pass: expected cars per segment (∝ length × tier density × population
  // busyness × lanes). Computed for ALL segments up front so the MAX_CARS budget is
  // shared FAIRLY: if the total expectation overflows the cap, scale every segment
  // down by the same factor. The old loop truncated `n = max(0, MAX_CARS − total)`
  // in collection order (highways → arterials → streets), so whatever came last was
  // starved to zero — always streets, and arterials too once their multiplier was
  // cranked (#78). Proportional scaling keeps each tier's share, so cars land on
  // every road, thinned together rather than dropped wholesale.
  const expected: number[] = [];
  let expSum = 0;
  for (const s of segs) {
    const e = s.len * s.cfg.carsPerM * density * s.mult * s.cfg.lanes;
    expected.push(e);
    expSum += e;
  }
  const budgetScale = expSum > MAX_CARS ? MAX_CARS / expSum : 1;
  const perSeg: number[] = [];
  let total = 0;
  for (let i = 0; i < segs.length; i++) {
    const e = expected[i] * budgetScale;
    let n = Math.floor(e);
    if (rng() < e - n) n += 1;
    if (total + n > MAX_CARS) n = Math.max(0, MAX_CARS - total); // backstop only (rng rounding)
    perSeg.push(n);
    total += n;
  }

  const aA = new Float32Array(total * 3);
  const aB = new Float32Array(total * 3);
  const aPhase = new Float32Array(total);
  const aSpeed = new Float32Array(total);
  const aColor = new Float32Array(total * 3);
  const aTail = new Float32Array(total * 3);
  const aHead = new Float32Array(total);
  const aReveal = new Float32Array(total);
  const aSize = new Float32Array(total);

  let c = 0;
  let maxRadius = 1; // city centre is (0, -120); see Streetlights wake convention
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si];
    const n = perSeg[si];
    if (n === 0) continue;
    const dx = (s.bx - s.ax) / s.len;
    const dz = (s.bz - s.az) / s.len;
    // Perpendicular (left of heading) for lane separation.
    const px = -dz;
    const pz = dx;
    for (let k = 0; k < n; k++) {
      const dir = rng() < 0.5 ? 1 : -1;
      const laneIdx = Math.floor(rng() * s.cfg.lanes); // 0..lanes-1 within this direction
      const off = (s.cfg.laneHalf + laneIdx * s.cfg.laneWidth) * dir;
      // Travel start/end oriented by direction; lanes stack outward from the median.
      const sx = (dir > 0 ? s.ax : s.bx) + px * off;
      const sz = (dir > 0 ? s.az : s.bz) + pz * off;
      const ex = (dir > 0 ? s.bx : s.ax) + px * off;
      const ez = (dir > 0 ? s.bz : s.az) + pz * off;
      aA[c * 3 + 0] = sx;
      aA[c * 3 + 1] = CAR_Y;
      aA[c * 3 + 2] = sz;
      aB[c * 3 + 0] = ex;
      aB[c * 3 + 1] = CAR_Y;
      aB[c * 3 + 2] = ez;
      aPhase[c] = rng();
      // metres/sec → segment-fractions/sec; clamp so very short segments don't zip.
      aSpeed[c] = Math.min(2.0, (s.cfg.speed * (0.75 + rng() * 0.5)) / s.len);
      // Both lights baked per car; the shader picks head vs tail by whether this
      // car drives toward or away from the camera (#45).
      const head = pickBulb(HEAD_POOL, rng());
      const tail = pickBulb(TAIL_POOL, rng());
      aColor[c * 3 + 0] = head[0];
      aColor[c * 3 + 1] = head[1];
      aColor[c * 3 + 2] = head[2];
      aTail[c * 3 + 0] = tail[0];
      aTail[c * 3 + 1] = tail[1];
      aTail[c * 3 + 2] = tail[2];
      aHead[c] = dir > 0 ? 1 : 0;
      aReveal[c] = rng(); // intro reveal time — drives the density ramp
      aSize[c] = s.cfg.size * (0.85 + rng() * 0.3);
      const r1 = Math.hypot(sx, sz + 120);
      const r2 = Math.hypot(ex, ez + 120);
      if (r1 > maxRadius) maxRadius = r1;
      if (r2 > maxRadius) maxRadius = r2;
      c += 1;
    }
  }

  return { count: total, aA, aB, aPhase, aSpeed, aColor, aTail, aHead, aReveal, aSize, maxRadius };
}
