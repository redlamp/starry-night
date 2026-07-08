import seedrandom from "seedrandom";
import * as THREE from "three";
import { generateCity, type Building } from "./cityGen";
import { CITY_CENTER, maxHalfExtent } from "./topology";
import type { CityShapeSetting } from "./cityShape";

// Helicopters (#89) — third air-transit class, a distinct motion model from
// Flights' point-to-point corridors (lib/seed/flights.ts): each helicopter
// samples an ordered, CLOSED loop of 2-4 waypoints (rooftop helipads +
// distant off-map pads) and alternates transit legs (point A to point B)
// with hover holds at each stop, so it reads as patrolling rather than
// flying through. Own rng chain keyed `${masterSeed}::helicopters` — never
// perturbs the cityGen/traffic/beacons/flights streams (PRD §5 determinism
// contract); reads generateCity() but never mutates it, same discipline as
// generateAviationBeacons (cityGen.ts:1558).
//
// Waypoint pool: rooftop pads mirror generateAviationBeacons' tallest-per-
// cell rule (cityGen.ts:1558-1580) but gated differently — height >=
// HELI_PAD_MIN_HEIGHT AND excluding industrial/oldtown districts (an
// obstruction beacon lights any tall structure; a helipad is a business/
// civic amenity, so those two districts are a poor fit) — plus 2 distant
// off-map pads (mirrors Flights' airport anchor) so a loop can always form
// even in a city with no qualifying rooftops (the pool is never smaller
// than 2).
//
// #89 route-variety + placement follow-up: the debug overlay (HelicopterRoutes)
// showed routes sparse and fringe-heavy — HELI_COUNT was low (1-3), the
// rooftop pool small (cap 6, height >= 45), and every helicopter's stop pool
// included the 2 off-map pads unconditionally, so several routes reading as
// "loop out to the 2 distant dots" was common and downtown often had none.
// Now: more helicopters (4-6), a bigger/looser rooftop pool (cap 12, height >=
// 35, same tallest-per-cell dedup so pads stay spread out), off-map pads
// gated behind a rare (25%) seeded roll and capped to AT MOST ONE
// helicopter's pool when they do appear, and a couple of helicopters always
// sampling from the pads nearest CITY_CENTER so the default camera's view
// has patrol traffic over downtown. See buildWaypointPools / nearestToCenter
// / buildHelicopters below.
//
// #89 v2 (user feedback on the tuned routes, 2026-07-05): a straight point-to-
// point hop reads as a fixed-wing corridor, not a helicopter touring an area
// and landing back at its base. Two shape changes, BOTH still plain "transit"
// legs (no leg-schema change — see the Gotcha below, still fully intact) —
// just more of them, arranged in a curve or a circle instead of one straight
// shot: (1) each hop between stops is a seeded quadratic-bezier ARC (a
// minority stay a direct reposition) sampled into ARC_SEGMENTS straight sub-
// legs, exactly anchored at the two stops — reads as banking across the city;
// (2) most arrivals get a small ORBIT circling the pad — "examining the
// area" — before the existing hover hold. Because the loop is closed, the
// final hop's orbit is around stops[0] itself — the helicopter circles its
// OWN base before settling, i.e. "landing back at base". See
// buildOrbitPoints / buildHelicopter below.
//
// #89 v3 (issue follow-up, 2026-07-08): the v2 per-hop quadratic bows were
// sampled at only 4 chords and met each stop at a hard C0 corner, so up close
// the tour still read as line segments. v3 threads ONE closed centripetal
// Catmull-Rom spline through the whole tour — control points are the stops
// plus the v2-style seeded bow midpoints — and samples each hop at
// SPLINE_SAMPLES_PER_HOP sub-legs, so curvature is continuous through every
// stop (no corners; a "straight" hop still eases in/out of its neighbours).
// Altitude gets a seeded climb-out/descend bump per hop (helicopters climb
// between rooftops, they don't ride a linear ramp). Still nothing but plain
// transit legs: the leg schema, the shader, and the dir carry-forward are
// all untouched — there are simply more, shorter sub-legs.
//
// Journey-window technique (mirrors Traffic's minor-tier journeys,
// lib/seed/traffic.ts + lib/shaders/traffic.ts): the whole closed loop is
// ONE shared clock per helicopter (phase + cycleSec); each leg carries a
// winStart/winEnd fraction of that shared cycle for lib/shaders/helicopters.ts
// to read. Unlike Traffic/Flights, there is no idle/respawn gap — a closed
// loop is ALWAYS doing something (transiting or hovering), so consecutive
// legs' windows tile the full 0..1 cycle back to back with no gap between
// them (and the last leg's window closes exactly where the first one opens —
// see the winEnd pin below).
//
// Gotcha (the one flagged in the design plan): a hover leg has aA==aB, so its
// heading can't be normalize(aB-aA) (NaN, zero-length segment). `dir` is
// precomputed here per leg and simply CARRIED FORWARD from the preceding
// transit leg — the shader reads it as a plain attribute and never re-derives
// it from aA/aB.

