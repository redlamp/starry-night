import seedrandom from "seedrandom";
import { generateTopology, CITY_CENTER, CITY_HALF_EXTENT, type Topology } from "./topology";

// The city lattice: base grid orientation θ0 + a center-anchored orientation
// field. Consumed by the tensor field (tensorField.ts) to orient the road grain.
// Pure function of the master seed.

// Default orientation drift from city centre to edge, in degrees.
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
  const rng = seedrandom(`${masterSeed}::grid`);
  // θ0 sits ~45° off the dominant highway tilt (+ small seeded jitter) so
  // highways read as cutting across the grid rather than running with it.
  const tilt = dominantHighwayTilt(generateTopology(masterSeed));
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
