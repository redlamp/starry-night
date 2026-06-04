/**
 * Browser-free district-map render for the #49 density-gradient verification.
 * (The Playwright capture path hangs at the chromium debug-pipe handshake on this
 * box — env issue, not the app.) Generates the city at MAX and plots every
 * building coloured by its district CHARACTER, brightness scaled by height, with
 * the R1500 default-crop ring + R3000 full-extent ring drawn on top. One panel
 * per seed, side by side. Dependency-free PNG (node:zlib). Delete after review.
 *   bun run scripts/renderPlanPng.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { generateCity } from "@/lib/seed/cityGen";
import { CITY_CENTER, maxHalfExtent, setCityTier } from "@/lib/seed/topology";
import { CHARACTER_COLOR } from "@/lib/seed/district";

setCityTier("metro"); // render at the Metro tier (#58)

const SEEDS = ["gate1-0", "gate1-2", "gate1-5"];
const PANEL = 560; // px per seed panel
const PAD = 8;
const SPAN = 2 * maxHalfExtent(); // world metres mapped across a panel
const mPerPx = SPAN / PANEL;

const W = SEEDS.length * PANEL + (SEEDS.length + 1) * PAD;
const H = PANEL + 2 * PAD;
const img = new Uint8Array(W * H * 3); // RGB, inits to 0 (black)

function hexRGB(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function px(x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  img[i] = r;
  img[i + 1] = g;
  img[i + 2] = b;
}

for (let s = 0; s < SEEDS.length; s++) {
  const city = generateCity(SEEDS[s]);
  const charById = new Map(city.districts.map((d) => [d.id, d.character]));
  const ox = PAD + s * (PANEL + PAD); // panel origin x
  const oy = PAD;

  // faint panel backdrop so the disc reads
  for (let yy = 0; yy < PANEL; yy++)
    for (let xx = 0; xx < PANEL; xx++) px(ox + xx, oy + yy, 10, 14, 26);

  // world (x,z) → panel pixel. world x∈[cx−H,cx+H] → [0,PANEL]; z up = −y.
  const toPx = (wx: number, wz: number) => ({
    x: ox + Math.round((wx - (CITY_CENTER.x - maxHalfExtent())) / mPerPx),
    y: oy + Math.round((wz - (CITY_CENTER.z - maxHalfExtent())) / mPerPx),
  });

  // buildings, painter-sorted shortest→tallest so towers sit on top
  const blds = [...city.buildings].sort((a, b) => a.height - b.height);
  for (const b of blds) {
    const ch = charById.get(b.districtId) ?? "residential";
    const [r, g, bl] = hexRGB(CHARACTER_COLOR[ch]);
    // brightness by height (cap ~180m), floor high enough that the residential
    // bulk reads against the backdrop and the high-rise core still glows brighter
    const t = Math.min(1, b.height / 180);
    const k = 0.7 + 0.9 * t;
    const p = toPx(b.x, b.z);
    const rad = b.height > 70 ? 1 : 0; // tall = 3x3, else 1px
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++)
        px(p.x + dx, p.y + dy, Math.min(255, r * k), Math.min(255, g * k), Math.min(255, bl * k));
  }

  // crop rings: R1500 (default view) bright, R3000 (full extent) dim
  const cp = toPx(CITY_CENTER.x, CITY_CENTER.z);
  for (const [R, cr, cg, cb] of [
    [1500, 235, 245, 255],
    [3000, 90, 100, 120],
  ] as const) {
    const rpx = R / mPerPx;
    for (let a = 0; a < 2048; a++) {
      const ang = (a / 2048) * Math.PI * 2;
      px(
        Math.round(cp.x + Math.cos(ang) * rpx),
        Math.round(cp.y + Math.sin(ang) * rpx),
        cr,
        cg,
        cb,
      );
    }
  }
}

// ---- minimal PNG encoder (RGB, no alpha) ----
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
for (let y = 0; y < H; y++) {
  raw[y * (stride + 1)] = 0; // filter: none
  raw.set(img.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
}
const ihdr = new Uint8Array([...u32(W), ...u32(H), 8, 2, 0, 0, 0]); // 8-bit, colour type 2 (RGB)
const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const png = new Uint8Array([
  ...sig,
  ...chunk("IHDR", ihdr),
  ...chunk("IDAT", deflateSync(raw)),
  ...chunk("IEND", new Uint8Array()),
]);
writeFileSync("samples/verify-districts.png", png);
console.log(
  `wrote samples/verify-districts.png (${W}x${H}) — seeds ${SEEDS.join(", ")}; bright ring = R1500 crop, dim ring = R3000 full`,
);
