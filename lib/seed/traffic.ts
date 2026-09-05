import seedrandom from "seedrandom";
import { generateCity } from "./cityGen";
import { buildPopulationField } from "./population";
import type { CityShapeSetting } from "./cityShape";
import type { RoadPoly } from "./streets";
import {
  buildRoadGraph,
  buildArcTable,
  tangentAtArc,
  verticesFromArcForward,
  verticesFromArcBackward,
  truncateToLength,
  type RoadEndpointTouches,
} from "./roadGraph";

// Deterministic car head/tail-light placement (research strand D). Each "car" is
// a point pinned to ONE road segment; it slides start→end via the shader using
// fract(uTime·speed + phase), looping (segment-local, no multi-segment path math
// on the GPU). Two streams per road, offset to opposite lanes and flowing in
// opposite directions: warm white headlights one way, red taillights the other —
// the classic top-down night-traffic read. All randomness is seeded + baked here
// (no per-frame CPU, no RNG in the render path); motion is pure uTime in-shader.
//
// #57 — highway/arterial cars keep exactly that: one instance, one segment,
// fract()-loop. Minor-tier (rural/suburban street) cars are sparse enough that
// the independent-per-macro-segment loop reads as an obvious short stretch of
// road re-driven forever. Those get a "journey" instead: one instance per
// macro-segment of a CONCATENATED multi-road polyline, all sharing one clock
// (aPhase + aSpeed) and a per-instance visibility WINDOW (aWinStart/aWinEnd, a
// fraction of that shared cycle) so exactly one segment is "occupied" at a
// time as the window sweeps start→end, followed by a seeded dark respawn gap
// (aWinEnd..1 of the cycle). aRoadEnd carries the road's traverse fraction of
// the full cycle so the shader can fade in/out at the JOURNEY's start/end
// rather than at every macro-segment join. Legacy (highway/arterial) instances
// set aWinStart=0, aWinEnd=1, aRoadEnd=1 — the window math then degenerates
// exactly to the original single-segment fract() loop.
//
// #57 v3 (2026-09-05) — a journey no longer pins to ONE road: at that road's
// far end it walks lib/seed/roadGraph.ts's proximity graph onto a connected
// minor road (straightest continuation, never an immediate U-turn), repeating
// for a seeded 3-6 roads or until a dead end, then concatenating the whole
// walk into ONE polyline before chunking — so a rural car crosses onto a
// differently-named street instead of looping the same stretch forever. See
// wiki/notes/decision-traffic-journeys.md.

