// One-off: households-per-building histogram for the default seed.
// Run: bun scripts/hhHistogram.ts [seed]
import { buildPersonaDirectory } from "../lib/seed/personas";
import { generateCity } from "../lib/seed/cityGen";

const seed = process.argv[2] ?? "starry-night";
const dir = buildPersonaDirectory(seed, "auto", 1);
const { buildings } = generateCity(seed, "auto", 1);
const byId = new Map(buildings.map((b) => [b.id, b]));

const hist = new Map<number, number>();
const dense: Array<{ id: number; hh: number; people: number; floors: number; district: string }> = [];
for (const [buildingId, households] of dir.byHomeBuilding) {
  const n = households.length;
  hist.set(n, (hist.get(n) ?? 0) + 1);
  const b = byId.get(buildingId);
  dense.push({
    id: buildingId,
    hh: n,
    people: households.reduce((s, h) => s + h.memberIds.length, 0),
    floors: b ? Math.round(b.height / 3.2) : -1,
    district: b?.districtId ?? "?",
  });
}
dense.sort((a, b) => b.hh - a.hh);

console.log("residential buildings:", dir.byHomeBuilding.size);
console.log("total households:", [...hist.entries()].reduce((s, [k, v]) => s + k * v, 0));
console.log("histogram (households -> buildings):");
for (const [k, v] of [...hist.entries()].sort((a, b) => a[0] - b[0])) console.log(`  ${k} hh: ${v}`);
console.log("top 12 densest:");
for (const d of dense.slice(0, 12)) {
  const name = dir.names.buildingNames.get(d.id);
  const addr = dir.names.addresses.get(d.id);
  console.log(
    `  #${d.id} ${name ?? (addr ? `${addr.number} ${addr.street}` : "?")} — ${d.hh} hh, ${d.people} people, ~${d.floors} floors, ${d.district}`,
  );
}
