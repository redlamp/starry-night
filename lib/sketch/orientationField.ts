/**
 * Sketch → tensor field (#40). Recovers a street-traceable tensor field from a
 * photo of a hand-hatched sketch.
 *
 * Pure math, shared by the /tensor lab page (canvas-decoded input) and the
 * scripts/sketchField + sketchTrace prototypes (sharp-decoded input): the
 * caller hands in a plain grayscale buffer, nothing here touches the DOM or
 * node APIs.
 *
 * Two stages:
 *  1. recoverOrientationField — IMAGE STRUCTURE TENSOR (J = ∇I·∇Iᵀ, smoothed;
 *     eigenvectors give the dominant gradient, strokes run perpendicular) on a
 *     coarse cell grid, plus a sign-continuity BFS that IMPLIES a flow
 *     direction from the π-ambiguous orientations (the gridified alignDir
 *     trick).
 *  2. makeSketchTensor — wraps the recovered grid in the exact TensorField
 *     interface the road tracer consumes. Bilinear blending happens in
 *     DOUBLED-ANGLE space — a = Σw·cos2θ, b = Σw·sin2θ — the same [a, b]
 *     symmetric-traceless representation tensorField.ts uses, so θ vs θ+π
 *     can't corrupt the blend. Ink coherence doubles as the city mask.
 */
import type { TensorField } from "@/lib/seed/tensorField";

export type RecoverOptions = {
  grid?: number; // px per field cell
  smoothR?: number; // structure-tensor smoothing radius (≈ hatch-patch scale)
  minCoherence?: number; // below this the cell has no clear stroke direction
  minEnergyPct?: number; // energy percentile gate — skips bare paper / table
};

export const RECOVER_DEFAULTS = {
  grid: 9,
  smoothR: 7,
  minCoherence: 0.18,
  minEnergyPct: 0.35,
} as const;

export type OrientationField = {
  W: number; // analysis image size
  H: number;
  gray: Float32Array; // W×H grayscale, 0..1
  grid: number; // px per cell
  gw: number; // cell-grid size
  gh: number;
  theta: Float32Array; // stroke orientation per cell, mod π
  coh: Float32Array; // coherence (λ1−λ2)/(λ1+λ2), 0..1
  valid: Uint8Array; // passed energy + coherence gates
  dirX: Float32Array; // implied flow unit vector (sign-propagated)
  dirY: Float32Array;
  assigned: Uint8Array; // reached by the sign-propagation BFS
  validCount: number;
  flips: number; // cells whose sign the propagation flipped
  seedCoherence: number; // coherence of the BFS seed cell
};

