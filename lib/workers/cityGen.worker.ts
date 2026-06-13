/// <reference lib="webworker" />
// City-generation worker (#59). Runs the exact same pure pipeline as the main
// thread (lib/seed is pure math — no DOM), so the result is byte-identical; the
// worker is purely a scheduling change that keeps the ~0.2s (Town) … ~8s (Metro)
// generation off the main thread. The bundle is plain data (the one closure,
// DistrictField.classify, travels as its raster — see districtFieldFromRaster).
//
// Streaming (#59 Phase B): the road tracer's emit-only hook batches accepted
// streamlines and posts them mid-compute — postMessage delivers to the main
// thread while this worker keeps crunching, so the scene can draw the network
// tracing itself in. Batches flush by COUNT (the worker thread is blocked in
// buildCityBundle, so no timer can fire mid-generation). Lines are decimated
// for display — they are a visual, never an input to anything deterministic.
//
// The bundle is posted in the packed wire form (bundleWire.ts): its object
// arrays (buildings / lights / road vertices) become Struct-of-Arrays typed
// buffers, so structured clone — which here runs the DESERIALIZE on the MAIN
// thread when the city lands — drops from ~100ms to ~6ms (V8). packBundle reads
// the worker-side caches without mutating them, so repeat requests are safe.
//
// NOTE: still no transferables. The packed buffers are freshly allocated (safe
// to transfer), but the kept-native raster would detach and poison the worker's
// caches for repeat requests; structured-cloning the wire is already ~ms.
import { buildCityBundle } from "@/lib/seed/cityGen";
import { packBundle, type CityBundleWire } from "@/lib/seed/bundleWire";
import { setCityTier, type CityTier } from "@/lib/seed/topology";
import { setCitySketch } from "@/lib/seed/citySketch";
import { setFieldDeviation } from "@/lib/seed/tensorField";
import {
  setDensityProfile,
  DEFAULT_DENSITY_PROFILE,
  type DensityProfile,
} from "@/lib/seed/density";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { SketchTensorSource } from "@/lib/sketch/orientationField";

export type CityGenRequest = {
  reqId: number;
  seed: string;
  shape: CityShapeSetting;
  scale: number;
  tier: CityTier;
  // #40: sketch-driven city. Typed arrays structured-clone cleanly; the worker
  // registers the sketch (or clears it) before generating, mirroring the main
  // thread's registry so the bundle matches the caller's cache keys.
  sketch: SketchTensorSource | null;
  // #51: runtime tensor-field deviation scale (1 = the seeded default).
  deviation: number;
  // #49: population profile (centres / spread / shoulder / satellite strength).
  density: DensityProfile;
};

// One traced road, decimated for display: [x0, z0, x1, z1, ...].
export type TracedLine = { pts: number[]; tier: "arterial" | "minor" };

export type CityGenProgress = { reqId: number; type: "progress"; lines: TracedLine[] };

export type CityGenResult =
  | { reqId: number; type: "done"; ok: true; bundle: CityBundleWire }
  | { reqId: number; type: "done"; ok: false; error: string };

export type CityGenMessage = CityGenProgress | CityGenResult;

const BATCH_LINES = 16; // roads per progress message
const DECIMATE = 5; // keep every 5th vertex (plus the last) for the display trace

// The dom lib types `self` as Window; recast to the worker scope.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<CityGenRequest>) => {
  const { reqId, seed, shape, scale, tier, sketch, deviation, density } = e.data;
  try {
    setCityTier(tier); // the worker's module extent is independent of the main thread's
    setCitySketch(sketch ?? null); // ...and so is its sketch registry (#40)
    setFieldDeviation(deviation ?? 1); // ...and its deviation scale (#51); default = seeded
    setDensityProfile(density ?? DEFAULT_DENSITY_PROFILE); // ...and the population profile (#49)
    let batch: TracedLine[] = [];
    const flush = () => {
      if (!batch.length) return;
      ctx.postMessage({ reqId, type: "progress", lines: batch } satisfies CityGenProgress);
      batch = [];
    };
    const bundle = buildCityBundle(seed, shape, scale, (pts, roadTier) => {
      const out: number[] = [];
      for (let i = 0; i < pts.length; i += DECIMATE) out.push(pts[i].x, pts[i].z);
      const last = pts[pts.length - 1];
      if ((pts.length - 1) % DECIMATE !== 0) out.push(last.x, last.z);
      batch.push({ pts: out, tier: roadTier });
      if (batch.length >= BATCH_LINES) flush();
    });
    flush();
    ctx.postMessage({ reqId, type: "done", ok: true, bundle: packBundle(bundle) } satisfies CityGenResult);
  } catch (err) {
    ctx.postMessage({
      reqId,
      type: "done",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies CityGenResult);
  }
};