const HELI_PAD_MIN_HEIGHT = 35; // #89: 45 -> 35, more towers qualify
const HELI_PAD_CLUSTER_SIZE = 450; // m — neighbourhood cell for the tallest-per-cell rule
const HELI_PAD_POOL_CAP = 12; // tallest N qualifying rooftops kept in the pool (#89: 6 -> 12)
const HELI_PAD_EXCLUDE_DISTRICTS = new Set<Building["district"]>(["industrial", "oldtown"]);

// #89: a couple of helicopters are always biased toward the pads nearest
// CITY_CENTER (the default camera's look point) so downtown always has
// patrol traffic in view — their pool is the closest N qualifying rooftops
// rather than the full city-wide set. See nearestToCenter/buildHelicopters.
const CENTRAL_HELI_COUNT = 2;
const CENTRAL_POOL_SIZE = 5;

const GROUND_APRON_M = 200; // mirrors Ground.tsx GROUND_APRON_M (lib/seed files don't import components/)
const OFFMAP_PAD_COUNT = 2;
// "Just past" the disc edge — a short hop for a slow helicopter, unlike
// Flights' airport which sits a deliberate 2-6 km out.
const OFFMAP_PAD_MARGIN_MIN_M = 100;
const OFFMAP_PAD_MARGIN_MAX_M = 500;
const OFFMAP_PAD_Y = 8; // low, just above ground — an off-map pad, not cruise altitude
// #89: off-map fringe pads were dominating the route mix (every helicopter's
// pool included them unconditionally). Now a rare accent — one seeded roll
// per city decides whether ANY helicopter may touch them at all, and at most
// ONE helicopter (also seeded) gets them merged into its pool — see
// buildHelicopters.
const OFFMAP_USE_PROB = 0.25;

// Fixed ambient pool (user 2026-07-06): bake this many helicopters every seed;
// the "Max Helicopters" setting caps how many are VISIBLE (Helicopters.tsx
// zeroes the point size of the rest — a live buffer write, no regen), so the
// slider's range is seed-independent. The first CENTRAL_HELI_COUNT are
// downtown-biased, so a low cap keeps the ones in the default view.
export const AMBIENT_HELI_POOL = 10;
const STOPS_MIN = 2;
const STOPS_MAX = 4; // inclusive

// Real-world-ish cruise speed band, deliberately slower than lightGA's 50 m/s
// (lib/seed/flights.ts CLASS_SPEED) — part of the "redder/slower" read.
const HELI_SPEED_MIN = 18;
const HELI_SPEED_MAX = 25;

// Hover holds: most stops pause, some are a fly-through (no orbit, no hover
// leg at all — "skip if 0", per the design brief) so a loop doesn't feel
// mechanically uniform. #89 v2: the SAME roll also gates the examine-orbit
// below — a skipped stop is a clean flythrough, full stop.
const HOVER_SKIP_PROB = 0.3;
const HOVER_DURATION_MIN_SEC = 15;
const HOVER_DURATION_MAX_SEC = 45;