export function recoverOrientationField(
  gray: Float32Array,
  W: number,
  H: number,
  opts: RecoverOptions = {},
): OrientationField {
  const GRID = opts.grid ?? RECOVER_DEFAULTS.grid;
  const SMOOTH_R = opts.smoothR ?? RECOVER_DEFAULTS.smoothR;
  const MIN_COHERENCE = opts.minCoherence ?? RECOVER_DEFAULTS.minCoherence;
  const MIN_ENERGY_PCT = opts.minEnergyPct ?? RECOVER_DEFAULTS.minEnergyPct;

  // --- Sobel gradients ---
  const Ix = new Float32Array(W * H);
  const Iy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      Ix[i] =
        gray[i - W + 1] +
        2 * gray[i + 1] +
        gray[i + W + 1] -
        (gray[i - W - 1] + 2 * gray[i - 1] + gray[i + W - 1]);
      Iy[i] =
        gray[i + W - 1] +
        2 * gray[i + W] +
        gray[i + W + 1] -
        (gray[i - W - 1] + 2 * gray[i - W] + gray[i - W + 1]);
    }
  }

  // --- structure tensor components, box-blurred 3× (≈ Gaussian σ ~ SMOOTH_R) ---
  const Jxx = new Float32Array(W * H);
  const Jyy = new Float32Array(W * H);
  const Jxy = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    Jxx[i] = Ix[i] * Ix[i];
    Jyy[i] = Iy[i] * Iy[i];
    Jxy[i] = Ix[i] * Iy[i];
  }
  const boxBlur = (src: Float32Array) => {
    // separable box blur, radius SMOOTH_R, run on src in place via temp
    const tmp = new Float32Array(W * H);
    const r = SMOOTH_R;
    const norm = 1 / (2 * r + 1);
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = acc * norm;
        const out = Math.max(0, x - r);
        const inn = Math.min(W - 1, x + r + 1);
        acc += src[y * W + inn] - src[y * W + out];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        src[y * W + x] = acc * norm;
        const out = Math.max(0, y - r);
        const inn = Math.min(H - 1, y + r + 1);
        acc += tmp[inn * W + x] - tmp[out * W + x];
      }
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(Jxx);
    boxBlur(Jyy);
    boxBlur(Jxy);
  }

  // --- per-cell orientation + coherence ---
  const gw = Math.floor(W / GRID);
  const gh = Math.floor(H / GRID);
  const theta = new Float32Array(gw * gh); // stroke orientation, mod π
  const coh = new Float32Array(gw * gh);
  const energy = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const cx = Math.min(W - 1, Math.round((gx + 0.5) * GRID));
      const cy = Math.min(H - 1, Math.round((gy + 0.5) * GRID));
      const i = cy * W + cx;
      const xx = Jxx[i];
      const yy = Jyy[i];
      const xy = Jxy[i];
      const tr = xx + yy;
      const det = Math.sqrt((xx - yy) * (xx - yy) + 4 * xy * xy);
      const l1 = (tr + det) / 2;
      const l2 = (tr - det) / 2;
      const g = gy * gw + gx;
      energy[g] = tr;
      coh[g] = tr > 1e-9 ? (l1 - l2) / (l1 + l2) : 0;
      // dominant GRADIENT orientation; strokes run perpendicular to it
      const gradTheta = 0.5 * Math.atan2(2 * xy, xx - yy);
      theta[g] = gradTheta + Math.PI / 2;
    }
  }
  // energy gate: percentile threshold
  const sortedE = Array.from(energy).sort((a, b) => a - b);
  const eThresh = sortedE[Math.floor(sortedE.length * MIN_ENERGY_PCT)];
  const valid = new Uint8Array(gw * gh);
  let validCount = 0;
  for (let g = 0; g < gw * gh; g++) {
    if (energy[g] > eThresh && coh[g] > MIN_COHERENCE) {
      valid[g] = 1;
      validCount++;
    }
  }

  // --- imply direction: sign-continuity propagation (alignDir, gridified) ---
  // Each valid cell gets a unit vector ±(cosθ, sinθ); BFS from the most coherent
  // cell, choosing each sign to agree with the average of assigned neighbours.
  const dirX = new Float32Array(gw * gh);
  const dirY = new Float32Array(gw * gh);
  const assigned = new Uint8Array(gw * gh);
  let seedG = -1;
  let bestCoh = -1;
  for (let g = 0; g < gw * gh; g++)
    if (valid[g] && coh[g] > bestCoh) {
      bestCoh = coh[g];
      seedG = g;
    }
  if (seedG >= 0) {
    const queue: number[] = [seedG];
    dirX[seedG] = Math.cos(theta[seedG]);
    dirY[seedG] = Math.sin(theta[seedG]);
    assigned[seedG] = 1;
    let head = 0;
    while (head < queue.length) {
      const g = queue[head++];
      const gx = g % gw;
      const gy = Math.floor(g / gw);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          const n = ny * gw + nx;
          if (!valid[n] || assigned[n]) continue;
          // average of assigned neighbours of n
          let ax = 0;
          let ay = 0;
          for (let ey = -1; ey <= 1; ey++) {
            for (let ex = -1; ex <= 1; ex++) {
              const mx = nx + ex;
              const my = ny + ey;
              if (mx < 0 || mx >= gw || my < 0 || my >= gh) continue;
              const m = my * gw + mx;
              if (assigned[m]) {
                ax += dirX[m];
                ay += dirY[m];
              }
            }
          }
          let vx = Math.cos(theta[n]);
          let vy = Math.sin(theta[n]);
          if (vx * ax + vy * ay < 0) {
            vx = -vx;
            vy = -vy;
          }
          dirX[n] = vx;
          dirY[n] = vy;
          assigned[n] = 1;
          queue.push(n);
        }
      }
    }
  }
  let flips = 0;
  for (let g = 0; g < gw * gh; g++)
    if (assigned[g]) {
      const v = Math.cos(theta[g]) * dirX[g] + Math.sin(theta[g]) * dirY[g];
      if (v < 0) flips++;
    }

  return {
    W,
    H,
    gray,
    grid: GRID,
    gw,
    gh,
    theta,
    coh,
    valid,
    dirX,
    dirY,
    assigned,
    validCount,
    flips,
    seedCoherence: bestCoh,
  };
}

