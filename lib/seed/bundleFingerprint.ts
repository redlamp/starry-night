import { maxHalfExtent } from "./topology";
import { sketchKey } from "./citySketch";
import { fieldDeviation } from "./tensorField";
import { densityProfileKey } from "./density";
import { GEN_VERSION } from "./genVersion";
import type { CityShapeSetting } from "./cityShape";

// Stable identity of a generated city, read from the CURRENT gen-module state.
// This mirrors the city cache key built in primeCityCaches (cityGen.ts) one-to-one
// — `${seed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}::${densityProfileKey()}`
// — and prepends GEN_VERSION. A fingerprint match therefore guarantees the runtime
// cache keys the bundle primes under also match what consumers read. Used as the
// IndexedDB record key.
//
// The gen modules are driven by the store's defaults at init (sceneStore.ts wires
// setCityTier / setFieldDeviation / setDensityProfile / setCitySketch from its
// initial state), so on first load this returns the canonical default-city
// fingerprint: v1::starry-night::circle::1::3000::none::1.5::4:1.2:0.8:0.7
export function fingerprintCurrent(
  seed: string,
  shape: CityShapeSetting,
  shapeScale: number,
): string {
  return `v${GEN_VERSION}::${seed}::${shape}::${shapeScale}::${maxHalfExtent()}::${sketchKey()}::${fieldDeviation()}::${densityProfileKey()}`;
}
