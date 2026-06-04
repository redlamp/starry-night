/// <reference lib="webworker" />
// City-generation worker (#59). Runs the exact same pure pipeline as the main
// thread (lib/seed is pure math — no DOM), so the result is byte-identical; the
// worker is purely a scheduling change that keeps the ~0.2s (Town) … ~8s (Metro)
// generation off the main thread. The bundle is plain data (the one closure,
// DistrictField.classify, travels as its raster — see districtFieldFromRaster).
//
// NOTE: no transferables on purpose. Transferring the raster's ArrayBuffer would
// detach it in the worker and poison the worker-side caches for repeat requests
// (same seed after a tier round-trip); structured-cloning ~1.25 MB costs ~ms.
import { buildCityBundle } from "@/lib/seed/cityGen";
import { setCityTier, type CityTier } from "@/lib/seed/topology";
import type { CityShapeSetting } from "@/lib/seed/cityShape";

export type CityGenRequest = {
  reqId: number;
  seed: string;
  shape: CityShapeSetting;
  scale: number;
  tier: CityTier;
};

export type CityGenResponse =
  | { reqId: number; ok: true; bundle: ReturnType<typeof buildCityBundle> }
  | { reqId: number; ok: false; error: string };

// The dom lib types `self` as Window; recast to the worker scope.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<CityGenRequest>) => {
  const { reqId, seed, shape, scale, tier } = e.data;
  try {
    setCityTier(tier); // the worker's module extent is independent of the main thread's
    const bundle = buildCityBundle(seed, shape, scale);
    ctx.postMessage({ reqId, ok: true, bundle } satisfies CityGenResponse);
  } catch (err) {
    ctx.postMessage({
      reqId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies CityGenResponse);
  }
};
