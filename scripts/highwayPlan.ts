/**
 * #13 visual verification — freeway network + interchange glow. Renders 3 metro
 * seeds: streets dim, arterials mid, HIGHWAYS bold gold, streetlights as dots
 * (highway-tier bright, so the interchange cloverleaf loops read).
 *   bun run scripts/highwayPlan.ts
 * Output: samples/highway-plan.png
 */
import { writeFileSync } from "node:fs";
import { generateCity, generateStreetlights } from "@/lib/seed/cityGen";
import { CITY_CENTER, maxHalfExtent, setCityTier } from "@/lib/seed/topology";
import { encodePngRGB } from "./sketchField";

// args: [tier] [seed...] — e.g. `bun run scripts/highwayPlan.ts city plan-3 plan-4`
const args = process.argv.slice(2);
const TIER = args[0] === "town" || args[0] === "city" || args[0] === "metro" ? args[0] : "metro";
const seedArgs = args[0] === TIER ? args.slice(1) : args;
setCityTier(TIER);

const SEEDS = seedArgs.length
  ? seedArgs
  : ["gate1-0", "gate1-1", "gate1-2", "gate1-3", "gate1-4", "gate1-5"];
const COLS = 3;
const PANEL = 560;
const PAD = 8;
const SPAN = 2 * maxHalfExtent();
const mPerPx = SPAN / PANEL;
const W = COLS * PANEL + (COLS + 1) * PAD;
const ROWS = Math.ceil(SEEDS.length / COLS);
const H = ROWS * PANEL + (ROWS + 1) * PAD;
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

for (let s = 0; s < SEEDS.length; s++) {
  const ox = PAD + (s % COLS) * (PANEL + PAD);
  const oy = PAD + Math.floor(s / COLS) * (PANEL + PAD);
  for (let yy = 0; yy < PANEL; yy++)
    for (let xx = 0; xx < PANEL; xx++) px(ox + xx, oy + yy, 8, 11, 22);
  const toPx = (wx: number, wz: number) => ({
    x: ox + (wx - (CITY_CENTER.x - maxHalfExtent())) / mPerPx,
    y: oy + (wz - (CITY_CENTER.z - maxHalfExtent())) / mPerPx,
  });
  const line = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    r: number,
    g: number,
    bl: number,
    thick = false,
  ) => {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) | 0;
    for (let t = 0; t <= steps; t++) {
      const f = steps ? t / steps : 0;
      const xx = a.x + (b.x - a.x) * f;
      const yy = a.y + (b.y - a.y) * f;
      px(xx, yy, r, g, bl);
      if (thick) {
        px(xx + 1, yy, r, g, bl);
        px(xx, yy + 1, r, g, bl);
      }
    }
  };

  const city = generateCity(SEEDS[s]);
  const lights = generateStreetlights(SEEDS[s]);
  for (const rd of city.streets)
    for (let i = 1; i < rd.vertices.length; i++)
      line(
        toPx(rd.vertices[i - 1].x, rd.vertices[i - 1].z),
        toPx(rd.vertices[i].x, rd.vertices[i].z),
        26,
        32,
        48,
      );
  for (const rd of city.arterials)
    for (let i = 1; i < rd.vertices.length; i++)
      line(
        toPx(rd.vertices[i - 1].x, rd.vertices[i - 1].z),
        toPx(rd.vertices[i].x, rd.vertices[i].z),
        58,
        70,
        100,
      );
  for (const l of lights) {
    const p = toPx(l.x, l.z);
    if (l.tier === "highway") px(p.x, p.y, 255, 226, 150);
    else px(p.x, p.y, 60, 54, 36);
  }
  for (const hw of city.topology.highways)
    for (let i = 1; i < hw.vertices.length; i++)
      line(
        toPx(hw.vertices[i - 1].x, hw.vertices[i - 1].z),
        toPx(hw.vertices[i].x, hw.vertices[i].z),
        255,
        186,
        70,
        true,
      );

  console.log(
    `${SEEDS[s]}: ${city.topology.highways.length} highways, ` +
      `${lights.filter((l) => l.tier === "highway").length} highway-tier lights`,
  );
}

writeFileSync("samples/highway-plan.png", encodePngRGB(img, W, H));
console.log(
  `wrote samples/highway-plan.png (${W}x${H}) — gold = highways, bright dots = highway lights`,
);

// Count survey at the smaller tiers — shows the per-seed roll (0 possible).
// Skipped when explicit seeds were passed (single-case reproduction).
if (!seedArgs.length) {
  for (const tier of ["town", "city"] as const) {
    setCityTier(tier);
    const counts: number[] = [];
    for (let i = 0; i < 12; i++) counts.push(generateCity(`gate1-${i}`).topology.highways.length);
    console.log(`${tier} highway counts (12 seeds): ${counts.join(" ")}`);
  }
}