// #89 v3: hops are sampled off one closed Catmull-Rom spline through the
// whole tour (see the file-header v3 block). The bow knobs keep their v2
// meaning — they now shape the spline's mid-hop CONTROL POINT instead of a
// standalone bezier — and a minority of hops (ARC_STRAIGHT_PROB) contribute
// no bow control at all (the spline still rounds them off at the stops).
const SPLINE_SAMPLES_PER_HOP = 10;
const ARC_STRAIGHT_PROB = 0.15;
const ARC_BOW_MIN_FRAC = 0.12; // lateral bow, as a fraction of the hop's length
const ARC_BOW_MAX_FRAC = 0.32;

// #89 v3: per-hop climb-out/descend bump — the mid-hop altitude gain over a
// straight roof-to-roof ramp. Short repositioning hops barely climb; a
// cross-city leg gets real air under it (capped so nothing punches the fog).
const CLIMB_MIN_M = 12;
const CLIMB_MAX_M = 35;
const CLIMB_LEN_FRAC = 0.045; // + this fraction of the hop's ground length…
const CLIMB_LEN_CAP_M = 60; // …capped here

// #89 v2: a small circle traced around a stop before the hover hold —
// "examining the area" rather than beelining in and parking. Radius is
// deliberately tight (a specific pad/tower, not the whole neighbourhood).
const ORBIT_SEGMENTS = 6;
const ORBIT_RADIUS_MIN_M = 35;
const ORBIT_RADIUS_MAX_M = 90;

type Waypoint = { x: number; y: number; z: number };

export type HeliLegKind = "transit" | "hover";

export type HeliLeg = {
  aA: [number, number, number];
  aB: [number, number, number]; // aA===aB for a hover leg
  // Precomputed unit heading (x, 0, z) — carried forward unchanged across any
  // hover leg(s) that follow. Never derive this from aB-aA in the shader.
  dir: [number, number, number];
  kind: HeliLegKind;
  winStart: number; // 0..1, this leg's start as a fraction of the FULL closed-loop cycle
  winEnd: number; // 0..1, this leg's end
};

export type Helicopter = {
  legs: HeliLeg[];
  cycleSec: number; // full loop duration — sum of every leg's durationSec
  phase: number; // 0..1 seeded start offset into the shared cycle
};

export type HelicoptersData = {
  helicopters: Helicopter[];
};

function buildWaypointPools(
  rng: () => number,
  buildings: Building[],
): { roofs: Waypoint[]; offmap: Waypoint[] } {
  const tallestPerCell = new Map<string, Building>();
  for (const b of buildings) {
    if (b.height < HELI_PAD_MIN_HEIGHT) continue;
    if (HELI_PAD_EXCLUDE_DISTRICTS.has(b.district)) continue;
    const key = `${Math.floor(b.x / HELI_PAD_CLUSTER_SIZE)},${Math.floor(b.z / HELI_PAD_CLUSTER_SIZE)}`;
    const cur = tallestPerCell.get(key);
    if (!cur || b.height > cur.height) tallestPerCell.set(key, b);
  }
  const roofs = Array.from(tallestPerCell.values())
    .sort((a, b) => b.height - a.height)
    .slice(0, HELI_PAD_POOL_CAP)
    .map((b) => ({ x: b.x, y: b.height + 2, z: b.z }));

  const half = maxHalfExtent();
  const discEdge = half + GROUND_APRON_M;
  const offmap: Waypoint[] = [];
  for (let i = 0; i < OFFMAP_PAD_COUNT; i++) {
    const az = rng() * Math.PI * 2;
    const dist =
      discEdge + OFFMAP_PAD_MARGIN_MIN_M + rng() * (OFFMAP_PAD_MARGIN_MAX_M - OFFMAP_PAD_MARGIN_MIN_M);
    offmap.push({
      x: CITY_CENTER.x + Math.cos(az) * dist,
      y: OFFMAP_PAD_Y,
      z: CITY_CENTER.z + Math.sin(az) * dist,
    });
  }
  // Two separate pools (#89) rather than one merged array — buildHelicopters
  // biases most helicopters to roofs-only and gates offmap usage down to a
  // rare, single-helicopter accent, which needs them kept apart.
  return { roofs, offmap };
}

