/** "Sometimes I select a building and see no purple arcs" (2026-07-27): mirror
 * CommuteArc's building-card rules over every building and bucket the ones that
 * would draw ZERO arcs, by cause. */
import { generateCity } from "@/lib/seed/cityGen";
import { buildPersonaDirectory } from "@/lib/seed/personas";
import { DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE } from "@/lib/state/sceneDefaults";

const seed = "starry-night";
const city = generateCity(seed, DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE);
const dir = buildPersonaDirectory(seed, DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE);
const byId = new Map(city.buildings.map((b) => [b.id, b]));

let withArcs = 0;
const zero = {
  empty: 0, // no residents and no businesses at all
  noCommuters: 0, // residents, but none of them commute out
  employeesInside: 0, // businesses whose whole staff lives in the building
  missingTarget: 0, // an arc endpoint's building isn't in this city (shape clip)
};
let residentialWithArcs = 0;
let residentialTotal = 0;

for (const b of city.buildings) {
  const businesses = dir.byWorkBuilding.get(b.id) ?? [];
  const households = dir.byHomeBuilding.get(b.id) ?? [];
  const residential = households.length > 0 && businesses.length === 0;
  if (residential) residentialTotal++;

  let arcs = 0;
  let missing = 0;
  // Employment arcs: workplace -> each employee's home.
  for (const biz of businesses) {
    for (const pid of biz.employeeIds) {
      const worker = dir.personas.get(pid);
      if (!worker || worker.homeBuildingId === b.id) continue;
      if (!byId.has(worker.homeBuildingId)) {
        missing++;
        continue;
      }
      arcs++;
    }
  }
  // Residents' outbound commutes (the 2026-07-27 addition).
  for (const hh of households) {
    for (const pid of hh.memberIds) {
      const p = dir.personas.get(pid);
      if (!p?.commute || p.commuteTargetBuildingId === undefined) continue;
      if (p.commuteTargetBuildingId === b.id) continue;
      if (!byId.has(p.commuteTargetBuildingId)) {
        missing++;
        continue;
      }
      arcs++;
    }
  }

  if (arcs > 0) {
    withArcs++;
    if (residential) residentialWithArcs++;
    continue;
  }
  if (missing > 0) zero.missingTarget++;
  else if (households.length === 0 && businesses.length === 0) zero.empty++;
  else if (households.length > 0) zero.noCommuters++;
  else zero.employeesInside++;
}

const total = city.buildings.length;
const zeroTotal = total - withArcs;
console.log(`buildings: ${total}`);
console.log(`  draw arcs: ${withArcs} (${((withArcs / total) * 100).toFixed(1)}%)`);
console.log(`  draw NONE: ${zeroTotal} (${((zeroTotal / total) * 100).toFixed(1)}%)`);
console.log(`    no residents, no businesses : ${zero.empty}`);
console.log(`    residents, none commute out : ${zero.noCommuters}`);
console.log(`    staff all live in-building  : ${zero.employeesInside}`);
console.log(`    endpoint outside the city   : ${zero.missingTarget}`);
console.log(
  `  purely residential: ${residentialWithArcs}/${residentialTotal} draw arcs (was 0 before 2026-07-27)`,
);