// The minimal slice of an OrientationField the tensor wrapper needs — plain
// data, structured-clone-safe, so a sketch can travel to the gen worker and
// live in the scene store without dragging the full recovery output along.
export type SketchTensorSource = Pick<
  OrientationField,
  "W" | "H" | "grid" | "gw" | "gh" | "theta" | "coh" | "valid"
>;

export function toSketchTensorSource(f: OrientationField): SketchTensorSource {
  return {
    W: f.W,
    H: f.H,
    grid: f.grid,
    gw: f.gw,
    gh: f.gh,
    theta: f.theta,
    coh: f.coh,
    valid: f.valid,
  };
}

export type SketchTensor = {
  field: TensorField;
  mask: (x: number, z: number) => number; // ShapeMask-compatible ink mask
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  metersPerPx: number; // world metres per analysis pixel
  weightAt: (x: number, z: number) => number; // interpolated ink confidence
};

// Wrap the recovered grid in the TensorField interface the tracer consumes.
// worldWidth = metres the page spans; wMin = min interpolated stroke weight
// below which the field is degenerate (no ink → streamlines stop); origin =
// world position of the page's top-left corner (default 0,0 — the script /
// lab convention; the city centres the page on CITY_CENTER instead).
export function makeSketchTensor(
  f: SketchTensorSource,
  worldWidth: number,
  wMin: number,
  origin: { x: number; z: number } = { x: 0, z: 0 },
): SketchTensor {
  const S = worldWidth / f.W;

  // weight = bilinear(valid ? coherence : 0); doubles as the ink mask.
  const tensorAt = (wx: number, wz: number): { a: number; b: number; w: number } => {
    const x = wx - origin.x;
    const z = wz - origin.z;
    const gx = x / S / f.grid - 0.5;
    const gy = z / S / f.grid - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    let a = 0;
    let b = 0;
    let w = 0;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const cx = x0 + dx;
        const cy = y0 + dy;
        if (cx < 0 || cx >= f.gw || cy < 0 || cy >= f.gh) continue;
        const g = cy * f.gw + cx;
        if (!f.valid[g]) continue;
        const bw = (dx ? gx - x0 : 1 - (gx - x0)) * (dy ? gy - y0 : 1 - (gy - y0)) * f.coh[g];
        a += Math.cos(2 * f.theta[g]) * bw;
        b += Math.sin(2 * f.theta[g]) * bw;
        w += bw;
      }
    }
    return { a, b, w };
  };

  const field: TensorField = {
    basis: [], // no analytic bases — sample() is the whole field
    sample: (x, z, major) => {
      const { a, b, w } = tensorAt(x, z);
      if (w < wMin || Math.hypot(a, b) < 1e-9) return null; // off the ink
      let th = 0.5 * Math.atan2(b, a);
      if (!major) th += Math.PI / 2;
      return { x: Math.cos(th), z: Math.sin(th) };
    },
  };

  return {
    field,
    mask: (x, z) => (tensorAt(x, z).w >= wMin ? 1 : 0),
    bounds: {
      minX: origin.x,
      maxX: origin.x + f.W * S,
      minZ: origin.z,
      maxZ: origin.z + f.H * S,
    },
    metersPerPx: S,
    weightAt: (x, z) => tensorAt(x, z).w,
  };
}
