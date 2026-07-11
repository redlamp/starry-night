import type { DistrictField } from "./district";

// District boundary tracing at the label raster's NATIVE resolution (~7.5m
// cells) — the fix for the blocky 80×80 overlay outlines (user 2026-07-10).
// Districts are arterial-bounded by construction (see district.ts), so a
// boundary traced this fine follows the bounding streets' curves; the
// Douglas-Peucker pass then strips the raster staircase.
//
// Option 2 (2026-07-10): after tracing, boundary vertices SNAP onto the wall
// roads' centrelines (the highways + arterials cityGen flood-filled the
// districts against), so borders lie exactly ON the streets that bound them
// and two districts sharing a street share the same collinear seam. Vertices
// with no wall in range (map edge, merged-sliver interiors) keep their traced
// position.
//
// Pure function of (DistrictField, walls) → deterministic; cached per field
// instance (a re-rolled/re-tiered city is a new field object, and the walls
// derive from the same seed, so field identity still keys correctly).

export type BoundaryLoop = Array<{ x: number; z: number }>;

// Same structural shape cityGen passes to generateDistrictsFromNetwork as
// walls (highways + arterials, UNCLIPPED — see cityGen.tensorWallRoads).
export type WallRoad = {
  vertices: Array<{ x: number; z: number }>;
  width: number;
  closed: boolean;
};

// World-space simplification tolerance for the PRE-snap pass. Slightly under
// one raster cell: big enough to erase the ~7.5m staircase, too small to cut
// street-scale curves (those survive as multi-segment chains for the snap).
const SIMPLIFY_TOLERANCE_FRACTION = 0.9;
// Vertex spacing (m) the pre-snap loop is densified to, so curvy streets are
// followed between DP anchors instead of being chord-cut.
const DENSIFY_SPACING = 15;
// Max snap distance as a multiple of the raster step (~2.5 × 7.5m ≈ 19m).
// The flood-fill already puts boundaries on the arterial medians, so the wall
// centreline is always well inside this; anything farther is a genuine
// no-wall stretch and keeps its traced position.
const SNAP_RADIUS_FACTOR = 2.5;
// Spatial-hash cell (m) for the wall-segment grid. Must stay ≥ the snap
// radius so a 3×3 cell query covers the whole search disc.
const SNAP_CELL = 60;
// Consecutive snapped points closer than this (m) collapse to one.
const MIN_VERTEX_SPACING = 1;
// cos of the in/out direction angle past which a vertex counts as a snap
// fold-back (≈149° turn — an out-and-back spike, not a street corner).
const FOLDBACK_DOT = -0.86;
// Post-snap Douglas-Peucker tolerance (m): collapses straight street runs
// without visibly leaving the centreline.
const FINAL_SIMPLIFY_TOLERANCE = 3;
const REPAIR_MAX_PASSES = 40;

type FieldCacheEntry = { grid: WallGrid; loops: Map<number, BoundaryLoop[]> };
const loopCache = new WeakMap<DistrictField, FieldCacheEntry>();

// All closed boundary loops for one district index, snapped to the wall-road
// centrelines. Outer loops come out counter-clockwise (positive signed area
// in x/z), holes clockwise — callers building fills can split them by the
// sign of loopSignedArea(). `walls` must be the set the field was generated
// against (cityGen.tensorWallRoads).
export function districtBoundaryLoops(
  field: DistrictField,
  index: number,
  walls: WallRoad[],
): BoundaryLoop[] {
  let entry = loopCache.get(field);
  if (!entry) {
    entry = { grid: buildWallGrid(walls), loops: new Map() };
    loopCache.set(field, entry);
  }
  const hit = entry.loops.get(index);
  if (hit) return hit;
  const loops = traceLoops(field, index, entry.grid);
  entry.loops.set(index, loops);
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

// --- Wall-segment spatial hash (the naming.ts buildSegmentGrid idiom) -------

type WallSeg = { ax: number; az: number; bx: number; bz: number };
type WallGrid = Map<number, WallSeg[]>;

function cellKey(cx: number, cz: number): number {
  // Offset into positive space; city coords stay well inside ±2^15 cells.
  return (cx + 32768) * 65536 + (cz + 32768);
}

function buildWallGrid(walls: WallRoad[]): WallGrid {
  const grid: WallGrid = new Map();
  for (const road of walls) {
    const v = road.vertices;
    if (v.length < 2) continue;
    const last = road.closed ? v.length : v.length - 1;
    for (let i = 0; i < last; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) continue;
      const seg: WallSeg = { ax: a.x, az: a.z, bx: b.x, bz: b.z };
      const minCx = Math.floor(Math.min(a.x, b.x) / SNAP_CELL);
      const maxCx = Math.floor(Math.max(a.x, b.x) / SNAP_CELL);
      const minCz = Math.floor(Math.min(a.z, b.z) / SNAP_CELL);
      const maxCz = Math.floor(Math.max(a.z, b.z) / SNAP_CELL);
      for (let cx = minCx; cx <= maxCx; cx++)
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = cellKey(cx, cz);
          const list = grid.get(key);
          if (list) list.push(seg);
          else grid.set(key, [seg]);
        }
    }
  }
  return grid;
}

