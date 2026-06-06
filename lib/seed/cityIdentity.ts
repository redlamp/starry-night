import { sketchKey } from "@/lib/seed/citySketch";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { CityTier } from "@/lib/seed/topology";

// One city = one identity string. Every consumer that must react to "a
// different city" (cascade reset, trace reset, worker dedupe, cache warmth)
// derives its key from here — hand-assembled copies drift the moment a new
// gen input (e.g. a future field) is added.
export function cityIdentityKey(
  seed: string,
  shape: CityShapeSetting,
  scale: number,
  tier: CityTier,
  deviation: number,
): string {
  return `${seed}::${shape}::${scale}::${tier}::${sketchKey()}::${deviation}`;
}
