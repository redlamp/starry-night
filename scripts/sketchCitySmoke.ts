/**
 * #40 sketch-city smoke test — proves:
 *  1. NO-SKETCH IDENTITY: with no sketch registered the pipeline is untouched
 *     (city hash identical before/after a register→clear round-trip).
 *  2. SKETCH CITY SANITY: a synthetic sketch field generates a real city —
 *     buildings exist, all of them sit on the sketch's ink, districts in band.
 *  3. The sketch city differs from the seeded city (the field actually drove it).
 *
 *   bun run scripts/sketchCitySmoke.ts
 */
import { generateCity } from "@/lib/seed/cityGen";
import { setCitySketch, citySketchTensor } from "@/lib/seed/citySketch";
import { setCityTier } from "@/lib/seed/topology";
import type { SketchTensorSource } from "@/lib/sketch/orientationField";

setCityTier(3); // 3 km notch (old "city")
const SEED = "gate1-0";

const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};
const cityHash = () => fnv(JSON.stringify(generateCity(SEED, "square", 1)));

// Synthetic "sketch": a whirl on the left half, a uniform diagonal grid on the
// right — the same structures the real notebook page produced, no photo needed.
// A border margin stays invalid (bare paper) to exercise the ink mask.
function syntheticSketch(): SketchTensorSource {
  const gw = 120;
  const gh = 90;
  const theta = new Float32Array(gw * gh);
  const coh = new Float32Array(gw * gh);
  const valid = new Uint8Array(gw * gh);
  const cx = gw * 0.3;
  const cy = gh * 0.5;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const g = y * gw + x;
      const margin = x < 6 || y < 6 || x >= gw - 6 || y >= gh - 6;
      if (margin) continue;
      if (x < gw * 0.55) {
        // whirl: orientation tangential around (cx, cy)
        theta[g] = Math.atan2(y - cy, x - cx) + Math.PI / 2;
      } else {
        // diagonal grid grain
        theta[g] = Math.PI / 5;
      }
      coh[g] = 0.8;
      valid[g] = 1;
    }
  }
  return { W: gw * 9, H: gh * 9, grid: 9, gw, gh, theta, coh, valid };
}

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${name.padEnd(34)} ${ok ? "PASS" : `FAIL ${detail}`}`);
  if (!ok) failed++;
};

// 1. Baseline (no sketch), then register → clear → regenerate: identical.
const baseline = cityHash();
setCitySketch(syntheticSketch());
const sketchHash = cityHash();
setCitySketch(null);
check("no-sketch identity", cityHash() === baseline);

// 2. The sketch city is a different city.
check("sketch drives the city", sketchHash !== baseline);

// 3. Sketch-city sanity: buildings exist, every one on ink, districts in band.
setCitySketch(syntheticSketch());
const st = citySketchTensor();
if (!st) throw new Error("citySketchTensor() returned null with a sketch registered");
const city = generateCity(SEED, "square", 1);
check("buildings exist", city.buildings.length > 100, `${city.buildings.length}`);
const offInk = city.buildings.filter((b) => st.mask(b.x, b.z) < 0.5).length;
check("all buildings on ink", offInk === 0, `${offInk}/${city.buildings.length} off-ink`);
check(
  "district count in band",
  city.districts.length >= 2 && city.districts.length <= 48,
  `${city.districts.length}`,
);
const roads = [...city.arterials, ...city.streets];
check("roads exist", roads.length > 20, `${roads.length}`);
let offInkVerts = 0;
let totalVerts = 0;
for (const r of roads) {
  for (const v of r.vertices) {
    totalVerts++;
    if (st.mask(v.x, v.z) < 0.5) offInkVerts++;
  }
}
// Streamlines stop AT the mask edge, so a vertex can sit marginally outside.
check(
  "roads on ink (≤1% edge verts)",
  offInkVerts / totalVerts <= 0.01,
  `${offInkVerts}/${totalVerts}`,
);
setCitySketch(null);

console.log(failed === 0 ? "\nSKETCH-CITY SMOKE PASS" : `\nSKETCH-CITY SMOKE FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
