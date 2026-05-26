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
): Arterial[] {
  const rng = seedrandom(`${masterSeed}::arterials`);
  const districts = field.districts;
  if (districts.length < 2) return [];

  const cx = topo.centerX;
  const cz = topo.centerZ;
  const half = topo.halfExtent;

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
