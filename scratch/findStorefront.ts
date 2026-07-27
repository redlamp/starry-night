/** List storefront-eligible buildings for the default seed so the cage probe can frame one. */
import { generateCity } from "@/lib/seed/cityGen";
import { storefrontGroundFrac } from "@/lib/scene/storefront";
import { DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE } from "@/lib/state/sceneDefaults";

const { buildings } = generateCity("starry-night", DEFAULT_CITY_SHAPE, DEFAULT_CITY_SHAPE_SCALE);
const hits = buildings
  .map((b) => ({ b, gf: storefrontGroundFrac(b, 0.7, 1.7) }))
  .filter((x) => x.gf !== null)
  .slice(0, 8);
for (const { b, gf } of hits) {
  console.log(
    `id=${b.id} floors=${b.floors} h=${b.height.toFixed(0)}m ${b.archetype} groundFrac=${gf!.toFixed(3)} at (${b.x.toFixed(0)}, ${b.z.toFixed(0)})`,
  );
}
console.log(`total eligible: ${buildings.filter((b) => storefrontGroundFrac(b, 0.7, 1.7) !== null).length}`);
