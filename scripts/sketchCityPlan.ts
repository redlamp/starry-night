/**
 * #40 visual verification — the notebook sketch as a FULL CITY. Recovers the
 * sketch field from the photo, registers it as the city sketch, runs the real
 * generator (roads → districts → buildings → lights), and renders the plan:
 * buildings coloured by district character, roads, streetlight dots — beside
 * the seeded no-sketch city for the same seed.
 *
 *   bun run scripts/sketchCityPlan.ts [imagePath] [seed]
 *
 * Output: samples/sketch-city.png (left: sketch city, right: seeded city)
 */
import { writeFileSync } from "node:fs";
import { generateCity, generateStreetlights } from "@/lib/seed/cityGen";
import { setCitySketch } from "@/lib/seed/citySketch";
import { CITY_CENTER, maxHalfExtent, setCityTier } from "@/lib/seed/topology";
import { CHARACTER_COLOR } from "@/lib/seed/district";
import { toSketchTensorSource } from "@/lib/sketch/orientationField";
import { recoverSketchField, encodePngRGB } from "./sketchField";

const IMAGE = process.argv[2] ?? "C:/Users/taylo/Downloads/IMG_20191205_082043.jpg";
const SEED = process.argv[3] ?? "sketch";

setCityTier("city");

const PANEL = 760;
const PAD = 8;
const SPAN = 2 * maxHalfExtent();
const mPerPx = SPAN / PANEL;
const W = 2 * PANEL + 3 * PAD;
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

function renderPanel(panel: number, label: string) {
  const ox = PAD + panel * (PANEL + PAD);
  const oy = PAD;
  for (let yy = 0; yy < PANEL; yy++)
    for (let xx = 0; xx < PANEL; xx++) px(ox + xx, oy + yy, 10, 14, 26);

  const toPx = (wx: number, wz: number) => ({
    x: ox + Math.round((wx - (CITY_CENTER.x - maxHalfExtent())) / mPerPx),
    y: oy + Math.round((wz - (CITY_CENTER.z - maxHalfExtent())) / mPerPx),
  });

  const city = generateCity(SEED, "square", 1);
  const lights = generateStreetlights(SEED, "square", 1);

  // roads first (dim), then lights, then buildings on top
  for (const r of [...city.streets, ...city.arterials, ...city.topology.highways]) {
    const wide = r.width > 12;
    for (let i = 1; i < r.vertices.length; i++) {
      const a = toPx(r.vertices[i - 1].x, r.vertices[i - 1].z);
      const b = toPx(r.vertices[i].x, r.vertices[i].z);
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let t = 0; t <= steps; t++) {
        const f = steps ? t / steps : 0;
        const xx = Math.round(a.x + (b.x - a.x) * f);
        const yy = Math.round(a.y + (b.y - a.y) * f);
        if (wide) px(xx, yy, 70, 80, 104);
        else px(xx, yy, 38, 46, 66);
      }
    }
  }
  for (const l of lights) {
    const p = toPx(l.x, l.z);
    px(p.x, p.y, 96, 88, 58);
  }
  const charById = new Map(city.districts.map((d) => [d.id, d.character]));
  const blds = [...city.buildings].sort((a, b) => a.height - b.height);
  for (const b of blds) {
    const ch = charById.get(b.districtId) ?? "residential";
    const [r, g, bl] = hexRGB(CHARACTER_COLOR[ch]);
    const t = Math.min(1, b.height / 180);
    const k = 0.7 + 0.9 * t;
    const p = toPx(b.x, b.z);
    const rad = b.height > 70 ? 1 : 0;
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++)
        px(p.x + dx, p.y + dy, Math.min(255, r * k), Math.min(255, g * k), Math.min(255, bl * k));
  }
  console.log(
    `${label}: ${city.buildings.length} buildings, ${city.districts.length} districts, ` +
      `${city.arterials.length} arterials, ${city.streets.length} streets, ${lights.length} lights`,
  );
}

async function main() {
  const f = await recoverSketchField(IMAGE);

  setCitySketch(toSketchTensorSource(f));
  renderPanel(0, "sketch city");
  setCitySketch(null);
  renderPanel(1, "seeded city");

  writeFileSync("samples/sketch-city.png", encodePngRGB(img, W, H));
  console.log(`wrote samples/sketch-city.png (${W}x${H}) — left: sketch city, right: seeded`);
}
main();
