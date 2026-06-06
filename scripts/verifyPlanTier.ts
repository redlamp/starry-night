/**
 * Browser-free verification for the /plan tier-aware framing (PlanView now maps
 * world→px with half = CITY_TIERS[citySize] instead of the fixed 1500m default).
 * Renders one PlanView-style panel per tier for the same seed — buildings +
 * roads, framed at that tier's full extent — plus numeric coverage: max building
 * radius vs the tier frame, and what the OLD fixed-1500 frame would have shown.
 * Dependency-free PNG (node:zlib). Delete after review.
 *   bun run scripts/verifyPlanTier.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { generateCity, tensorDistrictField } from "@/lib/seed/cityGen";
import { CITY_CENTER, CITY_TIERS, setCityTier, type CityTier } from "@/lib/seed/topology";

const SEED = "plan-0"; // the default /plan first tile
const TIERS: CityTier[] = [1, 3, 8];
const PANEL = 420;
const PAD = 8;

const W = TIERS.length * PANEL + (TIERS.length + 1) * PAD;
const H = PANEL + 2 * PAD;
const img = new Uint8Array(W * H * 3);

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
function line(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    px(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), r, g, b);
  }
}

for (let s = 0; s < TIERS.length; s++) {
  const tier = TIERS[s];
  setCityTier(tier);
  const half = CITY_TIERS[tier]; // the NEW PlanView frame
  const city = generateCity(SEED);
  const field = tensorDistrictField(SEED);
  const ox = PAD + s * (PANEL + PAD);
  const oy = PAD;
  const mPerPx = (2 * half) / PANEL;

  for (let yy = 0; yy < PANEL; yy++) for (let xx = 0; xx < PANEL; xx++) px(ox + xx, oy + yy, 11, 16, 32);

  const toX = (wx: number) => ox + Math.round((wx - (CITY_CENTER.x - half)) / mPerPx);
  const toY = (wz: number) => oy + Math.round((wz - (CITY_CENTER.z - half)) / mPerPx);

  // roads, PlanView draw order + colors: streets, arterials, highways
  for (const [set, col] of [
    [city.streets, "#54627a"],
    [city.arterials, "#7fa8d0"],
    [city.topology.highways, "#f0c850"],
  ] as const) {
    const [r, g, b] = hexRGB(col);
    for (const road of set) {
      const v = road.vertices;
      for (let i = 1; i < v.length; i++) line(toX(v[i - 1].x), toY(v[i - 1].z), toX(v[i].x), toY(v[i].z), r, g, b);
      if (road.closed && v.length > 2)
        line(toX(v[v.length - 1].x), toY(v[v.length - 1].z), toX(v[0].x), toY(v[0].z), r, g, b);
    }
  }

  // buildings, district-coloured like PlanView
  const colorById = new Map(field.districts.map((d) => [d.id, hexRGB(d.color)]));
  let maxR = 0;
  let inOld1500 = 0;
  for (const b of city.buildings) {
    const [r, g, bl] = colorById.get(b.districtId) ?? [136, 136, 136];
    px(toX(b.x), toY(b.z), r, g, bl);
    const rad = Math.max(Math.abs(b.x - CITY_CENTER.x), Math.abs(b.z - CITY_CENTER.z));
    if (rad > maxR) maxR = rad;
    if (rad <= 1500) inOld1500++;
  }

  const pct = ((100 * inOld1500) / city.buildings.length).toFixed(1);
  console.log(
    `tier ${tier} (${(2 * half) / 1000} km): ${city.buildings.length} buildings, ` +
      `max |coord-center| ${Math.round(maxR)}m vs frame ${half}m (${(maxR / half).toFixed(2)}x) — ` +
      `old fixed-1500 frame would show ${pct}%`,
  );
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
  raw[y * (stride + 1)] = 0;
  raw.set(img.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
}
const ihdr = new Uint8Array([...u32(W), ...u32(H), 8, 2, 0, 0, 0]);
const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const png = new Uint8Array([
  ...sig,
  ...chunk("IHDR", ihdr),
  ...chunk("IDAT", deflateSync(raw)),
  ...chunk("IEND", new Uint8Array()),
]);
writeFileSync("samples/verify-plan-tier.png", png);
console.log(`wrote samples/verify-plan-tier.png (${W}x${H}) — tiers ${TIERS.join(", ")}, seed ${SEED}`);
