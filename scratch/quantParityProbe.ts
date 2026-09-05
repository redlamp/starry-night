/**
 * 2026-09-05 probe for the narrowed city-golden contract (see
 * wiki/notes/decision-cross-runtime-determinism.md, "Spike results" +
 * "Contract (2026-09-05)"). After merging spike/deterministic-math, the
 * documented lattice tie-break is fixed but full byte-identity still isn't
 * (99 more transcendental call sites across 14 files, deferred to 2.0).
 *
 * This probe answers two questions for all 10 gate1 seeds, run under both
 * `bun run scratch/quantParityProbe.ts` and `bunx tsx scratch/quantParityProbe.ts`:
 *   1. Are the proposed STRUCTURAL fields (counts, orientHash) identical
 *      between the two runs (they should already be, per the spike)?
 *   2. Is there any quantization grid (1m / 0.1m / 0.01m) fine enough that
 *      hashing quantized building positions/footprints, road vertices, and
 *      district centroids is ALSO identical cross-engine? If yes at some
 *      quantum, that's free extra golden coverage on top of the counts.
 *
 * Prints one line per seed per quantum; compare the two engines' output by eye
 * (or diff two captured runs) since this is a one-off probe, not a gate script.
 */
import { generateCity, generateStreetlights } from "@/lib/seed/cityGen";
import { computeLattice } from "@/lib/seed/lattice";
import { CITY_CENTER, setCityTier } from "@/lib/seed/topology";

setCityTier(6);

const SEEDS = Array.from({ length: 10 }, (_, i) => `gate1-${i}`);
const QUANTA = [1, 0.1, 0.01];

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function q(v: number, quantum: number): number {
  return Math.round(v / quantum);
}

for (const seed of SEEDS) {
  const city = generateCity(seed);
  const lights = generateStreetlights(seed);
  const L = computeLattice(seed);

  let grid = "";
  for (let x = -1500; x <= 1500; x += 150) {
    for (let z = -1500; z <= 1500; z += 150) {
      grid += L.orientationAt(CITY_CENTER.x + x, CITY_CENTER.z + z).toFixed(6) + ";";
    }
  }

  const perDistrict = new Map<string, number>();
  for (const b of city.buildings)
    perDistrict.set(b.districtId, (perDistrict.get(b.districtId) ?? 0) + 1);
  const perDistrictCounts = [...perDistrict.values()].sort((a, b) => a - b);

  console.log(
    `${seed}  bldg=${city.buildings.length} dist=${city.districts.length} ` +
      `roads=${city.arterials.length + city.streets.length} hwy=${city.topology.highways.length} ` +
      `lights=${lights.length} orientHash=${hash(grid)} perDistrict=${hash(JSON.stringify(perDistrictCounts))}`,
  );

  for (const quantum of QUANTA) {
    // Quantize rotationY at a finer angular quantum (rad, not metres) since a
    // building's footprint rotation is unitless — reuse the same divisor so the
    // "1/0.1/0.01" sweep still reads as one quantization scale across fields.
    const bParts = city.buildings.map(
      (b) =>
        `${q(b.x, quantum)},${q(b.z, quantum)},${q(b.width, quantum)},${q(b.depth, quantum)},${q(b.rotationY, quantum)}`,
    );
    const rParts = [...city.arterials, ...city.streets, ...city.topology.highways].map((r) =>
      r.vertices.map((v) => `${q(v.x, quantum)},${q(v.z, quantum)}`).join("|"),
    );
    const dParts = city.districts.map(
      (d) => `${q(d.centroidX, quantum)},${q(d.centroidZ, quantum)}`,
    );
    console.log(
      `  q=${quantum}  buildings=${hash(bParts.join(";"))} roads=${hash(rParts.join(";"))} ` +
        `districts=${hash(dParts.join(";"))}`,
    );
  }
}
