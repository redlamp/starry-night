/**
 * Sketch → tensor field prototype (#40), stage 1 — recovery visualisation.
 * Recovery math lives in lib/sketch/orientationField.ts (shared with the
 * /tensor lab page and scripts/sketchTrace.ts); this script decodes the photo
 * via sharp and renders the recovered field.
 *
 *   bun run scripts/sketchField.ts [imagePath]
 *
 * Output: samples/sketch-field.png — three panels:
 *   1. the sketch (grayscale)
 *   2. recovered ORIENTATION ticks (hue = angle mod π — the tensor view)
 *   3. implied FLOW after sign propagation (hue = full 2π angle + arrowheads)
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { recoverOrientationField, type OrientationField } from "@/lib/sketch/orientationField";

const IMAGE = process.argv[2] ?? "C:/Users/taylo/Downloads/IMG_20191205_082043.jpg";
const WORK_W = 1100; // analysis resolution

export async function recoverSketchField(imagePath: string): Promise<OrientationField> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(imagePath)
    .rotate() // honour EXIF
    .greyscale()
    .resize({ width: WORK_W })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = new Float32Array(info.width * info.height);
  for (let i = 0; i < gray.length; i++) gray[i] = data[i] / 255;
  return recoverOrientationField(gray, info.width, info.height);
}

// ---- minimal PNG encoder (RGB) — shared with sketchTrace.ts ----
export function encodePngRGB(img: Uint8Array, outW: number, outH: number): Uint8Array {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = (n: number) =>
    new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const chunk = (type: string, payload: Uint8Array) => {
    const t = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
    const td = new Uint8Array([...t, ...payload]);
    return new Uint8Array([...u32(payload.length), ...td, ...u32(crc32(td))]);
  };
  const stride = outW * 3;
  const raw = new Uint8Array((stride + 1) * outH);
  for (let y = 0; y < outH; y++)
    raw.set(img.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return new Uint8Array([
    ...new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunk("IHDR", new Uint8Array([...u32(outW), ...u32(outH), 8, 2, 0, 0, 0])),
    ...chunk("IDAT", deflateSync(raw)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

async function main() {
  const f = await recoverSketchField(IMAGE);
  const { W, H, gray, grid: GRID, gw, gh, theta, coh, valid, dirX, dirY, assigned } = f;

  // --- render: 3 panels ---
  const PAD = 8;
  const PW = W; // panel size = analysis size
  const PH = H;
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
  const hsl = (h: number, s: number, l: number): [number, number, number] => {
    const a = s * Math.min(l, 1 - l);
    const f2 = (n: number) => {
      const k = (n + h * 12) % 12;
      return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
    };
    return [f2(0), f2(8), f2(4)];
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

  // panel 1: the sketch
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const v = Math.round(gray[y * W + x] * 255);
      px(PAD + x, PAD + y, v, v, v);
    }
  // panels 2+3 backdrops
  for (let p = 1; p <= 2; p++)
    for (let y = 0; y < PH; y++)
      for (let x = 0; x < PW; x++) px(PAD + p * (PW + PAD) + x, PAD + y, 10, 12, 22);

  const L = GRID * 0.55;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const g = gy * gw + gx;
      if (!valid[g]) continue;
      const cx = (gx + 0.5) * GRID;
      const cy = (gy + 0.5) * GRID;
      // panel 2 — orientation (mod π), tick length ∝ coherence
      {
        const hue = (((theta[g] % Math.PI) + Math.PI) % Math.PI) / Math.PI;
        const [r, gc, b] = hsl(hue, 0.85, 0.6);
        const ox = PAD + (PW + PAD);
        const len = L * (0.4 + 0.6 * coh[g]);
        const dx = Math.cos(theta[g]) * len;
        const dy = Math.sin(theta[g]) * len;
        line(ox + cx - dx, PAD + cy - dy, ox + cx + dx, PAD + cy + dy, r, gc, b);
      }
      // panel 3 — implied flow (full 2π) + arrowhead
      if (assigned[g]) {
        const ang = Math.atan2(dirY[g], dirX[g]);
        const hue = (ang + Math.PI) / (2 * Math.PI);
        const [r, gc, b] = hsl(hue, 0.85, 0.6);
        const ox = PAD + 2 * (PW + PAD);
        const len = L * (0.4 + 0.6 * coh[g]);
        const hx = ox + cx + dirX[g] * len;
        const hy = PAD + cy + dirY[g] * len;
        line(ox + cx - dirX[g] * len, PAD + cy - dirY[g] * len, hx, hy, r, gc, b);
        // arrowhead fins
        const fin = (rot: number) => {
          const fa = ang + rot;
          line(hx, hy, hx + Math.cos(fa) * L * 0.45, hy + Math.sin(fa) * L * 0.45, r, gc, b);
        };
        fin((150 * Math.PI) / 180);
        fin((-150 * Math.PI) / 180);
      }
    }
  }

  writeFileSync("samples/sketch-field.png", encodePngRGB(img, OUT_W, OUT_H));
  console.log(
    `wrote samples/sketch-field.png (${OUT_W}x${OUT_H}) — ${f.validCount}/${gw * gh} cells valid, ` +
      `${f.flips} sign flips after propagation, seed coherence ${f.seedCoherence.toFixed(2)}`,
  );
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("sketchField.ts")) main();
