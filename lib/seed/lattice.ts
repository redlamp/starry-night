import seedrandom from "seedrandom";
import { generateTopology, CITY_CENTER, CITY_HALF_EXTENT, type Topology } from "./topology";

// Grid-first rework — Stage 0 substrate. See wiki/notes/plan-grid-first-rework.md
// and wiki/notes/decision-grid-first-city-generation.md.
//
// Two responsibilities, both PURE functions of the master seed:
//   1. Flag transport — the rework ships behind a `::gridfirst` seed sentinel.
//   2. The city lattice — base grid orientation θ0 + a center-anchored
//      orientation field that later stages sample per district.

// CRITICAL (the trap all three judge panels flagged): every generator keys its
// RNG as seedrandom(`${seed}::...`). If the flag lived as a sentinel *inside*
// the seed used for those keys, every stream would shift and flag-ON would be a
// DIFFERENT city — silently invalidating the /plan A/B harness. So the sentinel
// is stripped to a clean base seed BEFORE any RNG key is derived; the flag is
// read separately from the raw string.
const GRIDFIRST_SENTINEL = "::gridfirst";
const TENSOR_SENTINEL = "::tensor";

export function stripGridFirst(rawSeed: string): string {
  if (rawSeed.endsWith(GRIDFIRST_SENTINEL)) return rawSeed.slice(0, -GRIDFIRST_SENTINEL.length);
  if (rawSeed.endsWith(TENSOR_SENTINEL)) return rawSeed.slice(0, -TENSOR_SENTINEL.length);
  return rawSeed;
}

export function gridFirst(rawSeed: string): boolean {
  return rawSeed.endsWith(GRIDFIRST_SENTINEL);
}

// Tensor-field road generator (the proper streets model). Separate sentinel from
// ::gridfirst so /plan + gate1 can A/B all three paths (legacy / grid / tensor).
export function tensorFirst(rawSeed: string): boolean {
  return rawSeed.endsWith(TENSOR_SENTINEL);
}

// Default orientation drift from city centre to edge, in degrees. Tunable knob
// (Stage 2 exposes it on /plan + registers it in settings); Stage 0 only needs
// the field to exist and be deterministic.
export const DEFAULT_DRIFT_DEG = 20;

export type Lattice = {
  // Base grid orientation at the city centre (radians).
  theta0: number;
  // Max orientation drift at the city edge (radians).
  driftMag: number;
  // Local grid orientation at a world point. Center-anchored: θ0 at the centre,
  // drifting smoothly outward so neighbouring districts differ only slightly.
  orientationAt: (x: number, z: number) => number;
};

// Direction of the dominant (longest) open highway, folded to [0, π). Ring-only
// topologies have no dominant tilt → 0.
function dominantHighwayTilt(topo: Topology): number {
  let bestLen = 0;
  let tilt = 0;
  for (const hw of topo.highways) {
    if (hw.closed) continue;
    const a = hw.vertices[0];
    const b = hw.vertices[hw.vertices.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > bestLen) {
      bestLen = len;
      let ang = Math.atan2(b.z - a.z, b.x - a.x);
      // A line's direction is invariant under ±π.
      if (ang < 0) ang += Math.PI;
      if (ang >= Math.PI) ang -= Math.PI;
      tilt = ang;
    }
  }
  return tilt;
}

export function computeLattice(masterSeed: string, driftDeg: number = DEFAULT_DRIFT_DEG): Lattice {
  const base = stripGridFirst(masterSeed);
  const rng = seedrandom(`${base}::grid`);
  // θ0 sits ~45° off the dominant highway tilt (+ small seeded jitter) so
  // highways read as cutting across the grid rather than running with it.
  const tilt = dominantHighwayTilt(generateTopology(base));
  const sign = rng() < 0.5 ? 1 : -1;
  const theta0 = tilt + (sign * Math.PI) / 4 + (rng() - 0.5) * (Math.PI / 12);
  const driftMag = (driftDeg * Math.PI) / 180;
  const driftSign = rng() < 0.5 ? 1 : -1;
  const { x: cx, z: cz } = CITY_CENTER;
  const half = CITY_HALF_EXTENT;
  const orientationAt = (x: number, z: number): number => {
    const t = Math.min(1, Math.hypot(x - cx, z - cz) / half);
    // Squared ramp: near-flat at the coherent core, more drift toward the edge.
    return theta0 + driftSign * driftMag * t * t;
  };
  return { theta0, driftMag, orientationAt };
}
