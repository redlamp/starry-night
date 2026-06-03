/**
 * One-off perf profile of the city-gen pipeline at MAX (Metro) extent.
 *   bun run scripts/profileGen.ts
 * Times the three phases separately (roads / districts / buildings-etc) so we can
 * see where the generation cost actually goes. Wall-time via Date.now() is fine here
 * — this is a profiling script, not scene state.
 */
import { generateCity } from "@/lib/seed/cityGen";
import { generateTensorStreets } from "@/lib/seed/tensorStreets";
import { generateDistrictsFromNetwork } from "@/lib/seed/district";
import { generateTopology, CITY_CENTER, MAX_HALF_EXTENT } from "@/lib/seed/topology";

const ms = () => Date.now();
const bounds = {
  minX: CITY_CENTER.x - MAX_HALF_EXTENT,
  maxX: CITY_CENTER.x + MAX_HALF_EXTENT,
  minZ: CITY_CENTER.z - MAX_HALF_EXTENT,
  maxZ: CITY_CENTER.z + MAX_HALF_EXTENT,
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
