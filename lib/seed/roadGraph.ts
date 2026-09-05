// Deterministic road connectivity for the minor-tier traffic "journey" rework
// (see wiki/notes/decision-traffic-journeys.md). The city generator has no
// intersection/node model of its own — tensor-field streamlines just stop
// tracing when they get too close to a neighbour, or (subdivisions) explicitly
// snap a spline tip onto the nearest existing road within a generous radius
// (lib/seed/tensorStreets.ts, AnchorIndex). So "does road A connect to road
// B" is answered here by PROXIMITY: does an endpoint of A land within
// `epsilon` of any point along B's polyline?
//
// Measured (scripts, three seeds, minor-road endpoints vs. all other roads):
// median distance to the nearest other road is 0m, but only ~60% of endpoints
// sit within 4m of one — the generator's own snap tolerances (subdivision
// branch/loop snapping, ST_DTEST separation) run up to 50-80m. A literal
// "few metres" epsilon would starve most rural dead-ends of any continuation
// at all. JOURNEY_LINK_EPSILON (traffic.ts) is picked from this distribution
// instead, and kept under the same-family street separation floor (ST_DTEST
// = 54m) so it can't misconnect two parallel, non-touching streets.
//
// Pure geometry over derived-from-seed inputs: no rng, no time — callers
// memoise per (seed, shape) like every other derived-from-seed structure.

export type Vec2 = { x: number; z: number };

export type ArcRoad = { vertices: Vec2[] };

// Cumulative arc length at each vertex (cum[0] = 0, cum[last] = total length).
export function buildArcTable(vertices: Vec2[]): number[] {
  const cum = [0];
  for (let i = 1; i < vertices.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].z - vertices[i - 1].z));
  }
  return cum;
}

function locate(cum: number[], arcM: number): { lo: number; hi: number; t: number } {
  const a = Math.max(0, Math.min(cum[cum.length - 1] ?? 0, arcM));
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= a) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo] || 1;
  return { lo, hi, t: (a - cum[lo]) / span };
}

export function pointAtArc(vertices: Vec2[], cum: number[], arcM: number): Vec2 {
  const { lo, hi, t } = locate(cum, arcM);
  const a = vertices[lo];
  const b = vertices[hi];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

// Unit tangent at arcM, in the polyline's own forward (increasing-arc)
// direction. Samples a small window either side (clamped to the road's
// extent) rather than the adjacent-vertex chord, so a fine-grained streamline
// (vertices ~2-4m apart) doesn't jitter the heading used for turn choices.
export function tangentAtArc(vertices: Vec2[], cum: number[], arcM: number): Vec2 {
  const len = cum[cum.length - 1] ?? 0;
  const p0 = pointAtArc(vertices, cum, Math.max(0, arcM - 6));
  const p1 = pointAtArc(vertices, cum, Math.min(len, arcM + 6));
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: dx / d, z: dz / d };
}

// The sub-polyline from arcM to the road's END, in travel order (forward).
export function verticesFromArcForward(vertices: Vec2[], cum: number[], arcM: number): Vec2[] {
  const { hi } = locate(cum, arcM);
  const start = pointAtArc(vertices, cum, arcM);
  return [start, ...vertices.slice(hi)];
}

// The sub-polyline from arcM back to the road's START, in travel order
// (i.e. reversed relative to the road's own vertex order).
export function verticesFromArcBackward(vertices: Vec2[], cum: number[], arcM: number): Vec2[] {
  const { lo } = locate(cum, arcM);
  const start = pointAtArc(vertices, cum, arcM);
  const rest = vertices.slice(0, lo + 1).reverse();
  return [start, ...rest];
}

// Truncate an already-oriented (travel-order) polyline to at most `maxLen`
// metres from its own start, interpolating a final point if the cut falls
// mid-segment. A no-op if the polyline is already shorter than maxLen.
export function truncateToLength(vertices: Vec2[], maxLen: number): Vec2[] {
  if (vertices.length < 2) return vertices;
  const out: Vec2[] = [vertices[0]];
  let along = 0;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (along + segLen >= maxLen) {
      const t = segLen > 1e-9 ? (maxLen - along) / segLen : 0;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      return out;
    }
    out.push(b);
    along += segLen;
  }
  return out;
}