// Nearest point ON a wall segment within `radius` of (x, z), or null. A 3×3
// cell scan is exhaustive because SNAP_CELL ≥ radius.
function nearestWallPoint(
  grid: WallGrid,
  x: number,
  z: number,
  radius: number,
): { x: number; z: number } | null {
  const cx0 = Math.floor(x / SNAP_CELL);
  const cz0 = Math.floor(z / SNAP_CELL);
  let bestD = radius;
  let best: { x: number; z: number } | null = null;
  for (let cx = cx0 - 1; cx <= cx0 + 1; cx++)
    for (let cz = cz0 - 1; cz <= cz0 + 1; cz++) {
      const segs = grid.get(cellKey(cx, cz));
      if (!segs) continue;
      for (const seg of segs) {
        const dx = seg.bx - seg.ax;
        const dz = seg.bz - seg.az;
        let t = ((x - seg.ax) * dx + (z - seg.az) * dz) / (dx * dx + dz * dz);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = seg.ax + t * dx;
        const pz = seg.az + t * dz;
        const d = Math.hypot(x - px, z - pz);
        if (d <= bestD) {
          bestD = d;
          best = { x: px, z: pz };
        }
      }
    }
  return best;
}

// --- Snap pipeline -----------------------------------------------------------

// Insert intermediate vertices so no edge of the closed loop exceeds `spacing`.
function densifyClosed(loop: BoundaryLoop, spacing: number): BoundaryLoop {
  const out: BoundaryLoop = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    out.push(a);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(len / spacing);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

// Snapping can fold the polyline back on itself near intersections (two
// neighbours project onto one centreline, the vertex between them onto a cross
// street). Repair: drop consecutive near-duplicates and out-and-back spikes,
// iterating until stable. Returns null if the loop degenerates.
function repairClosed(loop: BoundaryLoop): BoundaryLoop | null {
  let pts = loop;
  for (let pass = 0; pass < REPAIR_MAX_PASSES; pass++) {
    let changed = false;
    // 1. consecutive near-duplicates (cyclic).
    const dedup: BoundaryLoop = [];
    for (const p of pts) {
      const prev = dedup[dedup.length - 1];
      if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) < MIN_VERTEX_SPACING) {
        changed = true;
        continue;
      }
      dedup.push(p);
    }
    while (
      dedup.length > 1 &&
      Math.hypot(
        dedup[dedup.length - 1].x - dedup[0].x,
        dedup[dedup.length - 1].z - dedup[0].z,
      ) < MIN_VERTEX_SPACING
    ) {
      dedup.pop();
      changed = true;
    }
    pts = dedup;
    if (pts.length < 4) return null;
    // 2. fold-backs: incoming/outgoing directions reversing ~180°.
    const m = pts.length;
    const keep: BoundaryLoop = [];
    for (let i = 0; i < m; i++) {
      const p = pts[(i - 1 + m) % m];
      const c = pts[i];
      const nx = pts[(i + 1) % m];
      const ix = c.x - p.x;
      const iz = c.z - p.z;
      const ox = nx.x - c.x;
      const oz = nx.z - c.z;
      const il = Math.hypot(ix, iz);
      const ol = Math.hypot(ox, oz);
      if (il > 1e-9 && ol > 1e-9 && (ix * ox + iz * oz) / (il * ol) < FOLDBACK_DOT) {
        changed = true;
        continue;
      }
      keep.push(c);
    }
    pts = keep;
    if (pts.length < 4) return null;
    if (!changed) return pts;
  }
  return pts.length >= 4 ? pts : null;
}

// Densify → snap-to-centreline → repair → light final simplify. Falls back to
// the un-snapped loop if the repair degenerates the loop or flips its
// orientation (the CCW-outer / CW-hole contract must hold for fills).
function snapLoop(pre: BoundaryLoop, grid: WallGrid, step: number): BoundaryLoop {
  const radius = SNAP_RADIUS_FACTOR * step;
  const dense = densifyClosed(pre, DENSIFY_SPACING);
  const snapped: BoundaryLoop = dense.map((p) => nearestWallPoint(grid, p.x, p.z, radius) ?? p);
  const repaired = repairClosed(snapped);
  if (!repaired) return pre;
  if (Math.sign(loopSignedArea(repaired)) !== Math.sign(loopSignedArea(pre))) return pre;
  return simplifyClosed(repaired, FINAL_SIMPLIFY_TOLERANCE);
}

function traceLoops(field: DistrictField, index: number, grid: WallGrid): BoundaryLoop[] {
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
    // Pre-snap DP first (staircase removal), then densify + snap: the DP pass
    // anchors the true corners, and its ≤ ~7m chord deviation is well inside
    // the snap radius, so densified chord points still find their street.
    const pre = simplifyClosed(world, step * SIMPLIFY_TOLERANCE_FRACTION);
    loops.push(snapLoop(pre, grid, step));
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
