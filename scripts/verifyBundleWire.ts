/**
 * Regression check for lib/seed/bundleWire.ts — packBundle→unpackBundle is
 * value-EXACT (every building/light/road field round-trips), and reports the
 * clone/size win. Complements scripts/workerSmoke.ts (which exercises the wire
 * across a real Worker postMessage).
 *   bun run scripts/verifyBundleWire.ts
 *   bunx tsx scripts/verifyBundleWire.ts   # V8 (browser-engine) numbers
 */
import { createRequire } from "node:module";
import { buildCityBundle, type CityBundle } from "@/lib/seed/cityGen";
import { setCityTier } from "@/lib/seed/topology";
import { packBundle, unpackBundle } from "@/lib/seed/bundleWire";

setCityTier(6);
const ms = () => performance.now();

let fails = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    fails++;
    if (fails <= 20) console.log(`  FAIL: ${msg}`);
  }
}

function cmpRoads(a: CityBundle["roads"]["arterials"], b: CityBundle["roads"]["arterials"], label: string) {
  check(a.length === b.length, `${label} length ${a.length}≠${b.length}`);
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    check(ra.id === rb.id, `${label}[${i}].id`);
    check(ra.width === rb.width, `${label}[${i}].width`);
    check(ra.tier === rb.tier, `${label}[${i}].tier`);
    check(ra.closed === rb.closed, `${label}[${i}].closed`);
    check(ra.vertices.length === rb.vertices.length, `${label}[${i}].verts len`);
    for (let j = 0; j < ra.vertices.length; j++) {
      check(Object.is(ra.vertices[j].x, rb.vertices[j].x), `${label}[${i}].v[${j}].x`);
      check(Object.is(ra.vertices[j].z, rb.vertices[j].z), `${label}[${i}].v[${j}].z`);
    }
  }
}

const seeds = ["starry-night", "gate1-0", "gate1-5"];
for (const seed of seeds) {
  // circle (default) AND square — square shares road refs across roads.*/city.*,
  // circle clips them apart; verify both.
  for (const shape of ["circle", "square"] as const) {
    const orig = buildCityBundle(seed, shape, 1);
    const round = unpackBundle(packBundle(orig));

    cmpRoads(orig.roads.arterials, round.roads.arterials, `${seed}/${shape} roads.arterials`);
    cmpRoads(orig.roads.minorStreets, round.roads.minorStreets, `${seed}/${shape} roads.minorStreets`);
    cmpRoads(orig.city.arterials, round.city.arterials, `${seed}/${shape} city.arterials`);
    cmpRoads(orig.city.streets, round.city.streets, `${seed}/${shape} city.streets`);

    check(orig.city.buildings.length === round.city.buildings.length, `${seed}/${shape} buildings len`);
    for (let i = 0; i < orig.city.buildings.length; i++) {
      const a = orig.city.buildings[i];
      const b = round.city.buildings[i];
      for (const k of Object.keys(a) as Array<keyof typeof a>) {
        check(Object.is(a[k], b[k]), `${seed}/${shape} building[${i}].${String(k)} ${a[k]}≠${b[k]}`);
      }
    }

    check(orig.lights.length === round.lights.length, `${seed}/${shape} lights len`);
    for (let i = 0; i < orig.lights.length; i++) {
      const a = orig.lights[i];
      const b = round.lights[i];
      for (const k of Object.keys(a) as Array<keyof typeof a>) {
        check(Object.is(a[k], b[k]), `${seed}/${shape} light[${i}].${String(k)}`);
      }
    }
    // kept-native parts survive by reference identity through pack/unpack
    check(round.roads.raster === orig.roads.raster, `${seed}/${shape} raster ref`);
    check(round.roads.topology === orig.roads.topology, `${seed}/${shape} topology ref`);
  }
}

// size + clone cost: original object bundle vs packed wire (default seed/shape)
const b = buildCityBundle("starry-night", "circle", 1);
const wire = packBundle(b);
const cloneMs = (o: unknown, it: number) => {
  for (let w = 0; w < 2; w++) structuredClone(o);
  const t0 = ms();
  for (let i = 0; i < it; i++) structuredClone(o);
  return (ms() - t0) / it;
};
const jsonKB = (o: unknown) => (JSON.stringify(o).length / 1024).toFixed(0);
console.log(`\nclone (structuredClone, 10×):  object bundle ${cloneMs(b, 10).toFixed(1)}ms  →  wire ${cloneMs(wire, 10).toFixed(1)}ms`);
console.log(`json size:                     object bundle ${jsonKB(b)}KB  →  wire ${jsonKB(wire)}KB (json understates typed-array win)`);

// v8.serialize uses the same structured-clone format IndexedDB stores — the
// honest "stored bytes" number. Synchronous require (no top-level await: tsx is CJS).
try {
  const req = createRequire(import.meta.url);
  const v8 = req("node:v8") as { serialize: (o: object) => Buffer };
  const sBytes = (o: unknown) => (v8.serialize(o as object).length / 1e6).toFixed(2);
  console.log(`stored bytes (v8.serialize):   object bundle ${sBytes(b)}MB  →  wire ${sBytes(wire)}MB  (== IndexedDB footprint)`);
} catch {
  console.log("stored bytes: node:v8.serialize unavailable in this runtime");
}

console.log(`\n${fails === 0 ? "WIRE ROUND-TRIP: PASS (value-exact)" : `WIRE ROUND-TRIP: FAIL (${fails} mismatches)`}`);
process.exit(fails === 0 ? 0 : 1);
