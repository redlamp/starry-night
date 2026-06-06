/**
 * One-off perf profile of the city-gen pipeline at MAX (Metro) extent.
 *   bun run scripts/profileGen.ts
 * Times the three phases separately (roads / districts / buildings-etc) so we can
 * see where the generation cost actually goes. Wall-time via Date.now() is fine here
 * — this is a profiling script, not scene state.
 */
import { generateCity } from "@/lib/seed/cityGen";
import {
  generateTensorStreets,
  startStreetsProfile,
  endStreetsProfile,
} from "@/lib/seed/tensorStreets";
import { generateDistrictsFromNetwork } from "@/lib/seed/district";
import { generateTopology, CITY_CENTER, maxHalfExtent, setCityTier } from "@/lib/seed/topology";

setCityTier(6); // profile at the 6 km notch — the #63 baseline (old "metro")

const ms = () => Date.now();
const bounds = {
  minX: CITY_CENTER.x - maxHalfExtent(),
  maxX: CITY_CENTER.x + maxHalfExtent(),
  minZ: CITY_CENTER.z - maxHalfExtent(),
  maxZ: CITY_CENTER.z + maxHalfExtent(),
};

generateTensorStreets("warmup", bounds); // JIT warm-up (untimed)

const SEEDS = ["gate1-0", "gate1-1", "gate1-2"];
console.log("city-gen phase timings at MAX (Metro, half 3000) — ms\n");
console.log("seed        roads  districts  build+etc    total   buildings  streets");
for (const seed of SEEDS) {
  let t = ms();
  const streets = generateTensorStreets(seed, bounds); // tensor field build + RK4 streamlines
  const tRoads = ms() - t;

  const topo = generateTopology(seed);
  const walls = [...topo.highways, ...streets.arterials];
  t = ms();
  generateDistrictsFromNetwork(seed, walls, topo); // raster flood-fill + merge
  const tDist = ms() - t;

  t = ms();
  const city = generateCity(seed); // full pipeline (roads + districts + buildings + freeways)
  const tTotal = ms() - t;

  const tRest = tTotal - tRoads - tDist; // ≈ building fill + freeways + overhead
  const nStreets = streets.arterials.length + streets.minorStreets.length;
  console.log(
    `${seed.padEnd(10)} ${String(tRoads).padStart(6)} ${String(tDist).padStart(10)} ${String(tRest).padStart(9)} ${String(tTotal).padStart(8)} ${String(city.buildings.length).padStart(11)} ${String(nStreets).padStart(8)}`,
  );
}

// ---------------------------------------------------------------------------
// #63 — where inside the roads phase does the time go? Profiled re-run, kept
// separate from the clean runs above so the headline numbers stay undistorted.

// Calibrate the cost of one performance.now() pair: fieldMs carries one pair
// per sample call, so subtract pairCost × fieldSamples to de-bias it.
const CAL_N = 2_000_000;
let calAcc = 0;
const calT0 = performance.now();
for (let i = 0; i < CAL_N; i++) calAcc += performance.now() - performance.now();
const pairCostMs = (performance.now() - calT0) / CAL_N;
void calAcc;

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (part: number, whole: number) => `${((100 * part) / whole).toFixed(0)}%`;

console.log(`\n#63 roads-phase breakdown (profiled re-run; timer pair ≈ ${(pairCostMs * 1e6).toFixed(0)}ns)\n`);
for (const seed of SEEDS) {
  startStreetsProfile();
  const t0 = performance.now();
  generateTensorStreets(seed, bounds);
  const total = performance.now() - t0;
  const p = endStreetsProfile()!;

  const fieldAdj = Math.max(0, p.fieldMs - p.fieldSamples * pairCostMs);
  const traceMs = p.acceptedTraceMs + p.rejectedTraceMs;
  const inTraceOther = traceMs - p.fieldMs - p.blockedMs; // rk4 alloc, mask, bounds
  const outsideTrace = total - traceMs; // field build, seed gen, sort, toPolys

  console.log(`${seed} — roads ${total.toFixed(0)}ms profiled`);
  console.log(
    `  field.sample   ${fmt(p.fieldSamples).padStart(11)} calls  ${fieldAdj.toFixed(0).padStart(6)}ms (${pct(fieldAdj, total)})  [raw ${p.fieldMs.toFixed(0)}ms]`,
  );
  console.log(
    `  blocked/isFree ${fmt(p.isFreeCalls).padStart(11)} calls  ${p.blockedMs.toFixed(0).padStart(6)}ms (${pct(p.blockedMs, total)})`,
  );
  console.log(
    `  traces         accepted ${fmt(p.tracesAccepted)} (${p.acceptedTraceMs.toFixed(0)}ms, ${fmt(p.acceptedPts)} pts) | rejected ${fmt(p.tracesRejected)} (${p.rejectedTraceMs.toFixed(0)}ms, ${pct(p.rejectedTraceMs, total)})`,
  );
  console.log(
    `  tiers ms       majA ${p.tiers.majA.toFixed(0)} | minA ${p.tiers.minA.toFixed(0)} | majS ${p.tiers.majS.toFixed(0)} | minS ${p.tiers.minS.toFixed(0)}`,
  );
  console.log(
    `  in-trace other ${inTraceOther.toFixed(0)}ms (${pct(inTraceOther, total)})  | outside traces ${outsideTrace.toFixed(0)}ms (${pct(outsideTrace, total)})\n`,
  );
}
