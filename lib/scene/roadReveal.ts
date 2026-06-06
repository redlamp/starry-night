// Road-reveal cascade schedule (spec: docs/specs/2026-06-05-road-reveal-cascade.md).
// Pure function of road geometry → per-poly reveal times, normalized 0..1.
// Highways grow from their point nearest the centre; arterials attach to the
// nearest highway point (within EPS) and sprout when the wavefront reveals
// that junction; streets attach to arterials the same way. Orphans (random
// infill seeds with no parent in range) fall back to a radial wavefront so
// they join the wave instead of popping. Never stored — recomputed with the
// geometry (two-tier state rule).

export type RevealVec2 = { x: number; z: number };
export type RevealPolyInput = { vertices: RevealVec2[]; closed?: boolean };
export type RevealTier = 0 | 1 | 2; // 0 highways, 1 arterials, 2 streets

// Abstract m/s — only ratios matter (the result is normalized). LAG is the
// beat between a junction lighting up and its child starting to grow.
// Streets intentionally outpace arterials: streets are short spurs that should
// snap in behind the wavefront, while arterials draw long and stately.
// SPEED is high relative to RADIAL_SPEED on purpose: RADIAL_SPEED spaces the
// start times (the wave crossing the city), SPEED is how fast each line zips
// once started — raising SPEED alone makes tips visibly faster without
// changing the overall cascade duration (visual-gate feedback).
// RADIAL_SPEED sets the stagger window (first-to-last line start): the raw
// spread ≈ city radius / RADIAL_SPEED, renormalized into the duration slider.
// 2000 ≈ half the stagger of the original 900 — the cascade reads as one
// coordinated sweep instead of a long trickle (visual-gate feedback). SPEED
// scaled up with it so per-line zip keeps its pace after renormalization.
const SPEED: Record<RevealTier, number> = { 0: 3400, 1: 2000, 2: 2600 };
const RADIAL_SPEED = 2000;
const ATTACH_EPS = 60; // m — max junction distance for a parent attach
const LAG = 0.15; // s
// Concave remap (t^k, k < 1) bunches the schedule's tail: far-flung radial
// orphans otherwise finish one by one — sparse bright-tipped lines streaking
// across an already-woken city (read as ground-level shooting stars in the
// visual gate). k < 1 compresses late times together so stragglers land as a
// closing group; monotonic, keeps 0→0 and 1→1.
const TAIL_EASE = 0.7;

export type PolySched = {
  start: number; // seconds at which growth begins from attachArc
  attachArc: number;
  speed: number;
  len: number;
  closed: boolean;
  cum: number[]; // cumulative arc length per vertex
  parentTime: number | null; // parent junction reveal time (null = radial orphan)
};

export type RevealSchedule = {
  /** Normalized reveal time (0..1) at arc-distance `arc` along poly `p` of `tier`. */
  revealAt(tier: RevealTier, p: number, arc: number): number;
  /** Introspection for sanity checks / geometry building. */
  polyInfo(tier: RevealTier, p: number): PolySched;
};

