import seedrandom from "seedrandom";
import { CITY_CENTER, CITY_HALF_EXTENT } from "./topology";
import type { DistrictCharacter, DistrictField } from "./district";

// Streets-first — the STREET GRAPH. Single geometry authority: blocks are its
// cells, lots subdivide those cells, buildings sit on the lots.
//
// INTERIM design (axis-aligned rectangular grid), pending the tensor-field
// replacement. Key properties the user asked for:
//   - Streets are CONTINUOUS, edge-to-edge lines that cross the arterials (no
//     more isolated "+" inside each super-cell). Every street is one full line.
//   - Blocks are RECTANGLES (X pitch ≠ Z pitch), not squares.
//   - Grid is AXIS-ALIGNED (θ0 = 0, up/down/left/right), no random rotation.
// Arterials are simply every Nth grid line promoted to a wider road, so they sit
// ON the grid and the minor streets run straight through them.
//
// Per-region density (downtown dense, industrial sparse) is no longer carried by
// street spacing (that broke continuity) — it now lives in the character overlay
// driving lot subdivision + occupancy + height. The grid itself is uniform.
//
// Pure + deterministic: jitter draws come from `${seed}::streets`, lines emit in
// fixed index order → byte-stable per seed. (theta0 is kept as a parameter so the
// upcoming tensor-field generator can vary orientation; the grid passes 0.)

export type RoadTier = "arterial" | "minor";

export type RoadPoly = {
  id: string;
  vertices: Array<{ x: number; z: number }>;
  width: number;
  closed: false;
  tier: RoadTier;
};

// A block: one cell of the grid, as a rectangle in the θ0 frame plus its world
// centroid + sampled character. Edge flags say which sides abut an arterial.
export type GridCell = {
  id: string;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  cx: number;
  cz: number;
  districtIndex: number;
  character: DistrictCharacter;
  artU0: boolean;
  artU1: boolean;
  artV0: boolean;
  artV1: boolean;
};

export type StreetGrid = {
  theta0: number;
  cells: GridCell[];
  arterials: RoadPoly[];
  streets: RoadPoly[];
};

// Rectangular block pitch (m): short frontage axis vs long axis ≈ 1:2, the
// classic elongated city block (Manhattan ≈ 80×270, downtown ≈ 80×170). Arterials
// = every Nth line, so arterial spacing ≈ pitch×N (≈250m / ≈340m here).
const X_PITCH = 84;
const Z_PITCH = 168;
const ART_EVERY_X = 3;
const ART_EVERY_Z = 2;
const ARTERIAL_WIDTH = 16;
const MINOR_WIDTH = 9;
const LINE_JITTER = 0.1; // ±10% of pitch, shared by both adjacent cells (tiling stays exact)

// Clip a world-space segment to the axis-aligned city bbox (Liang–Barsky).
function clipToBBox(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): [{ x: number; z: number }, { x: number; z: number }] | null {
  const dx = x1 - x0;
  const dz = z1 - z0;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - minX, maxX - x0, z0 - minZ, maxZ - z0];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    { x: x0 + t0 * dx, z: z0 + t0 * dz },
    { x: x0 + t1 * dx, z: z0 + t1 * dz },
  ];
}

type GridLine = { pos: number; arterial: boolean };

export function generateStreetGrid(
  masterSeed: string,
  field: DistrictField,
  theta0: number,
): StreetGrid {
  const rng = seedrandom(`${masterSeed}::streets`);
  const cos = Math.cos(theta0);
  const sin = Math.sin(theta0);
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;
  const half = CITY_HALF_EXTENT;
  const { minX, maxX, minZ, maxZ } = field.bounds;

  const toWorld = (u: number, v: number) => ({
    x: cx + u * cos - v * sin,
    z: cz + u * sin + v * cos,
  });
  const R = half * Math.SQRT2;

  // One family of parallel grid lines: positions at k·pitch (+ shared jitter),
  // every Nth promoted to an arterial. Sorted (jitter < pitch/2 never reorders).
  const buildLines = (pitch: number, artEvery: number): GridLine[] => {
    const n = Math.ceil(R / pitch);
    const out: GridLine[] = [];
    for (let k = -n; k <= n; k++) {
      const jit = (rng() - 0.5) * pitch * LINE_JITTER;
      out.push({ pos: k * pitch + jit, arterial: ((k % artEvery) + artEvery) % artEvery === 0 });
    }
    return out;
  };
  const uLines = buildLines(X_PITCH, ART_EVERY_X);
  const vLines = buildLines(Z_PITCH, ART_EVERY_Z);

  const cells: GridCell[] = [];
  const arterials: RoadPoly[] = [];
  const streets: RoadPoly[] = [];

  // Continuous lines — each runs the full span and is clipped to the bbox, so
  // minor streets cross straight through every arterial.
  let rid = 0;
  const emit = (a: { x: number; z: number }, b: { x: number; z: number }, arterial: boolean) => {
    const seg = clipToBBox(a.x, a.z, b.x, b.z, minX, maxX, minZ, maxZ);
    if (!seg) return;
    (arterial ? arterials : streets).push({
      id: `${arterial ? "art" : "str"}-${rid++}`,
      vertices: seg,
      width: arterial ? ARTERIAL_WIDTH : MINOR_WIDTH,
      closed: false,
      tier: arterial ? "arterial" : "minor",
    });
  };
  for (const L of uLines) emit(toWorld(L.pos, -R), toWorld(L.pos, R), L.arterial);
  for (const L of vLines) emit(toWorld(-R, L.pos), toWorld(R, L.pos), L.arterial);

  // Blocks = cells between adjacent lines. Kept only if the centroid is in-city.
  for (let i = 0; i < uLines.length - 1; i++) {
    for (let j = 0; j < vLines.length - 1; j++) {
      const u0 = uLines[i].pos;
      const u1 = uLines[i + 1].pos;
      const v0 = vLines[j].pos;
      const v1 = vLines[j + 1].pos;
      const c = toWorld((u0 + u1) / 2, (v0 + v1) / 2);
      const idx = field.classify(c.x, c.z);
      if (idx < 0) continue;
      cells.push({
        id: `cell-${i}_${j}`,
        u0,
        v0,
        u1,
        v1,
        cx: c.x,
        cz: c.z,
        districtIndex: idx,
        character: field.districts[idx]?.character ?? "residential",
        artU0: uLines[i].arterial,
        artU1: uLines[i + 1].arterial,
        artV0: vLines[j].arterial,
        artV1: vLines[j + 1].arterial,
      });
    }
  }

  return { theta0, cells, arterials, streets };
}

export const STREET_CONSTANTS = { ARTERIAL_WIDTH, MINOR_WIDTH };
