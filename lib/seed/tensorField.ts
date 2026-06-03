import seedrandom from "seedrandom";
import { CITY_CENTER, MAX_HALF_EXTENT, GEN_SCALE } from "./topology";
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

// Field morphology (#51) — each seed draws ONE family so cities don't all read
// as the same near-uniform grid (dull) or sprout the same stark radial bullseye
// (weird + too common). All families are realised as the SAME grid-basis layout
// with a per-position orientation, so the streamline math + determinism are
// unchanged; only how each basis's θ is chosen differs.
//   warp  — θ rides a low-frequency sine → organic S-curving streets (no rings)
//   shear — two grids at a 28–54° offset meeting at a smooth seam
//   grid  — calm, but a mandatory gentle bend so it's never dead-straight
//   radial— a compact off-centre roundabout (rare; tighter than before)
type Morphology = "warp" | "shear" | "grid" | "radial";

function pickMorphology(r: number): Morphology {
  if (r < 0.34) return "warp";
  if (r < 0.64) return "shear";
  if (r < 0.86) return "grid";
  return "radial";
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function buildTensorField(masterSeed: string, lattice: Lattice): TensorField {
  const rng = seedrandom(`${masterSeed}::tensor::fields`);
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;
  const half = MAX_HALF_EXTENT; // #14: lay the field out at MAX; the crop is a post-filter
  const basis: Basis[] = [];

  // Per-seed field parameters. `deviation` is the tunable spread within a family
  // (#51): some cities calm, some strongly deformed — the future runtime slider
  // would scale this. Draws happen up-front in a fixed order for determinism.
  const morph = pickMorphology(rng());
  const deviation = 0.7 + rng() * 0.9; // 0.7 … 1.6
  const waveDir = rng() * Math.PI * 2; // direction the warp sine travels
  const waveLambda = half * (0.8 + rng() * 1.2); // warp wavelength (m)
  const wavePhase = rng() * Math.PI * 2;
  const shearNormal = rng() * Math.PI; // boundary orientation for the shear seam
  const shearDelta = ((28 + rng() * 26) * Math.PI) / 180; // grid-to-grid angle: 28–54°
  const shearBand = half * (0.12 + rng() * 0.18); // half-width of the smooth seam
  const radialAng = rng() * Math.PI * 2;
  const radialRad = half * (0.28 + rng() * 0.22);

  const warpAmp = (((morph === "warp" ? 26 : 9) * Math.PI) / 180) * deviation; // calm grid still bends gently
  const JITTER = (4 * Math.PI) / 180; // ±2° per-basis texture so it's never mechanical

  // N×N grid bases, each oriented by the lattice grain + the morphology's
  // deviation. Summing them (Gaussian-weighted) yields a smoothly varying field.
  const N = Math.max(3, Math.round(4 * GEN_SCALE)); // keyed to MAX (gen extent), constant across crops
  const span = half * 1.2;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const fx = cx + (i / (N - 1) - 0.5) * 2 * span;
      const fz = cz + (j / (N - 1) - 0.5) * 2 * span;
      let theta = lattice.orientationAt(fx, fz); // base grain
      if (morph === "shear") {
        const sd = (fx - cx) * Math.cos(shearNormal) + (fz - cz) * Math.sin(shearNormal);
        theta += (smoothstep(-shearBand, shearBand, sd) - 0.5) * shearDelta;
      } else {
        // warp + grid: a coherent sinusoidal bend across the field
        const u = (fx - cx) * Math.cos(waveDir) + (fz - cz) * Math.sin(waveDir);
        theta += warpAmp * Math.sin((2 * Math.PI * u) / waveLambda + wavePhase);
      }
      theta += (rng() - 0.5) * JITTER;
      basis.push({ kind: "grid", cx: fx, cz: fz, size: span * 0.62, decay: 1.3, theta });
    }
  }

  // Radial roundabout — only on the radial morphology (~14% of seeds). Compact +
  // off-centre with a tight decay so it reads as ONE plaza district, not a
  // city-spanning bullseye.
  if (morph === "radial") {
    basis.push({
      kind: "radial",
      cx: cx + Math.cos(radialAng) * radialRad,
      cz: cz + Math.sin(radialAng) * radialRad,
      size: half * 0.2,
      decay: 3.4,
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
