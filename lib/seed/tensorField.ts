import seedrandom from "seedrandom";
import { CITY_CENTER, CITY_HALF_EXTENT, CITY_SCALE } from "./topology";
import type { Lattice } from "./lattice";

// Tensor field — the direction field the streets follow (the proper tensor-field
// road model, after Chen 2008 / ProbableTrain MapGenerator). Pure deterministic
// math: no RNG inside sample(), the only seeded part is the basis-field layout.
//
// A symmetric, traceless 2×2 tensor is stored as a 2-vector [a, b] meaning
// [[a, b], [b, -a]]. Its major eigenvector points at angle ½·atan2(b, a); the
// minor is perpendicular. Streets are streamlines of these two orthogonal fields:
// major-eigenvector streamlines = one family of roads, minor = the cross family.
//
//   GRID basis  (angle θ): contributes [cos2θ, sin2θ] → a locally rectilinear
//     grid. Summing several grids at slightly different θ gives a smoothly
//     BENDING grid (curved streets) — never a starburst.
//   RADIAL basis (centre c): contributes [dz²−dx², −2·dx·dz] → its major
//     eigenvector runs tangentially (concentric rings) and minor radially
//     (spokes into the centre): a real roundabout/plaza, kept compact + off
//     centre so it forms ONE district, not a city-wide web.

export type Vec2 = { x: number; z: number };

type Basis = {
  kind: "grid" | "radial";
  cx: number;
  cz: number;
  size: number; // influence radius (m) — weight falls off as exp(−decay·(d/size)²)
  decay: number;
  theta: number; // grid orientation (rad); ignored for radial
};

export type TensorField = {
  basis: Basis[];
  // Major (or minor) eigenvector unit direction at a world point; null if the
  // field is degenerate there (magnitude ≈ 0).
  sample: (x: number, z: number, major: boolean) => Vec2 | null;
};

function basisTensor(b: Basis, x: number, z: number): [number, number] {
  if (b.kind === "grid") return [Math.cos(2 * b.theta), Math.sin(2 * b.theta)];
  const dx = x - b.cx;
  const dz = z - b.cz;
  return [dz * dz - dx * dx, -2 * dx * dz];
}

function basisWeight(b: Basis, x: number, z: number): number {
  const dx = x - b.cx;
  const dz = z - b.cz;
  const d2 = (dx * dx + dz * dz) / (b.size * b.size);
  return Math.exp(-b.decay * d2);
}

export function buildTensorField(masterSeed: string, lattice: Lattice): TensorField {
  const rng = seedrandom(`${masterSeed}::tensor::fields`);
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;
  const half = CITY_HALF_EXTENT;
  const basis: Basis[] = [];

  // 1. A 4×4 lattice of GRID basis fields, oriented by the center-anchored
  //    lattice field (θ0 + gentle squared edge-drift, gate1-validated for small
  //    neighbour-delta) plus a PER-SEED waviness × per-field jitter. Summing
  //    grids at varying angles gives a coherently warping grid → curved streets.
  //    waviness varies the amount per seed: some cities near-straight, some wavy
  //    (the "responds to geography" feel) — no two read the same.
  const N = Math.max(3, Math.round(4 * CITY_SCALE)); // grid-basis count — scales with size to hold grain
  const span = half * 1.2;
  const waviness = 0.6 + rng() * 1.4; // 0.6 (calm grid) … 2.0 (very wavy)
  const jitterPeak = ((36 * Math.PI) / 180) * waviness; // ±18°·waviness
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const fx = cx + (i / (N - 1) - 0.5) * 2 * span;
      const fz = cz + (j / (N - 1) - 0.5) * 2 * span;
      const theta = lattice.orientationAt(fx, fz) + (rng() - 0.5) * jitterPeak;
      basis.push({ kind: "grid", cx: fx, cz: fz, size: span * 0.62, decay: 1.3, theta });
    }
  }

  // 2. A radial basis field — a roundabout/plaza district — on only ~35% of
  //    seeds (feedback: circular arterials were appearing in every city). When
  //    present it is compact + off-centre, so it yields ~one ring + short
  //    spokes (a real roundabout), not 1-3 city-spanning circles. The roll +
  //    placement draws happen unconditionally so the RNG stream stays aligned.
  const plazaRoll = rng();
  const ang = rng() * Math.PI * 2;
  const rad = half * (0.3 + rng() * 0.25);
  if (plazaRoll < 0.35) {
    basis.push({
      kind: "radial",
      cx: cx + Math.cos(ang) * rad,
      cz: cz + Math.sin(ang) * rad,
      size: half * 0.24,
      decay: 2.8,
      theta: 0,
    });
  }

  const sample = (x: number, z: number, major: boolean): Vec2 | null => {
    let a = 0;
    let b = 0;
    for (const f of basis) {
      const [ta, tb] = basisTensor(f, x, z);
      const w = basisWeight(f, x, z);
      a += ta * w;
      b += tb * w;
    }
    if (Math.hypot(a, b) < 1e-9) return null;
    let th = 0.5 * Math.atan2(b, a);
    if (!major) th += Math.PI / 2;
    return { x: Math.cos(th), z: Math.sin(th) };
  };

  return { basis, sample };
}

// Align a freshly-sampled eigenvector to the previous step's direction — the
// tensor has a π ambiguity, so without this a streamline would zig-zag at
// saddles. Returns the sign-flipped direction (or null if degenerate).
export function alignDir(d: Vec2 | null, prev: Vec2 | null): Vec2 | null {
  if (!d) return null;
  if (prev && d.x * prev.x + d.z * prev.z < 0) return { x: -d.x, z: -d.z };
  return d;
}
