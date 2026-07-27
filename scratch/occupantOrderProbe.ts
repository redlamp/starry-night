/** Occupant listing order (2026-07-27): top floor first, so hovering down a
 * card's list walks DOWN the building. Mirrors entityData's byFloorDesc. */
import { generateCity } from "@/lib/seed/cityGen";
import { buildPersonaDirectory } from "@/lib/seed/personas";
import { seededRng } from "@/lib/seed/rng";
import {
  tenancyLayout,
  regionForBusiness,
  regionForHousehold,
} from "@/lib/seed/tenancyLayout";
import { DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE } from "@/lib/state/sceneDefaults";

const seed = "starry-night";
const city = generateCity(seed, DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE);
const dir = buildPersonaDirectory(seed, DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE);
const byId = new Map(city.buildings.map((b) => [b.id, b]));
const districtById = new Map(city.districts.map((d) => [d.id, d]));

const byFloorDesc = <T>(items: readonly T[], floorOf: (item: T) => number): T[] =>
  items
    .map((item, i) => ({ item, i, floor: floorOf(item) }))
    .sort((a, b) => b.floor - a.floor || a.i - b.i)
    .map((e) => e.item);

// Mixed-use towers first — they exercise both lists.
const candidates = [...dir.byHomeBuilding.entries()]
  .filter(([id, hh]) => hh.length >= 3 && (dir.byWorkBuilding.get(id) ?? []).length >= 2)
  .slice(0, 3);

let fails = 0;
for (const [buildingId, households] of candidates) {
  const b = byId.get(buildingId)!;
  const businesses = dir.byWorkBuilding.get(buildingId) ?? [];
  const regions = tenancyLayout(
    b,
    households,
    businesses,
    districtById.get(b.districtId)?.character ?? "residential",
    seededRng(`${seed}::personas::tenancy::${buildingId}`),
  );
  const hhFloor = (hh: { index: number }) => regionForHousehold(regions, hh.index)?.floorStart ?? -1;
  const bizFloor = (x: { id: string }) => regionForBusiness(regions, x.id)?.floorStart ?? -1;
  const hhSorted = byFloorDesc(households, hhFloor);
  const bizSorted = byFloorDesc(businesses, bizFloor);
  const monotone = (xs: number[]) => xs.every((v, i) => i === 0 || xs[i - 1] >= v);
  const hhFloors = hhSorted.map(hhFloor);
  const bizFloors = bizSorted.map(bizFloor);
  const ok = monotone(hhFloors) && monotone(bizFloors);
  if (!ok) fails++;
  console.log(`\nbuilding ${buildingId} — ${b.floors} floors, ${b.archetype}`);
  console.log(`  households raw   : ${households.map(hhFloor).join(", ")}`);
  console.log(`  households sorted: ${hhFloors.join(", ")}  (units ${hhSorted.map((h) => h.unit ?? "-").join(", ")})`);
  console.log(`  companies raw    : ${businesses.map(bizFloor).join(", ")}`);
  console.log(`  companies sorted : ${bizFloors.join(", ")}`);
  console.log(`  top-first: ${ok ? "PASS" : "FAIL"}`);
}
console.log(`\n${candidates.length - fails}/${candidates.length} PASS`);
