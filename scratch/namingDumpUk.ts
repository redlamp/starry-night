import { buildCityNames, setNamingRegion } from "../lib/seed/naming";

setNamingRegion("uk");
const SEEDS = ["starry-night", "verify-seed-2"];
for (const seed of SEEDS) {
  const names = buildCityNames(seed);
  console.log(`=== seed: ${seed} (uk) ===`);
  const streetNames = [...names.streetNames.values()].sort();
  for (const s of streetNames) console.log(s);
  console.log();
}
