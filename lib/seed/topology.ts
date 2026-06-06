import seedrandom from "seedrandom";

// Topology library for the streets-first city generator.
// Each topology yields 1-3 highway polylines that partition the map and
// drive downstream district + arterial placement.
// See wiki/notes/decision-streets-first-city-generation.md §Topology library
// for the weights and intent of each kind.

export type TopologyKind = "crossroads" | "bypass" | "ring" | "ring-radial";

export type HighwayTier = "highway";

export type Highway = {
  id: string;
  // closed = ring road, polyline wraps back to start; open = the polyline ends where it ends
  closed: boolean;
  // polyline vertices in world space (x, z)
  vertices: Array<{ x: number; z: number }>;
  // road surface width in meters (4-lane intercity highway ≈ 28m)
  width: number;
  tier: HighwayTier;
};

export type Topology = {
  kind: TopologyKind;
  highways: Highway[];
  // City centre and half-extent — districts in later stages partition the
  // interior of this bbox using the highway polylines as cut lines.
  centerX: number;
  centerZ: number;
  halfExtent: number;
};

// Centred on the orbit default (0, -120). A large ~1500m × 1500m playing field
// so cities sprawl well past the framed core into the fog at the edges.
export const CITY_CENTER = { x: 0, z: -120 };
// The tuning baseline. Every world-space constant below (and across the scene /
// camera) was hand-tuned at this size, so CITY_SCALE === 1 here.
export const BASE_HALF_EXTENT = 750;
// THE city-size knob — raise for larger tiers (see wiki plan-city-scale-tiers).
// City tier (1500 = 3km across, ~6.5k buildings). CITY_SCALE=2 vs the 750 base.
export const CITY_HALF_EXTENT = 1500;
// Multiply world-space lengths/extents by this so the scene, camera, and the
// density-coupled gen constants (lattice N, road point cap, district raster)
// track the size knob. Exactly 1 at the base size — a no-op until the knob moves.
export const CITY_SCALE = CITY_HALF_EXTENT / BASE_HALF_EXTENT;

// --- #14 / #58: generate-at-max + crop, with a runtime SIZE TIER --------------
// The whole city is GENERATED at the current tier's extent (decided in
// wiki/notes/decision-additive-growth-citygen.md); the crop slider only
// reveals/hides already-generated content, so the core never re-rolls on a crop
// change. The TIER (#58) sets that gen extent at runtime: each tier is a
// DIFFERENT city for the same seed (a bigger canvas changes the draw sequence —
// switching tiers re-rolls, it does not grow the current city outward). Gen cost
// ∝ extent², so the 3 km default boots ~4× faster than the 6 km notch.
//
// Tiers are keyed by DIAMETER in km — 1 km notches, Truck Stop (1) through
// Metropolis (8). Numeric keys so display names stay pure UI: renaming a notch
// can never re-scale a saved session or a script baseline (the old town/city/
// metro strings would have, the moment the names moved). Legacy mapping:
// town 1.5 km → 2, city 3 km → 3, metro 6 km → 6. Display names live in
// components/ui/cityTiers.ts (TIER_LABELS). CITY_SCALE stays the *look* scale
// (fog/haze/stars/camera) — do not couple it to the tier.
export const CITY_TIERS = {
  1: 500, // Truck Stop
  2: 1000, // Village
  3: 1500, // Town (default — the old "city")
  4: 2000, // Borough
  5: 2500, // Small City
  6: 3000, // City (the old "metro" — the #63 gen-perf baseline)
  7: 3500, // Big City
  8: 4000, // Metropolis
} as const;
export type CityTier = keyof typeof CITY_TIERS;
export const DEFAULT_CITY_TIER: CityTier = 3;
export const CITY_TIER_ORDER: CityTier[] = [1, 2, 3, 4, 5, 6, 7, 8];

let genHalfExtent: number = CITY_TIERS[DEFAULT_CITY_TIER];

