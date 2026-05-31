import seedrandom from "seedrandom";
import { generateCity } from "./cityGen";

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
  aColor: Float32Array; // n·3
  aSize: Float32Array; // n  — base point size (px, before attenuation)
};

type Vert = { x: number; z: number };

const HEADLIGHT: [number, number, number] = [1.0, 0.95, 0.82];
const TAILLIGHT: [number, number, number] = [1.0, 0.16, 0.1];
const CAR_Y = 1.4; // sit just above the road surface (road y ≈ 0.05)
const MAX_CARS = 5000; // hard cap — logged by the caller if exceeded
const MIN_SEG = 6; // drop a macro-segment shorter than this (m)
// Tensor road polylines are finely sampled (RK4 streamline steps ~2-4 m), so
// raw vertex pairs are far too short to slide a car along. Chunk each polyline
// into ~CHUNK-metre macro-segments (straight chords) and place cars on those —
// the gentle tensor curvature means a chord barely deviates from the road.
const CHUNK = 55;

type TierCfg = { carsPerM: number; speed: number; laneHalf: number; size: number };

function tierCfg(tier: "highway" | "arterial" | "minor"): TierCfg {
  switch (tier) {
    case "highway":
      return { carsPerM: 0.02, speed: 24, laneHalf: 5.0, size: 7 };
    case "arterial":
      return { carsPerM: 0.012, speed: 14, laneHalf: 3.6, size: 5.5 };
    default:
      return { carsPerM: 0.005, speed: 8, laneHalf: 2.6, size: 4 }; // minor streets
  }
}

export function buildTraffic(masterSeed: string, density = 1): TrafficData {
  const rng = seedrandom(`${masterSeed}::traffic`);
  const city = generateCity(masterSeed);

  type Seg = { ax: number; az: number; bx: number; bz: number; len: number; cfg: TierCfg };
  const segs: Seg[] = [];
  const collect = (verts: Vert[], tier: "highway" | "arterial" | "minor") => {
    const cfg = tierCfg(tier);
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
        if (len >= MIN_SEG) segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, len, cfg });
        startIdx = i;
        accum = 0;
      }
    }
  };
  for (const h of city.topology.highways) collect(h.vertices, "highway");
  for (const a of city.arterials) collect(a.vertices, "arterial");
  for (const s of city.streets) collect(s.vertices, "minor");

  // First pass: count cars (proportional to segment length × tier density), so
  // the typed arrays are sized exactly. Fractional expectation resolves via rng.
  const perSeg: number[] = [];
  let total = 0;
  for (const s of segs) {
    const expected = s.len * s.cfg.carsPerM * density;
    let n = Math.floor(expected);
    if (rng() < expected - n) n += 1;
    if (total + n > MAX_CARS) n = Math.max(0, MAX_CARS - total);
    perSeg.push(n);
    total += n;
  }

  const aA = new Float32Array(total * 3);
  const aB = new Float32Array(total * 3);
  const aPhase = new Float32Array(total);
  const aSpeed = new Float32Array(total);
  const aColor = new Float32Array(total * 3);
  const aSize = new Float32Array(total);

  let c = 0;
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
      const off = s.cfg.laneHalf * dir;
      // Travel start/end oriented by direction; both lanes offset to opposite sides.
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
      const col = dir > 0 ? HEADLIGHT : TAILLIGHT;
      aColor[c * 3 + 0] = col[0];
      aColor[c * 3 + 1] = col[1];
      aColor[c * 3 + 2] = col[2];
      aSize[c] = s.cfg.size * (0.85 + rng() * 0.3);
      c += 1;
    }
  }

  return { count: total, aA, aB, aPhase, aSpeed, aColor, aSize };
}
