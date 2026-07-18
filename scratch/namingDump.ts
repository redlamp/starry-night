// #90 identity-verification script: dumps a deterministic sample of generated
// street/line names for fixed seeds, to diff before/after the naming-packs
// refactor. Throwaway — delete once the diff is confirmed clean.
import { buildCityNames } from "../lib/seed/naming";

const SEEDS = ["starry-night", "verify-seed-2"];

for (const seed of SEEDS) {
  const names = buildCityNames(seed);
  console.log(`=== seed: ${seed} ===`);
  console.log(`city: ${names.city.name}`);
  console.log(`university: ${names.city.university}`);
  console.log(`college: ${names.city.college}`);
  console.log(`hospital: ${names.city.hospital}`);
  console.log(`newspaper: ${names.city.newspaper}`);
  console.log(`transitLine: ${names.city.transitLine}`);
  console.log(`busLines: ${names.city.busLines.join(" | ")}`);
  console.log("-- streets --");
  const streetNames = [...names.streetNames.values()].sort();
  for (const s of streetNames) console.log(s);
  console.log("-- districts --");
  const districtNames = [...names.districtNames.values()].sort();
  for (const d of districtNames) console.log(d);
  console.log("-- building names (sample 40) --");
  const buildingNames = [...names.buildingNames.values()].sort();
  for (const b of buildingNames.slice(0, 40)) console.log(b);
  console.log("-- addresses (sample 20, sorted by street+number) --");
  const addrs = [...names.addresses.values()]
    .map((a) => `${a.street} #${a.number}`)
    .sort();
  for (const a of addrs.slice(0, 20)) console.log(a);
  console.log();
}
