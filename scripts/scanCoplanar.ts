/**
 * Zero-tolerance building overlap + coplanar-flush scan.
 *
 *   bun scripts/scanCoplanar.ts <seed> [seed2 ...]
 *
 * gate1 asserts overlaps with a 0.3m penetration tolerance — this scan hunts
 * the blind window it leaves: (a) pairs with ANY positive penetration, and
 * (b) pairs whose wall planes are near-coplanar (< 2cm) with overlapping
 * footprint extents along that plane — the z-fighting configuration ("two
 * windows drawn over each other", 2026-07-02).
 */
import { generateCity, type Building } from "@/lib/seed/cityGen";
import { setCityTier } from "@/lib/seed/topology";

setCityTier(6);

type Vec = { x: number; z: number };

function corners(b: Building): Vec[] {
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  const hw = b.width / 2;
  const hd = b.depth / 2;
  return [
    { x: b.x + (c * hw - s * hd), z: b.z + (s * hw + c * hd) },
    { x: b.x + (c * hw + s * hd), z: b.z + (s * hw - c * hd) },
    { x: b.x + (-c * hw + s * hd), z: b.z + (-s * hw - c * hd) },
    { x: b.x + (-c * hw - s * hd), z: b.z + (-s * hw + c * hd) },
  ];
}

function project(pts: Vec[], ax: number, az: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const d = p.x * ax + p.z * az;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

// SAT penetration: > 0 means the footprints interpenetrate by that many metres.
function penetration(a: Building, b: Building): number {
  const axes: Vec[] = [
    { x: Math.cos(a.rotationY), z: Math.sin(a.rotationY) },
    { x: -Math.sin(a.rotationY), z: Math.cos(a.rotationY) },
    { x: Math.cos(b.rotationY), z: Math.sin(b.rotationY) },
    { x: -Math.sin(b.rotationY), z: Math.cos(b.rotationY) },
  ];
  const ca = corners(a);
  const cb = corners(b);
  let minPen = Infinity;
  for (const ax of axes) {
    const [amin, amax] = project(ca, ax.x, ax.z);
    const [bmin, bmax] = project(cb, ax.x, ax.z);
    const pen = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (pen < minPen) minPen = pen;
  }
  return minPen;
}

// Near-coplanar flush walls: one of a's wall planes within `eps` of one of
// b's parallel wall planes, rotations aligned within `angEps`, and the two
// walls' extents overlapping along the shared plane. Only meaningful when the
// pair is also CLOSE face-to-face (they must overlap on screen to fight).
function coplanarFlush(a: Building, b: Building, eps = 0.02, angEps = 0.002): string | null {
  const da = ((a.rotationY - b.rotationY) % (Math.PI / 2)) + 0;
  const wrapped = Math.min(Math.abs(da), Math.abs(Math.abs(da) - Math.PI / 2));
  if (wrapped > angEps) return null; // walls not parallel — z-fight needs parallel planes
  // For each of a's 2 axis directions, wall planes sit at ±half-extent along
  // that axis. Compare against b's planes along the same (parallel) axis.
  const axes: Array<{ ax: number; az: number; ha: number; hb: number }> = [
    {
      ax: Math.cos(a.rotationY),
      az: Math.sin(a.rotationY),
      ha: a.width / 2,
      hb: 0,
    },
    {
      ax: -Math.sin(a.rotationY),
      az: Math.cos(a.rotationY),
      ha: a.depth / 2,
      hb: 0,
    },
  ];
  for (const axis of axes) {
    // b's half-extent along this axis: pick width/depth by whichever of b's
    // axes is parallel to this one.
    const bAlong =
      Math.abs(Math.cos(b.rotationY) * axis.ax + Math.sin(b.rotationY) * axis.az) > 0.999
        ? b.width / 2
        : b.depth / 2;
    const pa = a.x * axis.ax + a.z * axis.az;
    const pb = b.x * axis.ax + b.z * axis.az;
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const planeA = pa + sa * axis.ha;
        const planeB = pb + sb * bAlong;
        if (Math.abs(planeA - planeB) < eps) {
          // Same plane — do the walls overlap along the perpendicular axis?
          const px = -axis.az;
          const pz = axis.ax;
          const [amin, amax] = project(corners(a), px, pz);
          const [bmin, bmax] = project(corners(b), px, pz);
          const lap = Math.min(amax, bmax) - Math.max(amin, bmin);
          if (lap > 0.5) {
            return `plane Δ${((planeA - planeB) * 1000).toFixed(1)}mm, lateral overlap ${lap.toFixed(1)}m`;
          }
        }
      }
    }
  }
  return null;
}

for (const seed of process.argv.slice(2).length ? process.argv.slice(2) : ["starry-night"]) {
  const city = generateCity(seed);
  const bs = city.buildings;
  // Spatial hash so the pair scan stays near-linear.
  const CELL = 70;
  const grid = new Map<string, number[]>();
  bs.forEach((b, i) => {
    const k = `${Math.floor(b.x / CELL)},${Math.floor(b.z / CELL)}`;
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  });
  let pen = 0;
  let flush = 0;
  const samples: string[] = [];
  bs.forEach((a, i) => {
    const ci = Math.floor(a.x / CELL);
    const cj = Math.floor(a.z / CELL);
    for (let gx = ci - 1; gx <= ci + 1; gx++) {
      for (let gz = cj - 1; gz <= cj + 1; gz++) {
        for (const j of grid.get(`${gx},${gz}`) ?? []) {
          if (j <= i) continue;
          const b = bs[j];
          const p = penetration(a, b);
          if (p > 0.001) {
            pen++;
            if (samples.length < 12)
              samples.push(
                `PENETRATE ${p.toFixed(3)}m: #${a.id}(${a.archetype} @${a.x.toFixed(0)},${a.z.toFixed(0)} rot${a.rotationY.toFixed(3)}) × #${b.id}(${b.archetype} @${b.x.toFixed(0)},${b.z.toFixed(0)} rot${b.rotationY.toFixed(3)})`,
              );
          } else if (p > -0.05) {
            const f = coplanarFlush(a, b);
            if (f) {
              flush++;
              if (samples.length < 12)
                samples.push(
                  `FLUSH ${f}: #${a.id}(@${a.x.toFixed(0)},${a.z.toFixed(0)}) × #${b.id}(@${b.x.toFixed(0)},${b.z.toFixed(0)})`,
                );
            }
          }
        }
      }
    }
  });
  console.log(
    `${seed}: ${bs.length} buildings — penetrating pairs: ${pen}, coplanar-flush pairs: ${flush}`,
  );
  for (const s of samples) console.log("  " + s);
}
