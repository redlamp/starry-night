/**
 * Browser-free tensor-FIELD render for the #51 variety work. Samples
 * buildTensorField on a grid per seed and draws a short tick at each sample,
 * coloured by major-eigenvector angle (hue) — the same read as TensorFieldOverlay,
 * but to a PNG so we can eyeball the variety across many seeds at once.
 *   bun run scripts/renderFields.ts [seedPrefix] [count]
 * Dependency-free PNG (node:zlib). Delete after review.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { computeLattice } from "@/lib/seed/lattice";
import { buildTensorField } from "@/lib/seed/tensorField";
import { CITY_CENTER, maxHalfExtent, setCityTier } from "@/lib/seed/topology";

setCityTier(6); // render fields at the 6 km notch (#58, old "metro")

const PREFIX = process.argv[2] ?? "field";
const COUNT = parseInt(process.argv[3] ?? "12", 10);
const COLS = 4;
const rows = Math.ceil(COUNT / COLS);
const PANEL = 300;
const PAD = 6;
const GRID = 34; // samples/axis per panel
const TICK = PANEL / GRID; // tick spacing (px)

const W = COLS * PANEL + (COLS + 1) * PAD;
const H = rows * (PANEL + 18) + PAD;
const img = new Uint8Array(W * H * 3);

function px(x: number, y: number, r: number, g: number, b: number) {
  x |= 0;
  y |= 0;
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  img[i] = r;
  img[i + 1] = g;
  img[i + 2] = b;
}
// HSL→RGB (s,l in 0..1, h in 0..1)
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function line(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) {
  const dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy,
    x = x0,
    y = y0;
  for (;;) {
    px(x, y, r, g, b);
    if (Math.abs(x - x1) < 1 && Math.abs(y - y1) < 1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

const span = 2 * maxHalfExtent();
const mPerPx = span / PANEL;
for (let s = 0; s < COUNT; s++) {
  const seed = `${PREFIX}-${s}`;
  const lattice = computeLattice(seed);
  const field = buildTensorField(seed, lattice);
  const col = s % COLS;
  const row = Math.floor(s / COLS);
  const ox = PAD + col * (PANEL + PAD);
  const oy = PAD + row * (PANEL + 18);
  for (let yy = 0; yy < PANEL; yy++)
    for (let xx = 0; xx < PANEL; xx++) px(ox + xx, oy + yy, 10, 12, 22);
  // count radial bases for the label tint
  const radial = field.basis.filter((b) => b.kind === "radial").length;

  for (let gi = 0; gi < GRID; gi++) {
    for (let gj = 0; gj < GRID; gj++) {
      const wx = CITY_CENTER.x - maxHalfExtent() + ((gi + 0.5) / GRID) * span;
      const wz = CITY_CENTER.z - maxHalfExtent() + ((gj + 0.5) / GRID) * span;
      const dir = field.sample(wx, wz, true);
      if (!dir) continue;
      const ang = Math.atan2(dir.z, dir.x);
      const hue = (((ang % Math.PI) + Math.PI) % Math.PI) / Math.PI;
      const [r, g, b] = hsl(hue, 0.8, 0.6);
      const px0 = ox + (wx - (CITY_CENTER.x - maxHalfExtent())) / mPerPx;
      const py0 = oy + (wz - (CITY_CENTER.z - maxHalfExtent())) / mPerPx;
      const L = TICK * 0.42;
      line(px0 - dir.x * L, py0 - dir.z * L, px0 + dir.x * L, py0 + dir.z * L, r, g, b);
    }
  }
  // label bar: width-coded radial count (red pip if a radial basis present)
  for (let xx = 0; xx < PANEL; xx++) px(ox + xx, oy + PANEL + 2, 30, 34, 46);
  if (radial > 0) for (let xx = 0; xx < 40; xx++) px(ox + xx, oy + PANEL + 2, 220, 70, 70);
}

// ---- minimal PNG (RGB) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const td = new Uint8Array([...t, ...data]);
  return new Uint8Array([...u32(data.length), ...td, ...u32(crc32(td))]);
}
const stride = W * 3;
const raw = new Uint8Array((stride + 1) * H);
for (let y = 0; y < H; y++)
  raw.set(img.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
const ihdr = new Uint8Array([...u32(W), ...u32(H), 8, 2, 0, 0, 0]);
const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const png = new Uint8Array([
  ...sig,
  ...chunk("IHDR", ihdr),
  ...chunk("IDAT", deflateSync(raw)),
  ...chunk("IEND", new Uint8Array()),
]);
const out = `samples/fields-${PREFIX}.png`;
writeFileSync(out, png);
console.log(`wrote ${out} (${W}x${H}) — ${COUNT} seeds; red pip = has a radial basis`);
