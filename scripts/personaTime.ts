import { generateCity } from "../lib/seed/cityGen";
import { buildCityNames } from "../lib/seed/naming";
import { buildPersonaDirectory } from "../lib/seed/personas";
import { ensureAllStories, ensureBuildingStories } from "../lib/seed/personaStory";

const seed = "starry-night";
let t = performance.now();
generateCity(seed);
console.log("generateCity (cold):", Math.round(performance.now() - t), "ms");
t = performance.now();
buildCityNames(seed);
console.log("buildCityNames (cold, incl addresses):", Math.round(performance.now() - t), "ms");
t = performance.now();
const dir = buildPersonaDirectory(seed);
console.log("buildPersonaDirectory (cold, after names):", Math.round(performance.now() - t), "ms");
t = performance.now();
buildPersonaDirectory(seed);
console.log("buildPersonaDirectory (warm):", Math.round(performance.now() - t), "ms");
// Lazy tier (2026-07-10): one building = what a card open pays; all = the
// old eager pass 5, now only the writing lab / audit scripts pay it.
const firstBuilding = dir.byHomeBuilding.keys().next().value;
if (firstBuilding !== undefined) {
  t = performance.now();
  ensureBuildingStories(seed, dir, firstBuilding);
  console.log(
    "ensureBuildingStories (first building, incl weave-state init):",
    Math.round(performance.now() - t),
    "ms",
  );
}
t = performance.now();
ensureAllStories(seed, dir);
console.log("ensureAllStories (whole city, cold):", Math.round(performance.now() - t), "ms");
