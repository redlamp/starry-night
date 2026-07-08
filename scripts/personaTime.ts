import { generateCity } from "../lib/seed/cityGen";
import { buildCityNames } from "../lib/seed/naming";
import { buildPersonaDirectory } from "../lib/seed/personas";

const seed = "starry-night";
let t = performance.now();
generateCity(seed);
console.log("generateCity (cold):", Math.round(performance.now() - t), "ms");
t = performance.now();
buildCityNames(seed);
console.log("buildCityNames (cold, incl addresses):", Math.round(performance.now() - t), "ms");
t = performance.now();
buildPersonaDirectory(seed);
console.log("buildPersonaDirectory (cold, after names):", Math.round(performance.now() - t), "ms");
t = performance.now();
buildPersonaDirectory(seed);
console.log("buildPersonaDirectory (warm):", Math.round(performance.now() - t), "ms");
