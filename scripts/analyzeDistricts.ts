/**
 * One-off diagnostic for the density-gradient feedback (#49):
 * "more districts, gradiate to low density sooner, high-rise too abundant."
 *   bun run scripts/analyzeDistricts.ts
 * Measures — at the Metro tier — district count + character mix, and the radial
 * density profile: high-rise footprint share + mean height in concentric rings.
 * The R≤1500 ring is the City-crop view. Pure measurement; no scene state.
 */
import { generateCity } from "@/lib/seed/cityGen";
import { CITY_CENTER, setCityTier } from "@/lib/seed/topology";

setCityTier(6); // measure at the 6 km notch (#58, old "metro") — the worst case for the gradient

const SEEDS = Array.from({ length: 10 }, (_, i) => `gate1-${i}`);
const RINGS = [0, 500, 1000, 1500, 2250, 3000]; // m from centre; 1500 = City-crop edge

const charCounts: Record<string, number> = {};
let totalDistricts = 0;

console.log("per-seed district count + character mix (Metro tier, half 3000)\n");
console.log("seed         nDist  characters");
for (const seed of SEEDS) {
  const city = generateCity(seed);
  totalDistricts += city.districts.length;
  const mix: Record<string, number> = {};
  for (const d of city.districts) {
    mix[d.character] = (mix[d.character] ?? 0) + 1;
    charCounts[d.character] = (charCounts[d.character] ?? 0) + 1;
  }
  const mixStr = Object.entries(mix)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${n}`)
    .join(" ");
  console.log(`${seed.padEnd(12)} ${String(city.districts.length).padStart(5)}  ${mixStr}`);
}
console.log(
  `\nmean districts/city: ${(totalDistricts / SEEDS.length).toFixed(1)}   overall mix:`,
  Object.entries(charCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${(n / SEEDS.length).toFixed(1)}`)
    .join("  "),
);

// Radial density profile — footprint-area share that is high-rise ("downtown"
// lighting class = downtown+subcentre) + mean building height, per ring.
console.log(
  "\nradial profile (averaged over seeds) — high-rise footprint share | mean height (m)\n",
);
const header = RINGS.slice(0, -1)
  .map((lo, i) => `${lo}-${RINGS[i + 1]}m`.padStart(12))
  .join("");
console.log("            " + header);

const hrShareSum = new Array(RINGS.length - 1).fill(0);
const meanHSum = new Array(RINGS.length - 1).fill(0);
for (const seed of SEEDS) {
  const city = generateCity(seed);
  const areaTot = new Array(RINGS.length - 1).fill(0);
  const areaHR = new Array(RINGS.length - 1).fill(0);
  const hSum = new Array(RINGS.length - 1).fill(0);
  const hCnt = new Array(RINGS.length - 1).fill(0);
  for (const b of city.buildings) {
    const r = Math.hypot(b.x - CITY_CENTER.x, b.z - CITY_CENTER.z);
    let ring = -1;
    for (let i = 0; i < RINGS.length - 1; i++) if (r >= RINGS[i] && r < RINGS[i + 1]) ring = i;
    if (ring < 0) continue;
    const fp = b.width * b.depth;
    areaTot[ring] += fp;
    if (b.district === "downtown") areaHR[ring] += fp;
    hSum[ring] += b.height;
    hCnt[ring]++;
  }
  for (let i = 0; i < RINGS.length - 1; i++) {
    hrShareSum[i] += areaTot[i] > 0 ? areaHR[i] / areaTot[i] : 0;
    meanHSum[i] += hCnt[i] > 0 ? hSum[i] / hCnt[i] : 0;
  }
}
const hrRow =
  "high-rise % " +
  hrShareSum.map((s) => `${((s / SEEDS.length) * 100).toFixed(0)}%`.padStart(12)).join("");
const hRow =
  "mean h (m)  " + meanHSum.map((s) => `${(s / SEEDS.length).toFixed(0)}m`.padStart(12)).join("");
console.log(hrRow);
console.log(hRow);
console.log("\nthe 0-1500m columns are the City-crop view — high-rise % there is the key metric.");
