/** Highway card data (2026-07-27): districts a highway crosses + streets that
 * cross it. Sizes the crossing search before it goes in a render path. */
import { generateCity, tensorDistrictField } from "@/lib/seed/cityGen";
import { buildCityNames } from "@/lib/seed/naming";
import { crossingsAlong, districtRunsAlong, roadLength } from "@/lib/seed/roadGeometry";
import { DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE } from "@/lib/state/sceneDefaults";

const seed = "starry-night";
const c = generateCity(seed, DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE);
const seg = (rs: Array<{ vertices: unknown[] }>) => rs.reduce((n, r) => n + r.vertices.length - 1, 0);
console.log("highways", c.topology.highways.length, "segs", seg(c.topology.highways));
console.log("arterials", c.arterials.length, "segs", seg(c.arterials));
console.log("streets", c.streets.length, "segs", seg(c.streets));

const names = buildCityNames(seed, DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE);
const field = tensorDistrictField(seed);
const all = [...c.topology.highways, ...c.arterials, ...c.streets];

for (const h of c.topology.highways) {
  const t0 = process.hrtime.bigint();
  const runs = districtRunsAlong(h.vertices, field);
  const t1 = process.hrtime.bigint();
  const cross = crossingsAlong(
    h,
    all.filter((r) => r.id !== h.id),
  );
  const t2 = process.hrtime.bigint();
  const uniq = new Map<number, number>();
  for (const r of runs) uniq.set(r.index, (uniq.get(r.index) ?? 0) + r.lengthM);
  const named = [...uniq].map(
    ([i, m]) => `${field.districts[i]?.displayName ?? "?"}:${m.toFixed(0)}m`,
  );
  console.log(
    `\n${h.id} "${names.streetNames.get(h.id)}" verts=${h.vertices.length} length=${(roadLength(h.vertices, h.closed) / 1000).toFixed(2)}km addressed=${(names.buildingsByRoad.get(h.id) ?? []).length}`,
  );
  console.log(
    `  districts: ${uniq.size} unique / ${runs.length} runs in ${Number(t1 - t0) / 1e6}ms`,
  );
  console.log(`    ${named.join(", ")}`);
  console.log(`  crossings: ${cross.length} roads in ${Number(t2 - t1) / 1e6}ms`);
  const tier = (id: string) =>
    c.arterials.some((r) => r.id === id)
      ? "arterial"
      : c.streets.some((r) => r.id === id)
        ? "minor"
        : "highway";
  console.log(
    `    first 10: ${cross
      .slice(0, 10)
      .map((x) => `${names.streetNames.get(x.roadId)} (${tier(x.roadId)} @${(x.alongM / 1000).toFixed(2)}km)`)
      .join(", ")}`,
  );
  const byTier = new Map<string, number>();
  for (const x of cross) byTier.set(tier(x.roadId), (byTier.get(tier(x.roadId)) ?? 0) + 1);
  console.log(`    by tier: ${[...byTier].map(([k, v]) => `${k}=${v}`).join(" ")}`);
}
