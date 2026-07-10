import type { DistrictField } from "./district";

// District boundary tracing at the label raster's NATIVE resolution (~7.5m
// cells) — the fix for the blocky 80×80 overlay outlines (user 2026-07-10).
// Districts are arterial-bounded by construction (see district.ts), so a
// boundary traced this fine follows the bounding streets' curves; the
// Douglas-Peucker pass then strips the raster staircase.
//
// Pure function of the DistrictField → deterministic; cached per field
// instance (a re-rolled/re-tiered city is a new field object).

export type BoundaryLoop = Array<{ x: number; z: number }>;

// World-space simplification tolerance. Slightly under one raster cell: big
// enough to erase the ~7.5m staircase, too small to cut street-scale curves.
const SIMPLIFY_TOLERANCE_FRACTION = 0.9;

const loopCache = new WeakMap<DistrictField, Map<number, BoundaryLoop[]>>();

// All closed boundary loops for one district index. Outer loops come out
// counter-clockwise (positive signed area in x/z), holes clockwise — callers
// building fills can split them by the sign of loopSignedArea().
export function districtBoundaryLoops(field: DistrictField, index: number): BoundaryLoop[] {
  let perDistrict = loopCache.get(field);
  if (!perDistrict) {
    perDistrict = new Map();
    loopCache.set(field, perDistrict);
  }
  const hit = perDistrict.get(index);
  if (hit) return hit;
  const loops = traceLoops(field, index);
  perDistrict.set(index, loops);
  return loops;
}

export function loopSignedArea(loop: BoundaryLoop): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

function traceLoops(field: DistrictField, index: number): BoundaryLoop[] {
  const { label, n, step } = field.raster;
  const { minX, minZ } = field.bounds;
  const inside = (gx: number, gz: number) =>
    gx >= 0 && gz >= 0 && gx < n && gz < n && label[gx * n + gz] === index;

  // Directed boundary edges on the grid-vertex lattice, oriented so the
  // district is always on the LEFT (counter-clockwise in x/z). Around a single
  // cell that's bottom +x, right +z, top −x, left −z — head to tail, so a
  // union of cells chains into CCW outer loops and CW hole loops.
  // Vertex key = vx * (n + 1) + vz.
  type Edge = { from: number; to: number; used: boolean };
  const edges: Edge[] = [];
  const byStart = new Map<number, Edge[]>();
  const vkey = (vx: number, vz: number) => vx * (n + 1) + vz;
  const addEdge = (fx: number, fz: number, tx: number, tz: number) => {
    const e = { from: vkey(fx, fz), to: vkey(tx, tz), used: false };
    edges.push(e);
    const list = byStart.get(e.from) ?? [];
    list.push(e);
    byStart.set(e.from, list);
  };

  for (let gx = 0; gx < n; gx++) {
    for (let gz = 0; gz < n; gz++) {
      if (!inside(gx, gz)) continue;
      if (!inside(gx, gz - 1)) addEdge(gx, gz, gx + 1, gz); // bottom, +x
      if (!inside(gx + 1, gz)) addEdge(gx + 1, gz, gx + 1, gz + 1); // right, +z
      if (!inside(gx, gz + 1)) addEdge(gx + 1, gz + 1, gx, gz + 1); // top, −x
      if (!inside(gx - 1, gz)) addEdge(gx, gz + 1, gx, gz); // left, −z
    }
  }

  const vx = (key: number) => Math.floor(key / (n + 1));
  const vz = (key: number) => key % (n + 1);

  const loops: BoundaryLoop[] = [];
  for (const first of edges) {
    if (first.used) continue;
    const verts: number[] = [first.from];
    let cur = first;
    cur.used = true;
    // Follow head-to-tail; at pinch vertices (two arms of one district meeting
    // diagonally) two continuations exist — take the sharpest LEFT turn, which
    // keeps the district hugging the left side and the loops non-crossing.
    for (;;) {
      verts.push(cur.to);
      if (cur.to === first.from) break;
      const options = (byStart.get(cur.to) ?? []).filter((e) => !e.used);
      if (options.length === 0) break; // defensive — shouldn't happen on a closed lattice
      let next = options[0];
      if (options.length > 1) {
        const dx = vx(cur.to) - vx(cur.from);
        const dz = vz(cur.to) - vz(cur.from);
        let bestTurn = -Infinity;
        for (const e of options) {
          const ex = vx(e.to) - vx(e.from);
          const ez = vz(e.to) - vz(e.from);
          const turn = dx * ez - dz * ex; // cross > 0 = left turn
          if (turn > bestTurn) {
            bestTurn = turn;
            next = e;
          }
        }
      }
      next.used = true;
      cur = next;
    }
    // verts is closed (last === first); drop the duplicate tail.
    verts.pop();
    if (verts.length < 4) continue;
    const world: BoundaryLoop = verts.map((key) => ({
      x: minX + vx(key) * step,
      z: minZ + vz(key) * step,
    }));
    loops.push(simplifyClosed(world, step * SIMPLIFY_TOLERANCE_FRACTION));
  }
  return loops;
}

// Douglas-Peucker for a CLOSED loop: anchor on point 0 and the point farthest
// from it, simplify each half, and rejoin. Keeps loops closed without letting
// the arbitrary start vertex survive as a kink anchor on a straight run.
function simplifyClosed(loop: BoundaryLoop, tolerance: number): BoundaryLoop {
  if (loop.length <= 4) return loop;
  let far = 1;
  let farDist = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i].x - loop[0].x, loop[i].z - loop[0].z);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const half1 = simplifyOpen(loop.slice(0, far + 1), tolerance);
  const half2 = simplifyOpen([...loop.slice(far), loop[0]], tolerance);
  // Drop each half's duplicated join point.
  return [...half1.slice(0, -1), ...half2.slice(0, -1)];
}

function simplifyOpen(pts: BoundaryLoop, tolerance: number): BoundaryLoop {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ax = pts[a].x;
    const az = pts[a].z;
    const bx = pts[b].x;
    const bz = pts[b].z;
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let worst = -1;
    let worstDist = tolerance;
    for (let i = a + 1; i < b; i++) {
      let d: number;
      if (lenSq === 0) {
        d = Math.hypot(pts[i].x - ax, pts[i].z - az);
      } else {
        // Perpendicular distance to the segment's infinite line — fine here
        // since a and b always bracket i along the walk.
        d = Math.abs((pts[i].x - ax) * dz - (pts[i].z - az) * dx) / Math.sqrt(lenSq);
      }
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: BoundaryLoop = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