// Set the gen extent for everything generated AFTER this call. The store's tier
// setter (and each script) drives it; gen caches key on the extent so stale
// cities are never served across a tier switch.
export function setCityTier(tier: CityTier): void {
  genHalfExtent = CITY_TIERS[tier];
}
// Current gen half-extent (was the MAX_HALF_EXTENT constant). Read at CALL time
// inside generators — never capture it in a module-level constant.
export function maxHalfExtent(): number {
  return genHalfExtent;
}
// Gen density scale vs the hand-tuned 750 base (was the GEN_SCALE constant).
export function genScale(): number {
  return genHalfExtent / BASE_HALF_EXTENT;
}

const HIGHWAY_WIDTH = 28;

// Ring topologies were over-represented; weighted down here. Crossroads 0.45 /
// Bypass 0.35 / Ring 0.10 / Ring+radial 0.10.
export function pickTopologyKind(rng: () => number): TopologyKind {
  const r = rng();
  if (r < 0.45) return "crossroads";
  if (r < 0.8) return "bypass";
  if (r < 0.9) return "ring";
  return "ring-radial";
}

function buildCrossroads(rng: () => number, cx: number, cz: number, half: number): Highway[] {
  // Two roughly perpendicular highways. Each gets a tilt of ±20° so the
  // city doesn't read as axis-aligned, and each is offset from centre by
  // up to ±half/4 so the crossing point varies.
  const tiltA = (rng() - 0.5) * 40 * (Math.PI / 180);
  const tiltB = Math.PI / 2 + (rng() - 0.5) * 40 * (Math.PI / 180);
  const offA = (rng() - 0.5) * half * 0.25;
  const offB = (rng() - 0.5) * half * 0.25;
  const len = half * 2.4; // overshoot bounds so it reads as cutting through

  const lineThrough = (theta: number, perpOffset: number, label: string): Highway => {
    const ux = Math.cos(theta);
    const uz = Math.sin(theta);
    const nx = -uz;
    const nz = ux;
    const px = cx + nx * perpOffset;
    const pz = cz + nz * perpOffset;
    return {
      id: label,
      closed: false,
      width: HIGHWAY_WIDTH,
      tier: "highway",
      vertices: [
        { x: px - ux * len * 0.5, z: pz - uz * len * 0.5 },
        { x: px + ux * len * 0.5, z: pz + uz * len * 0.5 },
      ],
    };
  };

  return [lineThrough(tiltA, offA, "highway-a"), lineThrough(tiltB, offB, "highway-b")];
}

function buildBypass(rng: () => number, cx: number, cz: number, half: number): Highway[] {
  // One highway sweeping along one edge of the bbox. 6 polyline vertices
  // give a soft arc that reads as a road bending around the city rather
  // than a straight wall.
  const edge = Math.floor(rng() * 4); // 0=N(+z), 1=E(+x), 2=S(-z), 3=W(-x)
  const inset = half * (0.55 + rng() * 0.25);
  const sweepRange = half * 1.8;
  const vertCount = 6;
  const arcAmplitude = half * (0.08 + rng() * 0.08);
  const vertices: Array<{ x: number; z: number }> = [];

  for (let i = 0; i < vertCount; i++) {
    const t = i / (vertCount - 1);
    const along = -sweepRange * 0.5 + sweepRange * t;
    const arc = Math.sin(t * Math.PI) * arcAmplitude;
    let x: number;
    let z: number;
    if (edge === 0) {
      x = cx + along;
      z = cz + inset - arc;
    } else if (edge === 1) {
      x = cx + inset - arc;
      z = cz + along;
    } else if (edge === 2) {
      x = cx + along;
      z = cz - inset + arc;
    } else {
      x = cx - inset + arc;
      z = cz + along;
    }
    vertices.push({ x, z });
  }

  return [
    {
      id: "highway-bypass",
      closed: false,
      width: HIGHWAY_WIDTH,
      tier: "highway",
      vertices,
    },
  ];
}