function distFromCenter(w: Waypoint): number {
  return Math.hypot(w.x - CITY_CENTER.x, w.z - CITY_CENTER.z);
}

// Closest N of `pool` to CITY_CENTER (#89) — the sampling pool for the
// couple of helicopters biased toward the downtown core. A plain slice when
// N >= pool.length, so it degrades gracefully in a rooftop-sparse city.
function nearestToCenter(pool: Waypoint[], n: number): Waypoint[] {
  return [...pool].sort((a, b) => distFromCenter(a) - distFromCenter(b)).slice(0, n);
}

// Fisher-Yates partial shuffle — k distinct indices from [0, poolSize).
function sampleDistinctIndices(rng: () => number, poolSize: number, k: number): number[] {
  const idx = Array.from({ length: poolSize }, (_, i) => i);
  const take = Math.min(k, poolSize);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (poolSize - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take);
}

function dist3(a: Waypoint, b: Waypoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

// Horizontal-only heading (mirrors Flights' vertex shader normalize(seg.xz)) —
// the nav-light spread and view-directional facing are both a horizontal
// perpendicular, so the carried-forward attribute only ever needs the xz
// component.
function headingXZ(a: Waypoint, b: Waypoint): [number, number, number] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, 0, dz / len];
}

// #89 v3 — the whole tour as one closed centripetal Catmull-Rom spline.
// Control points are every stop (the curve interpolates its controls, so the
// path passes EXACTLY through each stop) plus, per hop, the v2-style seeded
// lateral bow midpoint (a minority of hops roll "straight" and contribute
// none). Returns the curve plus each stop's control index, from which
// buildHelicopter maps hop i to the parameter span [idx(i)/M, idx(i+1)/M].
function buildTourSpline(
  rng: () => number,
  stops: Waypoint[],
): { curve: THREE.CatmullRomCurve3; stopCtrl: number[]; controlCount: number } {
  const controls: THREE.Vector3[] = [];
  const stopCtrl: number[] = [];
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i];
    const b = stops[(i + 1) % stops.length];
    stopCtrl.push(controls.length);
    controls.push(new THREE.Vector3(a.x, a.y, a.z));

    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const hopLen = Math.hypot(dx, dz);
    if (hopLen < 1e-3 || rng() < ARC_STRAIGHT_PROB) continue;
    const nx = -dz / hopLen; // horizontal perpendicular, unit
    const nz = dx / hopLen;
    const side = rng() < 0.5 ? 1 : -1;
    const bow = hopLen * (ARC_BOW_MIN_FRAC + rng() * (ARC_BOW_MAX_FRAC - ARC_BOW_MIN_FRAC)) * side;
    controls.push(
      new THREE.Vector3(
        (a.x + b.x) / 2 + nx * bow,
        (a.y + b.y) / 2,
        (a.z + b.z) / 2 + nz * bow,
      ),
    );
  }
  return {
    curve: new THREE.CatmullRomCurve3(controls, true, "centripetal", 0.5),
    stopCtrl,
    controlCount: controls.length,
  };
}