export type TrafficData = {
  count: number;
  aA: Float32Array; // n·3 — travel-start point (lane-offset, raised to CAR_Y)
  aB: Float32Array; // n·3 — travel-end point
  aPhase: Float32Array; // n  — shared cycle start phase 0..1 (per journey, or per legacy car)
  aSpeed: Float32Array; // n  — cycle-fractions per second (whole journey, or legacy segment)
  aColor: Float32Array; // n·3 — per-car HEADLIGHT colour (bulb-pool pick)
  aTail: Float32Array; // n·3 — per-car TAILLIGHT colour
  aHead: Float32Array; // n  — 1 if car flows "headlight-first" (top-down ribbon read)
  aReveal: Float32Array; // n  — per-car intro reveal time 0..1 (density ramp)
  aSize: Float32Array; // n  — base point size (px, before attenuation)
  aWinStart: Float32Array; // n  — this instance's visibility window start (cycle fraction 0..1)
  aWinEnd: Float32Array; // n  — this instance's visibility window end (cycle fraction 0..1)
  aRoadEnd: Float32Array; // n  — journey's traverse-fraction of the full cycle (1 = legacy, no gap)
  maxRadius: number; // furthest car from city centre — normalises the center-out wake
  // #57 v3 — one entry per MINOR-tier journey actually emitted (debug /
  // scripts/trafficJourneyCheck.ts only; empty contributes nothing to the
  // rendered scene). Legacy highway/arterial cars aren't journeys and don't
  // appear here.
  journeyStats: Array<{ roads: number; lenM: number }>;
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
// Hard instance cap (array ceiling + emission backstop). Raised from 5000 to
// 9000 for #57 v2: 1-3 concurrent journeys per minor road + short respawn gaps
// push minor-tier instances well above the old scatter. Worst-case measured
// demand at the app multipliers (highway 4 / arterial 2 / minor 1) across
// tiers 6-8 and 6 seeds was ~7227 (tier 6); 9000 is ~+24% headroom. Points are
// cheap — one additive draw call, tile-culled (#55) — so 9000 vs 5000 does not
// change frame cost in character. (The demand THROTTLE stays at 5000, below.)
const MAX_CARS = 9000;
// #57 v2 — DEMAND throttle reference, separate from the hard MAX_CARS cap.
// budgetScale thins every tier proportionally when the pre-cap expected sum
// exceeds this. Held at the ORIGINAL 5000 (the old MAX_CARS value) so that
// highway/arterial counts AND the minor-road grant rate stay bit-identical to
// what shipped: the app runs highway 4x / arterial 2x, where the old cap was
// already throttling budgetScale to ~0.5, so raising the hard cap must NOT
// silently ~2x the highways. The added minor liveliness comes from the short
// respawn gaps + 1-3 concurrent cars, NOT from un-throttling the demand.
const DEMAND_BUDGET = 5000;
const MIN_SEG = 6; // drop a macro-segment shorter than this (m)
// Tensor road polylines are finely sampled (RK4 streamline steps ~2-4 m), so
// raw vertex pairs are far too short to slide a car along. Chunk each polyline
// into ~CHUNK-metre macro-segments (straight chords) and place cars on those —
// the gentle tensor curvature means a chord barely deviates from the road.
const CHUNK = 55;

// A car light is a light, not a vehicle — its apparent size must depend ONLY on how
// far it is from the camera (the distance LOD term in the shader), never on the road
// tier it sits on (#78). A highway headlight and a side-street headlight at the same
// distance read identically. So every car gets the same base point size regardless of
// tier; only a small per-car jitter (±15%) survives for natural variation. (Previously
// this was per-tier — highway 7 / arterial 5.5 / minor 4 — which fattened big-road
// lights and was the reported bug.)
const CAR_LIGHT_SIZE = 5;

type TierCfg = {
  carsPerM: number;
  speed: number;
  laneHalf: number; // offset (m) from centreline to the innermost lane (median gap)
  laneWidth: number; // spacing (m) between adjacent lanes within one direction
  lanes: number; // lanes per direction
};

function tierCfg(tier: "highway" | "arterial" | "minor"): TierCfg {
  switch (tier) {
    case "highway":
      return { carsPerM: 0.02, speed: 24, laneHalf: 4.0, laneWidth: 4.0, lanes: 3 };
    case "arterial":
      return { carsPerM: 0.012, speed: 14, laneHalf: 3.0, laneWidth: 3.2, lanes: 2 };
    default:
      return { carsPerM: 0.008, speed: 8, laneHalf: 2.5, laneWidth: 0, lanes: 1 }; // minor
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
  tier: Tier;
  roadId: number; // groups macro-segments chunked from the SAME source polyline (#57)
  cumLen: number; // chord length of this road's macro-segments BEFORE this one (m)
  roadLen: number; // this road's total chord length, sum of all its macro-segments (m)
};

type TrafficSegmentsResult = {
  segs: RawSeg[];
  // Minor-road polylines + the roadId `collect` assigned each one (or -1 if
  // skipped as degenerate) — index-parallel to `city.streets`. Feeds the #57 v3
  // road-graph journey walk in buildTraffic; buildTrafficDensity ignores these.
  minorRoads: RoadPoly[];
  minorRoadIds: number[];
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
): TrafficSegmentsResult {
  const city = generateCity(masterSeed, shape, shapeScale);
  const pop = popCoupling > 0 ? buildPopulationField(masterSeed, shape, shapeScale) : null;

  const segs: RawSeg[] = [];
  let nextRoadId = 0;
  const collect = (verts: Vert[], tier: Tier): number => {
    const cfg = tierCfg(tier);
    const baseMult = tierMul[tier];
    if (verts.length < 2) return -1;
    const roadId = nextRoadId++;
    const roadStart = segs.length;
    let startIdx = 0;
    let accum = 0;
    let cum = 0; // running chord length of macro-segments already pushed for this road
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
          segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, len, cfg, mult, tier, roadId, cumLen: cum, roadLen: 0 });
          cum += len;
        }
        startIdx = i;
        accum = 0;
      }
    }
    // Now that the road's total chord length is known, patch it onto every
    // macro-segment just pushed for this road (roadLen is the same for all of
    // them — only cumLen varies).
    for (let k = roadStart; k < segs.length; k++) segs[k].roadLen = cum;
    return roadId;
  };
  for (const h of city.topology.highways) collect(h.vertices, "highway");
  for (const a of city.arterials) collect(a.vertices, "arterial");
  const minorRoadIds = city.streets.map((s) => collect(s.vertices, "minor"));
  return { segs, minorRoads: city.streets, minorRoadIds };
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
  const { segs } = buildTrafficSegments(masterSeed, tierMul, shape, shapeScale, popCoupling);
  const raws = segs.map((s) => segExpected(s, density));
  // Per-metre intensity (count / length) drives the COLOUR — otherwise a long
  // highway chord always out-colours a short busy downtown block purely on
  // length. Normalise that against p99 so the ramp reads the road hierarchy.
  const perM = segs.map((s, i) => (s.len > 0 ? raws[i] / s.len : 0));
  const sorted = [...perM].sort((a, b) => a - b);
  const p99 = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] || 0 : 0;
  const norm = p99 > 0 ? p99 : 1;
  // Gamma-spread the normalised intensity (#78): highways carry ~7.5x a city
  // street's per-metre density, so a LINEAR ramp crushes every non-highway road
  // into the near-black bottom of the inferno ramp (arterials + streets read as one
  // flat purple). The road tiers are roughly MULTIPLICATIVE, so a sub-1 gamma lifts
  // the mid/low band into the visible ramp: busy arterials → orange, city streets →
  // magenta, suburban → dim purple, highways still top out yellow.
  const GAMMA = 0.45;
  const segments: TrafficDensitySeg[] = segs.map((s, i) => ({
    ax: s.ax,
    az: s.az,
    bx: s.bx,
    bz: s.bz,
    density: Math.pow(Math.min(1, perM[i] / norm), GAMMA),
    raw: raws[i],
  }));
  return { segments, maxRaw: p99 };
}

