/**
 * #50 visual verification — block-level zoom. Renders a 900m window of the
 * city-tier layout: roads + every building as its rotated footprint outline,
 * frontage vs interior distinguishable by eye (interiors sit off the kerb line).
 *   bun run scripts/blockZoom.ts [seed] [cx] [cz]
 * Output: samples/block-zoom.png
 */
import { writeFileSync } from "node:fs";
import { generateCity } from "@/lib/seed/cityGen";
import { CITY_CENTER, setCityTier } from "@/lib/seed/topology";
import { encodePngRGB } from "./sketchField";

setCityTier("city");
const SEED = process.argv[2] ?? "gate1-0";
const CX = process.argv[3] ? parseFloat(process.argv[3]) : CITY_CENTER.x + 400;
const CZ = process.argv[4] ? parseFloat(process.argv[4]) : CITY_CENTER.z + 300;
const WIN = 900; // metres shown
const SIZE = 900; // px
const mPerPx = WIN / SIZE;

const img = new Uint8Array(SIZE * SIZE * 3);
function px(x: number, y: number, r: number, g: number, b: number) {
  x |= 0;
  y |= 0;
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 3;
  img[i] = r;
  img[i + 1] = g;
  img[i + 2] = b;
}
const toPx = (wx: number, wz: number) => ({
  x: (wx - (CX - WIN / 2)) / mPerPx,
  y: (wz - (CZ - WIN / 2)) / mPerPx,
});
function line(
  a: { x: number; y: number },
  b: { x: number; y: number },
  r: number,
  g: number,
  bl: number,
) {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) | 0;
  for (let t = 0; t <= steps; t++) {
    const f = steps ? t / steps : 0;
    px(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, r, g, bl);
  }
}

for (let i = 0; i < SIZE * SIZE; i++) {
  img[i * 3] = 10;
  img[i * 3 + 1] = 13;
  img[i * 3 + 2] = 24;
}

const city = generateCity(SEED, "square", 1);
for (const rd of [...city.streets, ...city.arterials, ...city.topology.highways]) {
  const wide = rd.width > 12;
  for (let i = 1; i < rd.vertices.length; i++) {
    line(
      toPx(rd.vertices[i - 1].x, rd.vertices[i - 1].z),
      toPx(rd.vertices[i].x, rd.vertices[i].z),
      wide ? 96 : 48,
      wide ? 108 : 58,
      wide ? 140 : 84,
    );
  }
}
let shown = 0;
for (const b of city.buildings) {
  if (Math.abs(b.x - CX) > WIN / 2 + 40 || Math.abs(b.z - CZ) > WIN / 2 + 40) continue;
  shown++;
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const corners = [
    [hw, hd],
    [hw, -hd],
    [-hw, -hd],
    [-hw, hd],
  ].map(([lx, lz]) => toPx(b.x + lx * c - lz * s, b.z + lx * s + lz * c));
  const t = Math.min(1, b.height / 100);
  const r = 140 + 100 * t;
  const g = 120 + 60 * t;
  for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4], r, g, 70);
}
writeFileSync("samples/block-zoom.png", encodePngRGB(img, SIZE, SIZE));
console.log(`wrote samples/block-zoom.png — seed ${SEED}, ${shown} buildings in a ${WIN}m window`);