// Sample hop i off the tour spline into SPLINE_SAMPLES_PER_HOP sub-legs, with
// a seeded climb-out/descend altitude bump replacing the spline's own (bow-
// midpoint-averaged) Y. Endpoints are snapped to the exact stop coordinates
// so the following orbit/hover legs' aA===aB equality stays exact.
function sampleHopPoints(
  rng: () => number,
  tour: { curve: THREE.CatmullRomCurve3; stopCtrl: number[]; controlCount: number },
  stops: Waypoint[],
  hop: number,
): Waypoint[] {
  const a = stops[hop];
  const b = stops[(hop + 1) % stops.length];
  const c0 = tour.stopCtrl[hop];
  const c1 = hop + 1 < stops.length ? tour.stopCtrl[hop + 1] : tour.controlCount;
  const t0 = c0 / tour.controlCount;
  const t1 = c1 / tour.controlCount;
  const hopLen = Math.hypot(b.x - a.x, b.z - a.z);
  const climb =
    CLIMB_MIN_M +
    rng() * (CLIMB_MAX_M - CLIMB_MIN_M) +
    Math.min(CLIMB_LEN_CAP_M, hopLen * CLIMB_LEN_FRAC);

  const pts: Waypoint[] = [];
  const v = new THREE.Vector3();
  for (let s = 0; s <= SPLINE_SAMPLES_PER_HOP; s++) {
    const f = s / SPLINE_SAMPLES_PER_HOP;
    // Closed-curve param wraps at 1 (getPoint(1) === getPoint(0) === stop 0).
    tour.curve.getPoint(t0 + (t1 - t0) * f, v);
    pts.push({
      x: v.x,
      y: a.y + (b.y - a.y) * f + climb * 4 * f * (1 - f),
      z: v.z,
    });
  }
  pts[0] = { ...a };
  pts[pts.length - 1] = { ...b };
  return pts;
}

// #89 v2 — ordered points tracing a small circle around `center`, starting
// and ending exactly AT centre (enters/exits from directly overhead the pad)
// so it composes cleanly with buildArcPoints before it and the hover leg
// after it. Seeded radius, start angle, and spin direction so orbits don't
// all look identical.
function buildOrbitPoints(rng: () => number, center: Waypoint): Waypoint[] {
  const radius = ORBIT_RADIUS_MIN_M + rng() * (ORBIT_RADIUS_MAX_M - ORBIT_RADIUS_MIN_M);
  const startAngle = rng() * Math.PI * 2;
  const spin = rng() < 0.5 ? 1 : -1;
  const pts: Waypoint[] = [center];
  for (let k = 1; k < ORBIT_SEGMENTS; k++) {
    const theta = startAngle + spin * (k / ORBIT_SEGMENTS) * Math.PI * 2;
    pts.push({
      x: center.x + Math.cos(theta) * radius,
      y: center.y,
      z: center.z + Math.sin(theta) * radius,
    });
  }
  pts.push(center);
  return pts;
}