export type RoadTouch = {
  roadIndex: number; // index into the `roads` array passed to buildRoadGraph
  arcM: number; // arc length along THAT road's own vertex order where the touch lands
};

export type RoadEndpointTouches = {
  start: RoadTouch[]; // roads touching this road's FIRST vertex
  end: RoadTouch[]; // roads touching this road's LAST vertex
};

// For every road's two endpoints, find every OTHER road whose polyline passes
// within `epsilon` of that point, keeping the single closest touch per other
// road. Output is index-parallel to `roads`. Deterministic: touches are keyed
// by (distance-minimum, then sorted by roadIndex) — independent of any Map
// iteration order.
export function buildRoadGraph(roads: ArcRoad[], epsilon: number): RoadEndpointTouches[] {
  const cellSize = Math.max(epsilon, 1);
  // Packed grid key — see lib/seed/tensorStreets.ts GridStorage for the same
  // pattern. Offset/stride sized generously for city-scale coordinates.
  const cellKey = (cx: number, cz: number) => (cx + 16384) * 32768 + (cz + 16384);
  const grid = new Map<number, Array<{ road: number; seg: number }>>();
  const cumTables = roads.map((r) => buildArcTable(r.vertices));

  for (let ri = 0; ri < roads.length; ri++) {
    const v = roads[ri].vertices;
    for (let i = 1; i < v.length; i++) {
      const a = v[i - 1];
      const b = v[i];
      const gx0 = Math.floor(Math.min(a.x, b.x) / cellSize);
      const gx1 = Math.floor(Math.max(a.x, b.x) / cellSize);
      const gz0 = Math.floor(Math.min(a.z, b.z) / cellSize);
      const gz1 = Math.floor(Math.max(a.z, b.z) / cellSize);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const k = cellKey(gx, gz);
          const entry = { road: ri, seg: i };
          const list = grid.get(k);
          if (list) list.push(entry);
          else grid.set(k, [entry]);
        }
      }
    }
  }

  const closestOnSeg = (
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): { d: number; t: number } => {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) return { d: Math.hypot(px - ax, pz - az), t: 0 };
    let t = ((px - ax) * dx + (pz - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t };
  };

  const findTouches = (px: number, pz: number, selfRoad: number): RoadTouch[] => {
    const bestD = new Map<number, number>(); // other road index -> best distance so far
    const bestArc = new Map<number, number>();
    const cx = Math.floor(px / cellSize);
    const cz = Math.floor(pz / cellSize);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const list = grid.get(cellKey(gx, gz));
        if (!list) continue;
        for (const { road, seg } of list) {
          if (road === selfRoad) continue;
          const v = roads[road].vertices;
          const a = v[seg - 1];
          const b = v[seg];
          const { d, t } = closestOnSeg(px, pz, a.x, a.z, b.x, b.z);
          if (d > epsilon) continue;
          const prev = bestD.get(road);
          if (prev === undefined || d < prev) {
            bestD.set(road, d);
            const cum = cumTables[road];
            bestArc.set(road, cum[seg - 1] + t * (cum[seg] - cum[seg - 1]));
          }
        }
      }
    }
    const out: RoadTouch[] = [];
    for (const [roadIndex, arcM] of bestArc) out.push({ roadIndex, arcM });
    out.sort((a, b) => a.roadIndex - b.roadIndex);
    return out;
  };

  return roads.map((r, ri) => {
    const v = r.vertices;
    if (v.length < 2) return { start: [], end: [] };
    return {
      start: findTouches(v[0].x, v[0].z, ri),
      end: findTouches(v[v.length - 1].x, v[v.length - 1].z, ri),
    };
  });
}