// #57 — seeded respawn gap for a minor-tier journey, in ABSOLUTE SECONDS
// (user 2026-07-04). The first cut made the gap a multiple of the road's
// one-way traverse time, which left a long quiet road (~50 s to drive) dark
// for up to ~100 s — it read as EMPTY, not "occasional car". A flat 0.5–4.0 s
// gap means a car re-appears almost immediately after finishing the road, so
// even a lone-car road reads as alive. Converted to a cycle fraction per
// journey via its own speed (see the journey loop).
const GAP_MIN_SEC = 0.5;
const GAP_RANGE_SEC = 3.5; // → 0.5..4.0 s dark between passes

// #57 — concurrent cars per ACTIVE minor road (user 2026-07-04). One car per
// road read too sparse; allow 1–3, each on its OWN seeded phase + gap so they
// bunch and spread irregularly (syncopated) rather than marching evenly. Cap
// by road length so a short stub never hosts three cars nose-to-tail.
const CONCURRENT_SHORT_M = 150; // below this: at most 1 car
const CONCURRENT_LONG_M = 350; // at/above this: up to 3 (between: up to 2)

// #57 v3 — road-graph journey walk (see lib/seed/roadGraph.ts header for the
// epsilon rationale: measured against real generator output, not a literal
// "few metres" — 45m catches most real touches while staying under the
// same-family street separation floor (ST_DTEST = 54m in tensorStreets.ts) so
// two parallel, non-touching streets can't misconnect).
const JOURNEY_LINK_EPSILON = 45;
// Skip a candidate continuation shorter than this — a touch landing a metre
// or two from the other road's OWN endpoint would otherwise offer a
// near-zero-length "hop" back the way the car just came.
const JOURNEY_MIN_HOP_M = 15;
// Roads per journey: seeded 3..6 (a dead end can still cut this short).
const JOURNEY_MIN_ROADS = 3;
const JOURNEY_ROAD_SPAN = 4; // 3 + floor(rng()*4) → 3..6 inclusive
// A continuation hop's landing point is a road ENDPOINT touch, so "continue
// onto it" means travelling to ITS far end — fine for a short subdivision
// loop/cul, but the tensor-field global-grid streets run well past 1km, and
// blindly driving one to its own end (measured: pushed mean journey length
// past 2.5-3.8km, hard-capping total car instances at MAX_CARS on 2 of 3
// spot-check seeds). Cap a CONTINUATION leg's distance so a long connecting
// road is cruised for a while, not driven end-to-end; the journey simply ends
// there rather than hopping again from an arbitrary mid-road point (there's
// no real junction to reason about at a cap cut). The STARTING road is exempt
// — it's driven in full, same as before #57 v3.
const JOURNEY_LEG_CAP_M = 200;

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
  const { segs, minorRoads, minorRoadIds } = buildTrafficSegments(
    masterSeed,
    { ...tierMul },
    shape,
    shapeScale,
    popCoupling,
  );

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
  // Throttle against DEMAND_BUDGET (not the raised hard cap) so legacy tiers and
  // the grant rate stay at the shipped density (see DEMAND_BUDGET).
  const budgetScale = expSum > DEMAND_BUDGET ? DEMAND_BUDGET / expSum : 1;

  // Growable output — legacy (highway/arterial) cars are pushed as generated;
  // minor-tier journey instances are appended afterward. Using plain arrays
  // (converted to typed arrays at the end) sidesteps having to know the final
  // minor-tier instance count up front.
  const aA: number[] = [];
  const aB: number[] = [];
  const aPhase: number[] = [];
  const aSpeed: number[] = [];
  const aColor: number[] = [];
  const aTail: number[] = [];
  const aHead: number[] = [];
  const aReveal: number[] = [];
  const aSize: number[] = [];
  const aWinStart: number[] = [];
  const aWinEnd: number[] = [];
  const aRoadEnd: number[] = [];
  let emitted = 0;
  let maxRadius = 1; // city centre is (0, -120); see Streetlights wake convention

  function emit(
    sx: number,
    sz: number,
    ex: number,
    ez: number,
    phase: number,
    speed: number,
    head: [number, number, number],
    tail: [number, number, number],
    headFlag: number,
    reveal: number,
    size: number,
    winStart: number,
    winEnd: number,
    roadEnd: number,
  ) {
    aA.push(sx, CAR_Y, sz);
    aB.push(ex, CAR_Y, ez);
    aPhase.push(phase);
    aSpeed.push(speed);
    aColor.push(head[0], head[1], head[2]);
    aTail.push(tail[0], tail[1], tail[2]);
    aHead.push(headFlag);
    aReveal.push(reveal);
    aSize.push(size);
    aWinStart.push(winStart);
    aWinEnd.push(winEnd);
    aRoadEnd.push(roadEnd);
    emitted += 1;
    const r1 = Math.hypot(sx, sz + 120);
    const r2 = Math.hypot(ex, ez + 120);
    if (r1 > maxRadius) maxRadius = r1;
    if (r2 > maxRadius) maxRadius = r2;
  }

  // --- Legacy per-segment cars (highway + arterial; minor discarded below) ---
  // Structure and rng() consumption here are UNCHANGED from before #57: every
  // segment (any tier) still gets its Bernoulli-rounded car count and every
  // car still draws its 8 rng() values in the same order. Minor-tier draws are
  // simply not emitted — this guarantees the highway/arterial output (counts,
  // positions, colours, speeds) is bit-for-bit unperturbed by the #57 rework,
  // since minor-tier segments sort last in `segs` and nothing about their
  // processing can shift an EARLIER segment's rng draws.
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
      const phase = rng();
      // metres/sec → segment-fractions/sec; clamp so very short segments don't zip.
      const speed = Math.min(2.0, (s.cfg.speed * (0.75 + rng() * 0.5)) / s.len);
      // Both lights baked per car; the shader picks head vs tail by whether this
      // car drives toward or away from the camera (#45).
      const head = pickBulb(HEAD_POOL, rng());
      const tail = pickBulb(TAIL_POOL, rng());
      const headFlag = dir > 0 ? 1 : 0;
      const reveal = rng(); // intro reveal time — drives the density ramp
      const size = CAR_LIGHT_SIZE * (0.85 + rng() * 0.3); // tier-independent (#78)
      // #57: minor-tier segments are re-generated below as full-road journeys.
      // The draws above still had to happen here (same spot in the rng
      // stream) — this result for minor is discarded, not emitted.
      if (s.tier === "minor") continue;
      emit(sx, sz, ex, ez, phase, speed, head, tail, headFlag, reveal, size, 0, 1, 1);
    }
  }

  // --- #57 v3: minor-tier multi-road journeys -----------------------------
  // Rural/suburban streets are sparse enough (~0.008 cars/m, further thinned
  // by the population-busyness coupling) that a car confined to ONE road —
  // even the whole original polyline, not just a 55m chunk — is visibly
  // looping the same named street forever once it recycles. Fix: at the
  // road's far end, walk lib/seed/roadGraph.ts's proximity graph onto a
  // connected minor road (straightest continuation, never an immediate
  // U-turn), repeat for a seeded 3-6 roads or until a dead end, then
  // concatenate the whole walk into ONE polyline and chunk THAT — so the
  // shared-clock + visibility-window machinery below is unchanged from v2,
  // it just runs over a longer, multi-road polyline. One GPU point instance
  // per macro-segment of the journey (no new textures); each instance's
  // aWinStart/aWinEnd gate WHEN in the shared cycle it's the "occupied"
  // segment (lib/shaders/traffic.ts).
  const roadGroups = new Map<number, number[]>(); // roadId -> seg indices, road order
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].tier !== "minor") continue;
    const g = roadGroups.get(segs[i].roadId);
    if (g) g.push(i);
    else roadGroups.set(segs[i].roadId, [i]);
  }

  // roadId -> index into `minorRoads`/`minorRoadIds`/`graph` (built in lockstep
  // by buildTrafficSegments, so every roadId with a non-empty roadGroups entry
  // is guaranteed to resolve here).
  const roadIdToMinorIdx = new Map<number, number>();
  for (let k = 0; k < minorRoadIds.length; k++) {
    if (minorRoadIds[k] >= 0) roadIdToMinorIdx.set(minorRoadIds[k], k);
  }
  const graph: RoadEndpointTouches[] = buildRoadGraph(minorRoads, JOURNEY_LINK_EPSILON);
  const arcTables = minorRoads.map((r) => buildArcTable(r.vertices));
  const minorCfg = tierCfg("minor"); // fixed for every road in a journey (#57 v3)
  const journeyStats: Array<{ roads: number; lenM: number }> = [];

  // Arrival heading at a road's far end, travelling either start→end
  // (forward) or end→start (!forward).
  function headingAtFarEnd(minorIdx: number, forward: boolean): { x: number; z: number } {
    const verts = minorRoads[minorIdx].vertices;
    const cum = arcTables[minorIdx];
    if (forward) return tangentAtArc(verts, cum, cum[cum.length - 1] ?? 0);
    const t = tangentAtArc(verts, cum, 0);
    return { x: -t.x, z: -t.z };
  }

  // Deterministic pick of the next road at a junction: straightest heading
  // change among the roads touching the far end, excluding the road the
  // journey just arrived on (never an immediate U-turn) and any candidate
  // whose remaining length is too short to count as a real continuation.
  function pickNextHop(
    minorIdx: number,
    forward: boolean,
    cameFromIdx: number,
  ): { minorIdx: number; continueForward: boolean; arcM: number; remaining: number } | null {
    const touches = forward ? graph[minorIdx].end : graph[minorIdx].start;
    const arrival = headingAtFarEnd(minorIdx, forward);
    let best:
      | { minorIdx: number; continueForward: boolean; arcM: number; remaining: number; score: number }
      | null = null;
    for (const touch of touches) {
      if (touch.roadIndex === cameFromIdx) continue;
      const otherVerts = minorRoads[touch.roadIndex].vertices;
      const otherCum = arcTables[touch.roadIndex];
      const otherLen = otherCum[otherCum.length - 1] ?? 0;
      for (const continueForward of [true, false]) {
        const remaining = continueForward ? otherLen - touch.arcM : touch.arcM;
        if (remaining < JOURNEY_MIN_HOP_M) continue;
        const enter = tangentAtArc(otherVerts, otherCum, touch.arcM);
        const entryHeading = continueForward ? enter : { x: -enter.x, z: -enter.z };
        const score = arrival.x * entryHeading.x + arrival.z * entryHeading.z;
        if (!best || score > best.score || (score === best.score && touch.roadIndex < best.minorIdx)) {
          best = { minorIdx: touch.roadIndex, continueForward, arcM: touch.arcM, remaining, score };
        }
      }
    }
    return best;
  }

  // Walk the graph from a granted starting road, concatenating each hop's
  // sub-polyline (already oriented in travel order) into one journey. Returns
  // the roads visited too, purely for scripts/trafficJourneyCheck.ts stats.
  function buildJourney(
    startMinorIdx: number,
    startForward: boolean,
    maxRoads: number,
  ): { verts: Vert[]; roadCount: number } {
    const startVerts = minorRoads[startMinorIdx].vertices;
    const verts: Vert[] = startForward ? [...startVerts] : [...startVerts].reverse();
    let curIdx = startMinorIdx;
    let curForward = startForward;
    let cameFrom = -1;
    let roadCount = 1;
    while (roadCount < maxRoads) {
      const hop = pickNextHop(curIdx, curForward, cameFrom);
      if (!hop) break;
      const otherVerts = minorRoads[hop.minorIdx].vertices;
      const otherCum = arcTables[hop.minorIdx];
      const piece = hop.continueForward
        ? verticesFromArcForward(otherVerts, otherCum, hop.arcM)
        : verticesFromArcBackward(otherVerts, otherCum, hop.arcM);
      const capped = hop.remaining > JOURNEY_LEG_CAP_M;
      verts.push(...(capped ? truncateToLength(piece, JOURNEY_LEG_CAP_M) : piece));
      roadCount++;
      // A capped leg stops mid-road — there's no real junction to reason
      // about at the cut, so the journey ends here rather than hopping again.
      if (capped) break;
      cameFrom = curIdx;
      curIdx = hop.minorIdx;
      curForward = hop.continueForward;
    }
    return { verts, roadCount };
  }

  // Re-chunk a (possibly multi-road) journey polyline with the SAME
  // CHUNK/MIN_SEG rule buildTrafficSegments uses per-road, so a journey's
  // macro-segments are geometrically identical in character to a single
  // road's — just spanning the concatenated path instead of one polyline.
  function chunkJourney(verts: Vert[]): { chunks: RawSeg[]; totalLen: number } {
    const chunks: RawSeg[] = [];
    let startIdx = 0;
    let accum = 0;
    let cum = 0;
    for (let i = 1; i < verts.length; i++) {
      accum += Math.hypot(verts[i].x - verts[i - 1].x, verts[i].z - verts[i - 1].z);
      const last = i === verts.length - 1;
      if (accum >= CHUNK || last) {
        const a = verts[startIdx];
        const b = verts[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len >= MIN_SEG) {
          chunks.push({
            ax: a.x,
            az: a.z,
            bx: b.x,
            bz: b.z,
            len,
            cfg: minorCfg,
            mult: 1,
            tier: "minor",
            roadId: -1,
            cumLen: cum,
            roadLen: 0,
          });
          cum += len;
        }
        startIdx = i;
        accum = 0;
      }
    }
    return { chunks, totalLen: cum };
  }

  for (const [roadId, idxs] of roadGroups) {
    const roadLen = segs[idxs[0]].roadLen;
    if (roadLen <= 0) continue;
    let roadExpected = 0;
    for (const i of idxs) roadExpected += expected[i] * budgetScale;
    // GRANT: does this road carry traffic at all? Demand-based (length × tier
    // rate × population-busyness), divided by the segment count so the decision
    // is per-road, and Bernoulli-rounded exactly like the legacy per-segment
    // draw. Busier areas grant more roads; remote roads mostly stay dark. Once
    // granted, the concurrent count below (not this magnitude) sets how many
    // cars run — so a quiet granted road still gets a lively 1–3. The
    // START of a journey is still gated per-road like this; CONTINUATIONS
    // onto connected roads below are not separately gated (a car already in
    // motion doesn't need fresh permission to keep driving).
    const grantProb = roadExpected / idxs.length;
    let grant = Math.floor(grantProb);
    if (rng() < grantProb - grant) grant += 1;
    if (grant <= 0) continue;

    // CONCURRENT CARS (#57 v2): 1–3, capped by road length, each independent.
    // Independent seeded phase + gap per car → syncopated, never evenly spaced.
    const cap = roadLen < CONCURRENT_SHORT_M ? 1 : roadLen < CONCURRENT_LONG_M ? 2 : 3;
    const concurrent = 1 + Math.floor(rng() * cap);

    const startMinorIdx = roadIdToMinorIdx.get(roadId);
    // Invariant: minorRoadIds is built by the SAME collect() calls that
    // populated roadGroups' roadIds, so this is always found — the guard is
    // defensive only (skip rather than crash on a mapping that can't occur).
    if (startMinorIdx === undefined) continue;

    for (let j = 0; j < concurrent; j++) {
      const dir = rng() < 0.5 ? 1 : -1;
      const laneIdx = Math.floor(rng() * minorCfg.lanes);
      const off = (minorCfg.laneHalf + laneIdx * minorCfg.laneWidth) * dir;
      const speedMps = minorCfg.speed * (0.75 + rng() * 0.5);
      const roadCap = JOURNEY_MIN_ROADS + Math.floor(rng() * JOURNEY_ROAD_SPAN);

      const journey = buildJourney(startMinorIdx, dir > 0, roadCap);
      const { chunks, totalLen } = chunkJourney(journey.verts);
      if (chunks.length === 0 || totalLen <= 0) continue;
      // MAX_CARS backstop: each car costs one instance per macro-segment of
      // its journey — stop adding cars once that would bust the cap rather
      // than truncate one mid-journey (which would visibly clip it short).
      if (emitted + chunks.length > MAX_CARS) break;
      journeyStats.push({ roads: journey.roadCount, lenM: totalLen });

      // Respawn gap in absolute seconds → cycle fraction. cycleSec = time to
      // drive the journey once + the dark gap; roadEndFrac is the traverse's
      // share of that cycle; cycleLen is the virtual full-cycle distance the
      // window maths index into (= speed × cycleSec, so winEnd of the last
      // segment lands exactly on roadEndFrac).
      const traverseSec = totalLen / speedMps;
      const gapSec = GAP_MIN_SEC + rng() * GAP_RANGE_SEC;
      const cycleSec = traverseSec + gapSec;
      const roadEndFrac = traverseSec / cycleSec;
      const cycleLen = speedMps * cycleSec;
      const journeySpeed = 1 / cycleSec; // cycle-fractions per second
      const phase = rng();
      const head = pickBulb(HEAD_POOL, rng());
      const tail = pickBulb(TAIL_POOL, rng());
      const headFlag = dir > 0 ? 1 : 0;
      const reveal = rng();
      const size = CAR_LIGHT_SIZE * (0.85 + rng() * 0.3);

      for (const c of chunks) {
        const dx = (c.bx - c.ax) / c.len;
        const dz = (c.bz - c.az) / c.len;
        // Perpendicular to the journey's OWN travel direction (already baked
        // into chunk a→b order by buildJourney/chunkJourney) — no per-chunk
        // dir flip needed here; `off`'s sign (from `dir` above) fixes which
        // side of the centreline this car keeps for the whole trip.
        const px = -dz;
        const pz = dx;
        const sx = c.ax + px * off;
        const sz = c.az + pz * off;
        const ex = c.bx + px * off;
        const ez = c.bz + pz * off;
        // cumLen is already arc length from the JOURNEY's own start (not a
        // single road's), since chunkJourney chunks the concatenated polyline.
        const winStart = c.cumLen / cycleLen;
        const winEnd = (c.cumLen + c.len) / cycleLen;
        emit(sx, sz, ex, ez, phase, journeySpeed, head, tail, headFlag, reveal, size, winStart, winEnd, roadEndFrac);
      }
    }
  }

  return {
    count: emitted,
    aA: Float32Array.from(aA),
    aB: Float32Array.from(aB),
    aPhase: Float32Array.from(aPhase),
    aSpeed: Float32Array.from(aSpeed),
    aColor: Float32Array.from(aColor),
    aTail: Float32Array.from(aTail),
    aHead: Float32Array.from(aHead),
    aReveal: Float32Array.from(aReveal),
    aSize: Float32Array.from(aSize),
    aWinStart: Float32Array.from(aWinStart),
    aWinEnd: Float32Array.from(aWinEnd),
    aRoadEnd: Float32Array.from(aRoadEnd),
    maxRadius,
    journeyStats,
  };
}
