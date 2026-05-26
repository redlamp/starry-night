import seedrandom from "seedrandom";
import type { Topology } from "./topology";
import type { DistrictField } from "./district";
import { isHighRise } from "./silhouette";

// Arterials — the second road tier. They radiate from the high-rise cluster
// centres: every other district is linked to its nearest cluster, and clusters
// are linked to each other. Buildings skip the arterial corridor, so arterials
// read as avenues cutting through the grid. 3-6 per seed (decision note).

export type Arterial = {
  id: string;
  vertices: Array<{ x: number; z: number }>;
  width: number;
  closed: false;
};

const ARTERIAL_WIDTH = 14;
const MAX_ARTERIALS = 6;
const MIN_ARTERIALS = 3;

export function generateArterials(
  masterSeed: string,
  topo: Topology,
  field: DistrictField,
): Arterial[] {
  const rng = seedrandom(`${masterSeed}::arterials`);
  const districts = field.districts;
  if (districts.length < 2) return [];

  const peaks = districts.filter((d) => isHighRise(d.character));
  // Fall back to the most central district if no high-rise exists.
  const anchors =
    peaks.length > 0
      ? peaks
      : [
          [...districts].sort(
            (a, b) =>
              Math.hypot(a.centroidX - topo.centerX, a.centroidZ - topo.centerZ) -
              Math.hypot(b.centroidX - topo.centerX, b.centroidZ - topo.centerZ),
          )[0],
        ];

  type Link = { ax: number; az: number; bx: number; bz: number; len: number; key: string };
  const links: Link[] = [];
  const addLink = (ax: number, az: number, bx: number, bz: number, aId: string, bId: string) => {
    const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    if (links.some((l) => l.key === key)) return;
    links.push({ ax, az, bx, bz, len: Math.hypot(bx - ax, bz - az), key });
  };

  // Cluster-to-cluster spines.
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      addLink(
        anchors[i].centroidX,
        anchors[i].centroidZ,
        anchors[j].centroidX,
        anchors[j].centroidZ,
        anchors[i].id,
        anchors[j].id,
      );
    }
  }

  // Each non-anchor district → its nearest anchor (a spoke into the core).
  for (const d of districts) {
    if (anchors.some((a) => a.id === d.id)) continue;
    let nearest = anchors[0];
    let bestD = Infinity;
    for (const a of anchors) {
      const dist = Math.hypot(a.centroidX - d.centroidX, a.centroidZ - d.centroidZ);
      if (dist < bestD) {
        bestD = dist;
        nearest = a;
      }
    }
    addLink(d.centroidX, d.centroidZ, nearest.centroidX, nearest.centroidZ, d.id, nearest.id);
  }

  // Keep the shortest links (cluster spines first), capped to MAX, floored to MIN.
  links.sort((a, b) => a.len - b.len);
  const keepCount = Math.max(MIN_ARTERIALS, Math.min(MAX_ARTERIALS, links.length));
  const kept = links.slice(0, keepCount);

  return kept.map((l, i) => {
    // Slight mid-point jog so arterials aren't perfectly straight.
    const mx = (l.ax + l.bx) / 2 + (rng() - 0.5) * l.len * 0.12;
    const mz = (l.az + l.bz) / 2 + (rng() - 0.5) * l.len * 0.12;
    return {
      id: `arterial-${i}`,
      width: ARTERIAL_WIDTH,
      closed: false as const,
      vertices: [
        { x: l.ax, z: l.az },
        { x: mx, z: mz },
        { x: l.bx, z: l.bz },
      ],
    };
  });
}
