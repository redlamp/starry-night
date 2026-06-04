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
// NOTE: no transferables on purpose. Transferring the raster's ArrayBuffer would
// detach it in the worker and poison the worker-side caches for repeat requests
// (same seed after a tier round-trip); structured-cloning ~1.25 MB costs ~ms.
import { buildCityBundle } from "@/lib/seed/cityGen";
import { setCityTier, type CityTier } from "@/lib/seed/topology";
import { setCitySketch } from "@/lib/seed/citySketch";
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
};

// One traced road, decimated for display: [x0, z0, x1, z1, ...].
export type TracedLine = { pts: number[]; tier: "arterial" | "minor" };

export type CityGenProgress = { reqId: number; type: "progress"; lines: TracedLine[] };

export type CityGenResult =
  | { reqId: number; type: "done"; ok: true; bundle: ReturnType<typeof buildCityBundle> }
  | { reqId: number; type: "done"; ok: false; error: string };

export type CityGenMessage = CityGenProgress | CityGenResult;

const BATCH_LINES = 16; // roads per progress message
const DECIMATE = 5; // keep every 5th vertex (plus the last) for the display trace

// The dom lib types `self` as Window; recast to the worker scope.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<CityGenRequest>) => {
  const { reqId, seed, shape, scale, tier, sketch } = e.data;
  try {
    setCityTier(tier); // the worker's module extent is independent of the main thread's
    setCitySketch(sketch); // ...and so is its sketch registry (#40)
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
    ctx.postMessage({ reqId, type: "done", ok: true, bundle } satisfies CityGenResult);
  } catch (err) {
    ctx.postMessage({
      reqId,
      type: "done",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies CityGenResult);
  }
};