function buildRing(rng: () => number, cx: number, cz: number, half: number): Highway[] {
  // Closed ellipse. Radii vary by seed and the ring may be rotated up to ±45°.
  // Real beltways encircle the built area near the city edge (radius ~5-8× the
  // downtown core), not a tight inner loop — push the radius to 0.80-0.95 of the
  // half-extent so the ring reads as a true edge beltway with a thin suburban
  // band outside it, and stays inside the bbox at any rotation (max semi-axis
  // 0.95·half < half). (#14; wiki/research/map-layout-references.md.)
  const rx = half * (0.8 + rng() * 0.15);
  const rz = half * (0.8 + rng() * 0.15);
  const rotation = (rng() - 0.5) * (Math.PI / 4);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const segs = 18;
  const vertices: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const lx = Math.cos(a) * rx;
    const lz = Math.sin(a) * rz;
    vertices.push({
      x: cx + lx * cos - lz * sin,
      z: cz + lx * sin + lz * cos,
    });
  }

  return [
    {
      id: "highway-ring",
      closed: true,
      width: HIGHWAY_WIDTH,
      tier: "highway",
      vertices,
    },
  ];
}

function buildRingRadial(rng: () => number, cx: number, cz: number, half: number): Highway[] {
  const [ring] = buildRing(rng, cx, cz, half);
  // 2-3 radial spokes crossing the ring; each spoke is a single line through
  // the centre extended to the bbox.
  const spokeCount = 2 + (rng() < 0.4 ? 1 : 0);
  const startAngle = rng() * Math.PI * 2;
  const angleStep = (Math.PI * 2) / (spokeCount * 2);
  const len = half * 2.4;
  const spokes: Highway[] = [];
  for (let i = 0; i < spokeCount; i++) {
    const theta = startAngle + i * angleStep + (rng() - 0.5) * 0.1;
    const ux = Math.cos(theta);
    const uz = Math.sin(theta);
    spokes.push({
      id: `highway-radial-${i}`,
      closed: false,
      width: HIGHWAY_WIDTH,
      tier: "highway",
      vertices: [
        { x: cx - ux * len * 0.5, z: cz - uz * len * 0.5 },
        { x: cx + ux * len * 0.5, z: cz + uz * len * 0.5 },
      ],
    });
  }
  return [ring, ...spokes];
}

export function generateTopology(masterSeed: string): Topology {
  const rng = seedrandom(`${masterSeed}::topology`);
  const kind = pickTopologyKind(rng);
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;
  // #14: generate the topology at the fixed MAX extent (Metro). topo.halfExtent
  // then = MAX, so the tensor-road bbox (cityGen) + district raster auto-follow.
  // The size slider crops post-gen — see wiki/notes/plan-city-scale-migration.md.
  const half = maxHalfExtent();
  let highways: Highway[] = [];
  switch (kind) {
    case "crossroads":
      highways = buildCrossroads(rng, cx, cz, half);
      break;
    case "bypass":
      highways = buildBypass(rng, cx, cz, half);
      break;
    case "ring":
      highways = buildRing(rng, cx, cz, half);
      break;
    case "ring-radial":
      highways = buildRingRadial(rng, cx, cz, half);
      break;
  }
  return { kind, highways, centerX: cx, centerZ: cz, halfExtent: half };
}

// Flatten the topology's highway polylines into a Float32Array of LineSegments
// pairs, so Highways.tsx can build a single BufferGeometry / single draw call.
export function flattenHighwaysToSegments(highways: Highway[]): Float32Array {
  const segments: number[] = [];
  for (const hw of highways) {
    const verts = hw.vertices;
    for (let i = 0; i < verts.length - 1; i++) {
      segments.push(verts[i].x, 0, verts[i].z);
      segments.push(verts[i + 1].x, 0, verts[i + 1].z);
    }
    if (hw.closed && verts.length > 2) {
      const last = verts[verts.length - 1];
      const first = verts[0];
      segments.push(last.x, 0, last.z);
      segments.push(first.x, 0, first.z);
    }
  }
  return new Float32Array(segments);
}
