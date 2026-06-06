/**
 * #58 tier sanity — gen a few seeds at each tier and print counts + timing.
 * Verifies the runtime-extent machinery yields valid cities at every tier and
 * that re-keyed caches don't leak across tiers. Wall-clock via Date.now() is
 * fine here — profiling script, not scene state.
 *   bun run scripts/tierSanity.ts
 */
import { generateCity } from "@/lib/seed/cityGen";
import { CITY_CENTER, CITY_TIERS, CITY_TIER_ORDER, setCityTier } from "@/lib/seed/topology";

const SEEDS = ["gate1-0", "gate1-1", "gate1-2"];

console.log("tier    seed       ms  buildings  districts  maxR(m)  ok");
let failed = 0;
for (const tier of CITY_TIER_ORDER) {
  setCityTier(tier);
  const slack = CITY_TIERS[tier] * 1.1;
  for (const seed of SEEDS) {
    const t0 = Date.now();
    const city = generateCity(seed);
    const ms = Date.now() - t0;
    let maxR = 0;
    for (const b of city.buildings) {
      const r = Math.max(Math.abs(b.x - CITY_CENTER.x), Math.abs(b.z - CITY_CENTER.z));
      if (r > maxR) maxR = r;
    }
    const ok =
      city.buildings.length > 100 &&
      city.districts.length >= 6 &&
      city.districts.length <= 48 &&
      maxR <= slack;
    if (!ok) failed++;
    console.log(
      `${`${tier} km`.padEnd(7)} ${seed.padEnd(8)} ${String(ms).padStart(5)} ${String(city.buildings.length).padStart(10)} ${String(city.districts.length).padStart(10)} ${String(Math.round(maxR)).padStart(8)}  ${ok ? "PASS" : "FAIL"}`,
    );
  }
}
console.log(failed === 0 ? "\nTIER SANITY PASS" : `\nTIER SANITY FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
