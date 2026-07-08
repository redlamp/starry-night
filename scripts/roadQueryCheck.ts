// Road-hover query sanity: for sample points ON known roads the query must
// return that road; for points far from any road it must return null.
import { generateCity } from "../lib/seed/cityGen";
import { roadQueryFor, buildCityNames } from "../lib/seed/naming";

const seed = process.argv[2] ?? "starry-night";
const city = generateCity(seed);
const q = roadQueryFor(seed);
const names = buildCityNames(seed);

let pass = 0;
let fail = 0;
const sampleRoads = [...city.arterials.slice(0, 3), ...city.streets.slice(0, 3), ...city.topology.highways.slice(0, 1)];
for (const road of sampleRoads) {
  const v = road.vertices[Math.floor(road.vertices.length / 2)];
  const hit = q.nearestRoad(v.x, v.z);
  const ok = hit?.roadId === road.id;
  if (ok) pass++;
  else {
    fail++;
    console.log(`MISS: expected ${road.id} at (${v.x.toFixed(0)},${v.z.toFixed(0)}), got ${hit?.roadId ?? "null"} (${hit?.dist.toFixed(1) ?? "-"}m)`);
  }
  if (ok) {
    const buildings = names.buildingsByRoad.get(road.id) ?? [];
    console.log(`ok  ${hit!.name} [${hit!.tier}] — ${buildings.length} buildings, e.g. ${buildings.slice(0, 3).map((b) => names.addresses.get(b)?.number).join(", ")}`);
  }
}
// A point in the far void must miss.
const voidHit = q.nearestRoad(999999, 999999);
console.log(voidHit === null ? "ok  void point → null" : `FAIL void point hit ${voidHit.roadId}`);
if (voidHit !== null) fail++;

console.log(fail === 0 ? `PASS (${pass} road hits)` : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