function buildHelicopter(rng: () => number, pool: Waypoint[]): Helicopter {
  const stopCount = Math.min(
    STOPS_MIN + Math.floor(rng() * (STOPS_MAX - STOPS_MIN + 1)),
    pool.length,
  );
  const stops = sampleDistinctIndices(rng, pool.length, stopCount).map((i) => pool[i]);
  // One cruise speed per helicopter (not per-leg) — a real aircraft doesn't
  // change its cruise speed leg to leg.
  const speed = HELI_SPEED_MIN + rng() * (HELI_SPEED_MAX - HELI_SPEED_MIN);

  type RawLeg = {
    aA: Waypoint;
    aB: Waypoint;
    dir: [number, number, number];
    kind: HeliLegKind;
    durationSec: number;
  };
  // Always start with a transit leg (stop 0 -> stop 1, ..., wrapping stop
  // n-1 -> stop 0) so every hover leg already has a preceding transit to
  // carry `dir` forward from — see the file header gotcha. #89 v3: each hop
  // is sampled off the ONE closed tour spline (buildTourSpline — curvature is
  // continuous through every stop), and most arrivals still get an ORBIT
  // (buildOrbitPoints) before the hover. All of it is just more transit legs,
  // so `dir` carries forward exactly as before (from whichever transit sub-
  // leg most recently ran).
  const tour = buildTourSpline(rng, stops);
  const raw: RawLeg[] = [];
  let carriedDir: [number, number, number] = [0, 0, 1];
  const pushTransit = (a: Waypoint, b: Waypoint) => {
    const dir = headingXZ(a, b);
    carriedDir = dir;
    raw.push({ aA: a, aB: b, dir, kind: "transit", durationSec: dist3(a, b) / speed });
  };
  for (let i = 0; i < stops.length; i++) {
    const b = stops[(i + 1) % stops.length];

    const arcPts = sampleHopPoints(rng, tour, stops, i);
    for (let s = 0; s < arcPts.length - 1; s++) pushTransit(arcPts[s], arcPts[s + 1]);

    const skipHover = rng() < HOVER_SKIP_PROB;
    if (!skipHover) {
      const orbitPts = buildOrbitPoints(rng, b);
      for (let s = 0; s < orbitPts.length - 1; s++) pushTransit(orbitPts[s], orbitPts[s + 1]);
    }
    const hoverDur = skipHover
      ? 0
      : HOVER_DURATION_MIN_SEC + rng() * (HOVER_DURATION_MAX_SEC - HOVER_DURATION_MIN_SEC);
    if (hoverDur > 0) {
      raw.push({ aA: b, aB: b, dir: carriedDir, kind: "hover", durationSec: hoverDur });
    }
  }

  const cycleSec = raw.reduce((sum, l) => sum + l.durationSec, 0);
  let cum = 0;
  const legs: HeliLeg[] = raw.map((l) => {
    const winStart = cum / cycleSec;
    cum += l.durationSec;
    return {
      aA: [l.aA.x, l.aA.y, l.aA.z],
      aB: [l.aB.x, l.aB.y, l.aB.z],
      dir: l.dir,
      kind: l.kind,
      winStart,
      winEnd: cum / cycleSec,
    };
  });
  // The final leg's window must end at EXACTLY 1.0 — the shader's ambient
  // fract() wrap and the debug one-shot's clamp both key off that boundary
  // (lib/shaders/helicopters.ts). Provably exact here (cum's last increment
  // sums to cycleSec by construction, and x/x is exactly 1.0 in IEEE754), but
  // pinned explicitly so a future refactor of the accumulation can't quietly
  // drift it.
  if (legs.length > 0) legs[legs.length - 1].winEnd = 1;

  return { legs, cycleSec, phase: rng() };
}

export function buildHelicopters(
  masterSeed: string,
  shape: CityShapeSetting = "square",
  shapeScale = 1,
): HelicoptersData {
  const rng = seedrandom(`${masterSeed}::helicopters`);
  const { buildings } = generateCity(masterSeed, shape, shapeScale);
  const { roofs, offmap } = buildWaypointPools(rng, buildings);
  const centralPool = nearestToCenter(roofs, CENTRAL_POOL_SIZE);
  const centralPoolUsable = centralPool.length >= 2;

  const count = AMBIENT_HELI_POOL;

  // Off-map fringe pads: rare by design (#89). One seeded roll per city
  // decides whether ANY helicopter may touch them at all; if it hits, a
  // second seeded pick names the ONE helicopter that gets them merged into
  // its pool. Every other helicopter's stops come only from in-city roofs.
  const offmapHeliIndex =
    offmap.length > 0 && rng() < OFFMAP_USE_PROB ? Math.floor(rng() * count) : -1;

  const helicopters: Helicopter[] = [];
  for (let i = 0; i < count; i++) {
    // First couple of helicopters favour the pads nearest CITY_CENTER so the
    // default camera always has patrol traffic over downtown (#89); the rest
    // draw from the full rooftop pool for city-wide spread.
    const basePool = i < CENTRAL_HELI_COUNT && centralPoolUsable ? centralPool : roofs;
    let stopPool = i === offmapHeliIndex ? [...basePool, ...offmap] : basePool;
    // Safety net (unchanged invariant, see file header): a loop needs >=2
    // distinct stops, so a city with fewer than 2 qualifying rooftops falls
    // back to the off-map pair regardless of the roll above.
    if (stopPool.length < 2) stopPool = [...roofs, ...offmap];
    helicopters.push(buildHelicopter(rng, stopPool));
  }

  return { helicopters };
}
