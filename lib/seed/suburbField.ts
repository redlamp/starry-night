import seedrandom from "seedrandom";
import { CITY_CENTER, maxHalfExtent } from "./topology";
import { suburbAmount, CORE_T, SUBURB_T, RURAL_T, type RadialDensity } from "./density";

// Population nodes for the suburban band (#49 rebuild — see
// wiki/notes/plan-suburb-node-fields.md). The diagnosis of three rejected
// suburb mechanisms: they all kept the global lattice topology. Real suburban
// fabric is organised around LOCAL CENTRES — neighbourhood/village nodes —
// each a pod of concentric crescents with its own entries, linked by
// tangential connectors, with the grid suppressed except arterial spokes.
//
// This module is the foundation layer (Stage 1): deterministic node sampling
// + the node-proximity field. Stage 2 gives each node a local radial tensor
// basis (rings = crescents, spokes = entries) and traces pod streets against
// it; Stage 3 adds node-graph connectors; Stage 4 clusters building/lamp
// density by proximity (development hugs the nodes, inter-pod land goes dark).
//
// Determinism: one dedicated stream (`::suburb::nodes`), drawn in a fixed
// row-major cell-scan order — 3 draws per cell always, +3 more only for
// accepted nodes. Acceptance is itself a pure function of the seed, so the
// node list is fully reproducible from (seed, extent) on either side of the
// worker boundary — nothing needs transferring.

export type SuburbNode = {
  x: number;
  z: number;
  // Pod radius (m) — half the local node spacing, the footprint streets and
  // development organise within.
  r: number;
  // Elliptical squash for Stage 2's basis (real pods aren't perfect circles):
  // minor/major axis ratio + major-axis bearing.
  squash: number;
  angle: number;
  // Local density at the node centre — drives pod street grain + Stage 4 keep.
  density: number;
};

// Scan-cell edge (m). Must stay comfortably under the minimum node spacing /√2
// so dense-suburban placement isn't under-sampled by the grid scan.
const SCAN_CELL = 300;

// Node spacing by local density — Perry's neighbourhood unit is ~800 m across;
// dense suburbs pack pods tighter, rural hamlets sit far apart.
const SPACING_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 1250],
  [RURAL_T, 1000],
  [SUBURB_T, 620],
  [0.5, 480],
  [CORE_T, 440],
];

function spacingFor(density: number): number {
  if (density <= SPACING_ANCHORS[0][0]) return SPACING_ANCHORS[0][1];
  for (let i = 1; i < SPACING_ANCHORS.length; i++) {
    const [d1, v1] = SPACING_ANCHORS[i];
    if (density <= d1) {
      const [d0, v0] = SPACING_ANCHORS[i - 1];
      return v0 + ((density - d0) / (d1 - d0)) * (v1 - v0);
    }
  }
  return SPACING_ANCHORS[SPACING_ANCHORS.length - 1][1];
}

export function sampleSuburbNodes(masterSeed: string, radial: RadialDensity): SuburbNode[] {
  const rng = seedrandom(`${masterSeed}::suburb::nodes`);
  const half = maxHalfExtent();
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;
  const cells = Math.ceil((2 * half) / SCAN_CELL);

  const nodes: SuburbNode[] = [];
  // Accepted-node spatial index for the min-distance test (cell ≥ max spacing).
  const occ = new Map<number, SuburbNode[]>();
  const occCell = 1280;
  const occKey = (x: number, z: number) =>
    (Math.floor(x / occCell) + 2048) * 4096 + (Math.floor(z / occCell) + 2048);

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      // Fixed 3 draws per cell, accepted or not, so the stream never shifts
      // when the acceptance rules are tuned.
      const jx = rng();
      const jz = rng();
      const roll = rng();
      const x = cx - half + (i + jx) * SCAN_CELL;
      const z = cz - half + (j + jz) * SCAN_CELL;
      const d = radial.at(x, z);
      const sub = suburbAmount(d);
      // Band: past the core edge (sub ≥ 0.12) but not deep fringe (d > 0.10) —
      // rural keeps sparse hamlet nodes, true fringe none.
      if (sub < 0.12 || d <= 0.1) continue;
      if (roll >= 0.92) continue; // a little seeded raggedness in coverage
      const spacing = spacingFor(d);
      // Poisson-disc test against accepted nodes.
      const ci = Math.floor(x / occCell);
      const cj = Math.floor(z / occCell);
      let blocked = false;
      for (let a = ci - 1; a <= ci + 1 && !blocked; a++) {
        for (let b = cj - 1; b <= cj + 1 && !blocked; b++) {
          const list = occ.get((a + 2048) * 4096 + (b + 2048));
          if (!list) continue;
          for (const n of list) {
            // Symmetric spacing: respect the LARGER of the two pods' needs.
            const need = Math.max(spacing, spacingFor(n.density));
            const dx = n.x - x;
            const dz = n.z - z;
            if (dx * dx + dz * dz < need * need) {
              blocked = true;
              break;
            }
          }
        }
      }
      if (blocked) continue;
      const node: SuburbNode = {
        x,
        z,
        r: spacing * 0.5,
        squash: 0.72 + rng() * 0.28,
        angle: rng() * Math.PI,
        density: d,
      };
      void rng(); // reserved (Stage 2 per-pod grain) — keeps later stages additive
      nodes.push(node);
      const k = occKey(x, z);
      const list = occ.get(k);
      if (list) list.push(node);
      else occ.set(k, [node]);
    }
  }
  return nodes;
}

// Node-proximity field: 1 at pod centres falling to ~0 in the inter-pod gaps.
// Stage 4 multiplies this into the development keep-probability so building/
// lamp density CLUSTERS around the nodes (the current uniform hash dropout
// reads arbitrary). Same Gaussian falloff family as the tensor bases.
export function nodeProximity(nodes: SuburbNode[]): (x: number, z: number) => number {
  // Spatial index: pods are ≤ ~640 m radius; 3×3 cells of 1280 m cover 3σ.
  const cell = 1280;
  const grid = new Map<number, SuburbNode[]>();
  for (const n of nodes) {
    const k = (Math.floor(n.x / cell) + 2048) * 4096 + (Math.floor(n.z / cell) + 2048);
    const list = grid.get(k);
    if (list) list.push(n);
    else grid.set(k, [n]);
  }
  return (x: number, z: number): number => {
    const ci = Math.floor(x / cell);
    const cj = Math.floor(z / cell);
    let p = 0;
    for (let a = ci - 1; a <= ci + 1; a++) {
      for (let b = cj - 1; b <= cj + 1; b++) {
        const list = grid.get((a + 2048) * 4096 + (b + 2048));
        if (!list) continue;
        for (const n of list) {
          const sigma = n.r * 0.75;
          const dx = x - n.x;
          const dz = z - n.z;
          p += Math.exp(-(dx * dx + dz * dz) / (sigma * sigma));
        }
      }
    }
    return Math.min(1, p);
  };
}