function cumLengths(v: RevealVec2[], closed: boolean): number[] {
  const cum = [0];
  const n = closed ? v.length + 1 : v.length;
  for (let i = 1; i < n; i++) {
    const a = v[(i - 1) % v.length];
    const b = v[i % v.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return cum;
}

// Arc distance between two arcs on a poly (shortest way around for rings).
function arcDist(a: number, b: number, len: number, closed: boolean): number {
  const d = Math.abs(a - b);
  return closed ? Math.min(d, len - d) : d;
}

// Spatial hash of parent points → nearest (point, polyIdx, arc) lookup.
class PointHash {
  private cells = new Map<string, Array<{ x: number; z: number; poly: number; arc: number }>>();
  constructor(private cell: number) {}
  add(x: number, z: number, poly: number, arc: number) {
    const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    const list = this.cells.get(k);
    const e = { x, z, poly, arc };
    if (list) list.push(e);
    else this.cells.set(k, [e]);
  }
  nearest(x: number, z: number, maxDist: number) {
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best: { poly: number; arc: number; d: number } | null = null;
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const list = this.cells.get(`${ix},${iz}`);
        if (!list) continue;
        for (const e of list) {
          const d = Math.hypot(e.x - x, e.z - z);
          if (d <= maxDist && (!best || d < best.d)) best = { poly: e.poly, arc: e.arc, d };
        }
      }
    return best;
  }
}

export function buildRevealSchedule(
  highways: RevealPolyInput[],
  arterials: RevealPolyInput[],
  streets: RevealPolyInput[],
  centre: RevealVec2,
): RevealSchedule {
  const tiers: PolySched[][] = [[], [], []];
  const inputs: RevealPolyInput[][] = [highways, arterials, streets];

  // Un-normalized reveal time at (tier, poly, arc).
  const rawAt = (tier: RevealTier, p: number, arc: number): number => {
    const s = tiers[tier][p];
    return s.start + arcDist(arc, s.attachArc, s.len, s.closed) / s.speed;
  };

  // --- Tier 0: highways grow from their point nearest the centre. -----------
  for (let p = 0; p < highways.length; p++) {
    const poly = highways[p];
    if (poly.vertices.length === 0) {
      tiers[0].push({ start: 0, attachArc: 0, speed: SPEED[0], len: 0, closed: false, cum: [0], parentTime: null });
      continue;
    }
    const closed = poly.closed ?? false;
    const cum = cumLengths(poly.vertices, closed);
    const len = cum[cum.length - 1];
    let attachArc = 0;
    let bestD = Infinity;
    for (let i = 0; i < poly.vertices.length; i++) {
      const v = poly.vertices[i];
      const d = Math.hypot(v.x - centre.x, v.z - centre.z);
      if (d < bestD) {
        bestD = d;
        attachArc = cum[i];
      }
    }
    tiers[0].push({
      start: bestD / RADIAL_SPEED, // farther-from-centre highways start later
      attachArc,
      speed: SPEED[0],
      len,
      closed,
      cum,
      parentTime: null,
    });
  }

  // --- Tiers 1, 2: attach to the previous tier by proximity. ----------------
  for (const tier of [1, 2] as RevealTier[]) {
    const parentTier = (tier - 1) as RevealTier;
    // Cell (100) sized so the scan radius for ATTACH_EPS (60) stays 1 ring —
    // r = ceil(60/100) = 1; grow the cell if EPS ever exceeds it.
    const hash = new PointHash(100);
    inputs[parentTier].forEach((poly, pi) => {
      const cum = tiers[parentTier][pi].cum;
      poly.vertices.forEach((v, i) => hash.add(v.x, v.z, pi, cum[i]));
    });

    for (let p = 0; p < inputs[tier].length; p++) {
      const poly = inputs[tier][p];
      if (poly.vertices.length === 0) {
        tiers[tier].push({ start: 0, attachArc: 0, speed: SPEED[tier], len: 0, closed: false, cum: [0], parentTime: null });
        continue;
      }
      const closed = poly.closed ?? false;
      const cum = cumLengths(poly.vertices, closed);
      const len = cum[cum.length - 1];

      // Find this poly's vertex closest to ANY parent point.
      let attach: { arc: number; parentPoly: number; parentArc: number; d: number } | null = null;
      for (let i = 0; i < poly.vertices.length; i++) {
        const v = poly.vertices[i];
        const hit = hash.nearest(v.x, v.z, ATTACH_EPS);
        if (hit && (!attach || hit.d < attach.d))
          attach = { arc: cum[i], parentPoly: hit.poly, parentArc: hit.arc, d: hit.d };
      }

      if (attach) {
        const parentTime = rawAt(parentTier, attach.parentPoly, attach.parentArc);
        tiers[tier].push({
          start: parentTime + LAG,
          attachArc: attach.arc,
          speed: SPEED[tier],
          len,
          closed,
          cum,
          parentTime,
        });
      } else {
        // Radial orphan: join the wave at its nearest-to-centre vertex.
        let bestD = Infinity;
        let attachArc = 0;
        for (let i = 0; i < poly.vertices.length; i++) {
          const v = poly.vertices[i];
          const d = Math.hypot(v.x - centre.x, v.z - centre.z);
          if (d < bestD) {
            bestD = d;
            attachArc = cum[i];
          }
        }
        tiers[tier].push({
          start: bestD / RADIAL_SPEED + LAG,
          attachArc,
          speed: SPEED[tier],
          len,
          closed,
          cum,
          parentTime: null,
        });
      }
    }
  }

  // --- Normalize so the slowest endpoint lands at exactly 1. ----------------
  let maxT = 0;
  for (const tier of [0, 1, 2] as RevealTier[])
    for (let p = 0; p < tiers[tier].length; p++) {
      const s = tiers[tier][p];
      maxT = Math.max(maxT, rawAt(tier, p, 0), rawAt(tier, p, s.len));
      // Closed ring: both endpoints map to the same arc via arcDist; the true
      // maximum is the halfway point on the opposite side of the attach.
      if (s.closed) maxT = Math.max(maxT, rawAt(tier, p, s.attachArc + s.len / 2));
    }
  const inv = maxT > 0 ? 1 / maxT : 1;

  return {
    revealAt: (tier, p, arc) => Math.pow(rawAt(tier, p, arc) * inv, TAIL_EASE),
    polyInfo: (tier, p) => {
      const s = tiers[tier][p];
      // parentTime gets the same normalize + remap as revealAt so consumers
      // (and sanity check 4) compare in one timeline.
      return {
        ...s,
        parentTime: s.parentTime === null ? null : Math.pow(s.parentTime * inv, TAIL_EASE),
      };
    },
  };
}
