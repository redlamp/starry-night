import seedrandom from "seedrandom";
import type { Topology } from "./topology";
import type { DistrictField } from "./district";
import { isHighRise } from "./silhouette";

// Arterials — the second road tier. The spine is a set of radial spokes that
// run from the dense downtown core out to the city edge (long, city-spanning),
// plus a few cluster-to-cluster connectors. Buildings skip the arterial
// corridor, so arterials read as avenues cutting across the grid.

export type Arterial = {
  id: string;
  vertices: Array<{ x: number; z: number }>;
  width: number;
  closed: false;
};

const ARTERIAL_WIDTH = 14;

// Grid-first rework — Stage 1. Under the flag, arterials are the HEAVY LINES of
// the grid: straight lines in the θ0 frame at a uniform spacing, spanning the
// city bbox in both axis directions. Spacing is the largest tunable here.
// Local block+street pitch runs ~60-100m, so 190m places an arterial roughly
// every 2nd-3rd local street and sits in the decision note's 160-220m band.
// (Promoted seam runs are Stage 3 — not generated here.)
const GRID_ARTERIAL_SPACING = 190;

// Distance from a point along a direction until it hits the city bbox edge.
function reachToEdge(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  cx: number,
  cz: number,
  half: number,
): number {
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (cx + half - ox) / dx);
  else if (dx < -1e-6) t = Math.min(t, (cx - half - ox) / dx);
  if (dz > 1e-6) t = Math.min(t, (cz + half - oz) / dz);
  else if (dz < -1e-6) t = Math.min(t, (cz - half - oz) / dz);
  return Number.isFinite(t) ? Math.max(0, t) : half;
}

export function generateArterials(
  masterSeed: string,
  topo: Topology,
  field: DistrictField,
  useGrid: boolean = false,
  theta0: number = 0,
): Arterial[] {
  const rng = seedrandom(`${masterSeed}::arterials`);
  const districts = field.districts;
  if (districts.length < 2) return [];

  const cx = topo.centerX;
  const cz = topo.centerZ;
  const half = topo.halfExtent;

  // Grid-first: arterials = heavy grid lines in the θ0 frame. Lines run parallel
  // to each frame axis at a uniform spacing, spanning the bbox in both
  // directions, then transform to world space. Continuity is guaranteed because
  // every arterial is a straight lattice-aligned line.
  if (useGrid) {
    const cos = Math.cos(theta0);
    const sin = Math.sin(theta0);
    // Frame→world for a point (u, v) measured from CITY_CENTER along the θ0 axes.
    const toWorld = (u: number, v: number) => ({
      x: cx + u * cos - v * sin,
      z: cz + u * sin + v * cos,
    });
    // The rotated bbox fits inside a frame-aligned square of half-side √2·half;
    // run lines across that span so they fully cross the city at any rotation.
    const reach = half * Math.SQRT2;
    const gridArterials: Arterial[] = [];
    let gid = 0;
    // Lines of constant v (running along the +u axis) and constant u (running
    // along the +v axis): the two families of the heavy grid.
    const maxIndex = Math.floor(reach / GRID_ARTERIAL_SPACING);
    for (let k = -maxIndex; k <= maxIndex; k++) {
      const offset = k * GRID_ARTERIAL_SPACING;
      const a = toWorld(-reach, offset);
      const b = toWorld(reach, offset);
      gridArterials.push({
        id: `arterial-${gid++}`,
        width: ARTERIAL_WIDTH,
        closed: false,
        vertices: [
          { x: a.x, z: a.z },
          { x: b.x, z: b.z },
        ],
      });
    }
    for (let k = -maxIndex; k <= maxIndex; k++) {
      const offset = k * GRID_ARTERIAL_SPACING;
      const a = toWorld(offset, -reach);
      const b = toWorld(offset, reach);
      gridArterials.push({
        id: `arterial-${gid++}`,
        width: ARTERIAL_WIDTH,
        closed: false,
        vertices: [
          { x: a.x, z: a.z },
          { x: b.x, z: b.z },
        ],
      });
    }
    return gridArterials;
  }

  const peaks = districts.filter((d) => isHighRise(d.character));
  const byCentral = [...districts].sort(
    (a, b) =>
      Math.hypot(a.centroidX - cx, a.centroidZ - cz) -
      Math.hypot(b.centroidX - cx, b.centroidZ - cz),
  );
  const anchors = peaks.length > 0 ? peaks : [byCentral[0]];
  const core = byCentral[0]; // most-central district = the downtown core

  const arterials: Arterial[] = [];
  let id = 0;
  const push = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const mx = (a.x + b.x) / 2 + (rng() - 0.5) * len * 0.1;
    const mz = (a.z + b.z) / 2 + (rng() - 0.5) * len * 0.1;
    arterials.push({
      id: `arterial-${id++}`,
      width: ARTERIAL_WIDTH,
      closed: false,
      vertices: [
        { x: a.x, z: a.z },
        { x: mx, z: mz },
        { x: b.x, z: b.z },
      ],
    });
  };

  // 1. Radial spokes from the core out to the city edge — the long spanning
  //    avenues that radiate from downtown.
  const spokeCount = 6 + Math.floor(rng() * 3); // 6..8
  const startAngle = rng() * Math.PI * 2;
  for (let i = 0; i < spokeCount; i++) {
    const theta = startAngle + i * ((Math.PI * 2) / spokeCount) + (rng() - 0.5) * 0.35;
    const dx = Math.cos(theta);
    const dz = Math.sin(theta);
    const reach = reachToEdge(core.centroidX, core.centroidZ, dx, dz, cx, cz, half);
    push(
      { x: core.centroidX, z: core.centroidZ },
      { x: core.centroidX + dx * reach * 0.96, z: core.centroidZ + dz * reach * 0.96 },
    );
  }

  // 2. A few cluster-to-cluster connectors so high-rise nodes link to each other.
  const links: Array<[number, number, number]> = []; // [i, j, len]
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const len = Math.hypot(
        anchors[i].centroidX - anchors[j].centroidX,
        anchors[i].centroidZ - anchors[j].centroidZ,
      );
      links.push([i, j, len]);
    }
  }
  links.sort((a, b) => a[2] - b[2]);
  for (const [i, j] of links.slice(0, 4)) {
    push(
      { x: anchors[i].centroidX, z: anchors[i].centroidZ },
      { x: anchors[j].centroidX, z: anchors[j].centroidZ },
    );
  }

  return arterials;
}
