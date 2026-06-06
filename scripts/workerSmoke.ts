/**
 * #59 worker smoke test — proves the city-gen worker's bundle is byte-identical
 * to the synchronous path, and that priming reconstructs an identical classify.
 *   bun run scripts/workerSmoke.ts
 * Runs under Bun's Web Worker implementation (same API the browser uses).
 */
import { buildCityBundle, tensorDistrictField, type CityBundle } from "@/lib/seed/cityGen";
import { districtFieldFromRaster } from "@/lib/seed/district";
import { setCityTier, CITY_CENTER, type CityTier } from "@/lib/seed/topology";
import type { CityGenMessage, TracedLine } from "@/lib/workers/cityGen.worker";

const SEED = "gate1-0";
const SHAPE = "circle" as const;
const SCALE = 1;
const TIER: CityTier = 3; // fast 3 km notch — identity holds for all (same code path)

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
const hashBundle = (b: CityBundle) =>
  ({
    city: fnv(JSON.stringify(b.city)),
    roads: fnv(JSON.stringify({ ...b.roads, raster: undefined })),
    raster: fnv(JSON.stringify(Array.from(b.roads.raster.label))) + `:${b.roads.raster.n}`,
    lights: fnv(JSON.stringify(b.lights)),
  }) as const;

// 1. Sync reference on this thread.
setCityTier(TIER);
const syncBundle = buildCityBundle(SEED, SHAPE, SCALE);
const syncHash = hashBundle(syncBundle);

// 2. Same request through the worker.
const worker = new Worker(new URL("../lib/workers/cityGen.worker.ts", import.meta.url), {
  type: "module",
});
const streamed: TracedLine[] = [];
const workerBundle = await new Promise<CityBundle>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("worker timed out (30s)")), 30_000);
  worker.onmessage = (e: MessageEvent<CityGenMessage>) => {
    if (e.data.type === "progress") {
      streamed.push(...e.data.lines);
      return;
    }
    clearTimeout(timer);
    if (e.data.ok) resolve(e.data.bundle);
    else reject(new Error(e.data.error));
  };
  worker.onerror = (err) => {
    clearTimeout(timer);
    reject(new Error(`worker error: ${err.message ?? err}`));
  };
  worker.postMessage({
    reqId: 1,
    seed: SEED,
    shape: SHAPE,
    scale: SCALE,
    tier: TIER,
    sketch: null,
    deviation: 1,
  });
});
worker.terminate();
const workerHash = hashBundle(workerBundle);

// 3. Compare hashes part by part.
let failed = 0;
for (const k of ["city", "roads", "raster", "lights"] as const) {
  const ok = syncHash[k] === workerHash[k];
  if (!ok) failed++;
  console.log(
    `${k.padEnd(7)} sync=${syncHash[k]}  worker=${workerHash[k]}  ${ok ? "PASS" : "FAIL"}`,
  );
}

// 4. Reconstructed classify (the worker-transfer path) must match the original
//    everywhere — sample a dense grid.
const rebuilt = districtFieldFromRaster(
  workerBundle.roads.districts,
  workerBundle.roads.bounds,
  workerBundle.roads.raster,
);
const syncField = tensorDistrictField(SEED); // cache-warm from step 1
let classifyMismatch = 0;
for (let x = -1600; x <= 1600; x += 40) {
  for (let z = -1600; z <= 1600; z += 40) {
    if (
      syncField.classify(CITY_CENTER.x + x, CITY_CENTER.z + z) !==
      rebuilt.classify(CITY_CENTER.x + x, CITY_CENTER.z + z)
    )
      classifyMismatch++;
  }
}
console.log(
  `classify reconstruction: ${classifyMismatch === 0 ? "PASS" : `FAIL (${classifyMismatch} mismatches)`}`,
);
if (classifyMismatch > 0) failed++;

// 5. Streaming (#59 Phase B): every traced road must have streamed exactly once.
//    Ring demotion + highway promotion move roads BETWEEN final buckets but
//    conserve the total, so streamed == arterials + minor + highways.
const expectedLines =
  workerBundle.roads.arterials.length +
  workerBundle.roads.minorStreets.length +
  workerBundle.roads.topology.highways.length;
const streamOk = streamed.length === expectedLines && streamed.every((l) => l.pts.length >= 4);
console.log(
  `streamed lines: ${streamed.length} (expected ${expectedLines}) ${streamOk ? "PASS" : "FAIL"}`,
);
if (!streamOk) failed++;

console.log(failed === 0 ? "\nWORKER SMOKE PASS" : `\nWORKER SMOKE FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
