import type { DistrictField } from "./district";

// Road polyline geometry queries the directory columns need but the address
// pass can't answer. Highways carry NO addressed buildings (assignAddresses
// filters them out — see naming.ts buildSegmentGrid), so a highway's card has
// to derive its districts and its junctions from the polyline itself.
//
// Pure geometry over derived-from-seed data: no rng, no time. Callers memoise.

export type Vertex = { x: number; z: number };

export type DistrictRun = {
  index: number; // District.index, matching DistrictField.classify()
  startM: number; // metres from the road's first vertex where this run begins
  lengthM: number; // road length inside this district for this contiguous run
};

export type RoadCrossing = {
  roadId: string;
  x: number;
  z: number;
  alongM: number; // metres from the target road's first vertex
};

export function roadLength(vertices: Vertex[], closed = false): number {
  let total = 0;
  for (let i = 1; i < vertices.length; i++) {
    total += Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].z - vertices[i - 1].z);
  }
  if (closed && vertices.length > 2) {
    const a = vertices[vertices.length - 1];
    const b = vertices[0];
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

// Districts the road passes through, in traversal order, as contiguous runs —
// a road that leaves a district and comes back yields two runs, so callers can
// drop slivers (a corner clipped for 20m) without losing a real second pass.
// Each segment is attributed by its midpoint; unassigned cells (classify -1,
// i.e. the dropped micro-cells and outside-the-field) break the run.
export function districtRunsAlong(vertices: Vertex[], field: DistrictField): DistrictRun[] {
  const runs: DistrictRun[] = [];
  let along = 0;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len === 0) continue;
    const idx = field.classify((a.x + b.x) / 2, (a.z + b.z) / 2);
    if (idx >= 0) {
      const last = runs[runs.length - 1];
      if (last && last.index === idx) last.lengthM += len;
      else runs.push({ index: idx, startM: along, lengthM: len });
    }
    along += len;
  }
  return runs;
}

// --- Crossing search ---------------------------------------------------------
// Grid the TARGET road's segments (a highway is ~3k of them), then stream every
// other road's segments past it once. The inverse (gridding the whole 106k-
// segment network) would cost more to build than the query saves.

const CELL_M = 80;
const CELL_HASH = 100003; // prime stride so (gx, gz) keys don't collide by parity

function cellKey(gx: number, gz: number): number {
  return gx * CELL_HASH + gz;
}

type SegGrid = {
  cells: Map<number, number[]>; // cell key → target segment start-indices
  vertices: Vertex[];
  prefix: Float64Array; // cumulative length at each vertex
};

function buildSegGrid(vertices: Vertex[]): SegGrid {
  const cells = new Map<number, number[]>();
  const prefix = new Float64Array(vertices.length);
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    prefix[i] = prefix[i - 1] + Math.hypot(b.x - a.x, b.z - a.z);
    const gx0 = Math.floor(Math.min(a.x, b.x) / CELL_M);
    const gx1 = Math.floor(Math.max(a.x, b.x) / CELL_M);
    const gz0 = Math.floor(Math.min(a.z, b.z) / CELL_M);
    const gz1 = Math.floor(Math.max(a.z, b.z) / CELL_M);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const key = cellKey(gx, gz);
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  }
  return { cells, vertices, prefix };
}

// Proper crossing only: both parameters strictly inside their segments (with an
// epsilon), so a shared endpoint where a street simply ends on the highway
// still counts, but two collinear segments (denominator 0) do not.
const EPS = 1e-9;

function segCross(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < EPS) return null;
  const qpx = cx - ax;
  const qpz = cz - az;
  const t = (qpx * sz - qpz * sx) / denom;
  if (t < 0 || t > 1) return null;
  const u = (qpx * rz - qpz * rx) / denom;
  if (u < 0 || u > 1) return null;
  return t;
}

// Roads that cross `target`, ordered along it (first vertex → last). One entry
// per road, at its FIRST crossing — a street that crosses twice (a loop over a
// highway) still lists once; `alongM` is where it first meets the road.
export function crossingsAlong(
  target: { vertices: Vertex[] },
  others: Array<{ id: string; vertices: Vertex[] }>,
): RoadCrossing[] {
  if (target.vertices.length < 2) return [];
  const grid = buildSegGrid(target.vertices);
  const found = new Map<string, RoadCrossing>();
  // Per-query stamp so a segment spanning several cells is tested once.
  const stamp = new Int32Array(target.vertices.length);
  let queryId = 0;

  for (const other of others) {
    const verts = other.vertices;
    for (let j = 1; j < verts.length; j++) {
      const c = verts[j - 1];
      const d = verts[j];
      const gx0 = Math.floor(Math.min(c.x, d.x) / CELL_M);
      const gx1 = Math.floor(Math.max(c.x, d.x) / CELL_M);
      const gz0 = Math.floor(Math.min(c.z, d.z) / CELL_M);
      const gz1 = Math.floor(Math.max(c.z, d.z) / CELL_M);
      queryId++;
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const list = grid.cells.get(cellKey(gx, gz));
          if (!list) continue;
          for (const i of list) {
            if (stamp[i] === queryId) continue;
            stamp[i] = queryId;
            const a = grid.vertices[i - 1];
            const b = grid.vertices[i];
            const t = segCross(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z);
            if (t === null) continue;
            const alongM = grid.prefix[i - 1] + t * (grid.prefix[i] - grid.prefix[i - 1]);
            const prev = found.get(other.id);
            if (prev && prev.alongM <= alongM) continue;
            found.set(other.id, {
              roadId: other.id,
              x: a.x + t * (b.x - a.x),
              z: a.z + t * (b.z - a.z),
              alongM,
            });
          }
        }
      }
    }
  }
  return [...found.values()].sort((p, q) => p.alongM - q.alongM);
}
