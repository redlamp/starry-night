/**
 * Sketch → tensor → STREETS (#40 prototype, stage 2).
 *
 * Wraps the orientation grid recovered by recoverSketchField() in the exact
 * TensorField interface the road tracer consumes — a sampled-grid basis instead
 * of the seeded analytic bases — then runs the unmodified RK4 streamline tracer
 * (generateTensorStreets) through it.
 *
 *   bun run scripts/sketchTrace.ts [imagePath] [seed]
 *
 * Output: samples/sketch-trace.png — three panels:
 *   1. the sketch (grayscale)
 *   2. THE INTERNALIZED FIELD — major (amber) / minor (cyan) eigenvector
 *      crosses sampled through the same field.sample() the tracer sees.
 *      No arrowheads: a tensor field has orientation, not direction.
 *   3. the traced street network — arterials (amber) + minor streets (blue),
 *      over a ghost of the sketch
 *
 * The interpolation trick: per-cell orientation θ is π-ambiguous, so bilinear
 * blending happens in DOUBLED-ANGLE space — a = Σw·cos2θ, b = Σw·sin2θ — the
 * same [a, b] symmetric-traceless representation tensorField.ts uses; θ and
 * θ+π land on the same point, so the wrap can't corrupt the blend.
 */
import { writeFileSync } from "node:fs";
import { recoverSketchField, encodePngRGB } from "./sketchField";
import { makeSketchTensor } from "@/lib/sketch/orientationField";
import { generateTensorStreets } from "@/lib/seed/tensorStreets";
import { setCityTier } from "@/lib/seed/topology";

const IMAGE = process.argv[2] ?? "C:/Users/taylo/Downloads/IMG_20191205_082043.jpg";
const SEED = process.argv[3] ?? "sketch";
const WORLD_W = 3000; // metres the page spans — city-tier arterial spacing (210m) fits
const W_MIN = 0.05; // min interpolated stroke weight — below = no ink = degenerate

setCityTier("city"); // streamline point cap long enough to cross the page

async function main() {
  const f = await recoverSketchField(IMAGE);

  // --- the recovered field as a TensorField (sampled-grid basis) ---
  const { field, mask, bounds, metersPerPx: S, weightAt } = makeSketchTensor(f, WORLD_W, W_MIN);

  // --- trace, exactly as the city does ---
  const t0 = performance.now();
  const { arterials, minorStreets } = generateTensorStreets(SEED, bounds, mask, undefined, field);
  const traceMs = performance.now() - t0;

  // --- render: 3 panels ---
  const PAD = 8;
  const PW = f.W;
  const PH = f.H;
  const OUT_W = 3 * PW + 4 * PAD;
  const OUT_H = PH + 2 * PAD;
  const img = new Uint8Array(OUT_W * OUT_H * 3);
  const px = (x: number, y: number, r: number, g: number, b: number) => {
    x |= 0;
    y |= 0;
    if (x < 0 || x >= OUT_W || y < 0 || y >= OUT_H) return;
    const i = (y * OUT_W + x) * 3;
    img[i] = r;
    img[i + 1] = g;
    img[i + 2] = b;
  };
  const line = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    g: number,
    b: number,
  ) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      px(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, g, b);
    }
  };

  // panel 1: the sketch; panels 2+3: dim sketch ghost on night-blue
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const v = f.gray[y * f.W + x];
      px(PAD + x, PAD + y, Math.round(v * 255), Math.round(v * 255), Math.round(v * 255));
      const ink = 1 - v; // dark strokes → bright ghost
      const g2 = Math.round(10 + ink * 70);
      px(PAD + (PW + PAD) + x, PAD + y, Math.round(8 + ink * 50), g2, Math.round(20 + ink * 80));
      px(
        PAD + 2 * (PW + PAD) + x,
        PAD + y,
        Math.round(8 + ink * 34),
        Math.round(10 + ink * 40),
        Math.round(20 + ink * 56),
      );
    }
  }

  // panel 2 — the internalized field: major/minor eigenvector crosses sampled
  // through field.sample() itself (bilinear + gates included). Every 2nd cell.
  {
    const ox = PAD + (PW + PAD);
    for (let gy = 0; gy < f.gh; gy += 2) {
      for (let gx = 0; gx < f.gw; gx += 2) {
        const cx = (gx + 0.5) * f.grid;
        const cy = (gy + 0.5) * f.grid;
        const wx = cx * S;
        const wz = cy * S;
        const maj = field.sample(wx, wz, true);
        if (!maj) continue; // degenerate — the tracer would stop here too
        const w = weightAt(wx, wz);
        const len = f.grid * (0.6 + 1.1 * Math.min(1, w * 1.6));
        // major: amber
        line(
          ox + cx - maj.x * len,
          PAD + cy - maj.z * len,
          ox + cx + maj.x * len,
          PAD + cy + maj.z * len,
          255,
          176,
          64,
        );
        // minor: cyan, shorter — perpendicular by construction
        const ml = len * 0.55;
        line(
          ox + cx + maj.z * ml,
          PAD + cy - maj.x * ml,
          ox + cx - maj.z * ml,
          PAD + cy + maj.x * ml,
          64,
          190,
          210,
        );
      }
    }
  }

  // panel 3 — the traced network (world → image px = ÷S)
  {
    const ox = PAD + 2 * (PW + PAD);
    const drawPoly = (
      pts: { x: number; z: number }[],
      r: number,
      g: number,
      b: number,
      thick: boolean,
    ) => {
      for (let i = 1; i < pts.length; i++) {
        const x0 = ox + pts[i - 1].x / S;
        const y0 = PAD + pts[i - 1].z / S;
        const x1 = ox + pts[i].x / S;
        const y1 = PAD + pts[i].z / S;
        line(x0, y0, x1, y1, r, g, b);
        if (thick) {
          line(x0 + 1, y0, x1 + 1, y1, r, g, b);
          line(x0, y0 + 1, x1, y1 + 1, r, g, b);
        }
      }
    };
    for (const rd of minorStreets) drawPoly(rd.vertices, 92, 116, 168, false);
    for (const rd of arterials) drawPoly(rd.vertices, 255, 190, 90, true);
  }

  writeFileSync("samples/sketch-trace.png", encodePngRGB(img, OUT_W, OUT_H));
  const totalKm =
    [...arterials, ...minorStreets].reduce((acc, rd) => {
      let m = 0;
      for (let i = 1; i < rd.vertices.length; i++)
        m += Math.hypot(
          rd.vertices[i].x - rd.vertices[i - 1].x,
          rd.vertices[i].z - rd.vertices[i - 1].z,
        );
      return acc + m;
    }, 0) / 1000;
  console.log(
    `wrote samples/sketch-trace.png (${OUT_W}x${OUT_H}) — ` +
      `${arterials.length} arterials + ${minorStreets.length} streets, ` +
      `${totalKm.toFixed(1)} km traced in ${traceMs.toFixed(0)}ms ` +
      `(page = ${WORLD_W / 1000} km wide, seed "${SEED}")`,
  );
}
main();
