// Main-thread host for the city-generation worker (#59). A lazily-created
// singleton worker serves warm-up requests; responses are matched by reqId and
// in-flight requests are deduped by key so the /plan grid (many tiles) doesn't
// queue duplicates. Returns null where Workers don't exist (SSR, old browsers,
// construction failure) — callers fall back to the synchronous path.
//
// Streaming (#59 Phase B): mid-compute "progress" messages (batches of traced
// road lines) are re-broadcast to subscribers with the request's context, so a
// scene overlay can draw the network tracing itself in while the worker runs.
import type { CityBundle } from "@/lib/seed/cityGen";
import { unpackBundle } from "@/lib/seed/bundleWire";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { CityTier } from "@/lib/seed/topology";
import { activeCitySketch, sketchKey } from "@/lib/seed/citySketch";
import { fieldDeviation } from "@/lib/seed/tensorField";
import { densityProfile, densityProfileKey } from "@/lib/seed/density";
import type { CityGenRequest, CityGenMessage, TracedLine } from "./cityGen.worker";

export type GenProgressEvent = {
  seed: string;
  shape: CityShapeSetting;
  scale: number;
  tier: CityTier;
  lines: TracedLine[];
};

type ReqContext = { seed: string; shape: CityShapeSetting; scale: number; tier: CityTier };

let worker: Worker | null = null;
let workerBroken = false; // a failed construction/crash flips the app to the sync fallback
let seq = 0;
const pending = new Map<
  number,
  { ctx: ReqContext; resolve: (b: CityBundle) => void; reject: (e: Error) => void }
>();
const inFlight = new Map<string, Promise<CityBundle>>();
const progressListeners = new Set<(e: GenProgressEvent) => void>();

/** Subscribe to streamed road-trace batches from any in-flight generation. */
export function subscribeGenProgress(cb: (e: GenProgressEvent) => void): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    // The literal new Worker(new URL(...)) form is what the bundler statically
    // analyses to emit the worker chunk — do not refactor into a variable.
    worker = new Worker(new URL("./cityGen.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<CityGenMessage>) => {
      const msg = e.data;
      const p = pending.get(msg.reqId);
      if (!p) return; // stale/unknown — already cancelled
      if (msg.type === "progress") {
        const event: GenProgressEvent = { ...p.ctx, lines: msg.lines };
        for (const cb of progressListeners) cb(event);
        return;
      }
      pending.delete(msg.reqId);
      // The worker posts the packed wire form (bundleWire.ts) — rebuild the
      // CityBundle here so every caller sees the same runtime type as before.
      if (msg.ok) p.resolve(unpackBundle(msg.bundle));
      else p.reject(new Error(msg.error));
    };
    worker.onerror = () => {
      // Worker crashed (e.g. failed chunk load): reject everything in flight so
      // callers fall back to sync, and stop using the worker for this session.
      workerBroken = true;
      for (const p of pending.values()) p.reject(new Error("city-gen worker failed"));
      pending.clear();
      inFlight.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

/**
 * Generate the city bundle for (seed, shape, scale, tier) in the worker.
 * Resolves with the serialisable bundle (prime the caches with it), rejects if
 * the worker fails, returns null if Workers are unavailable here.
 */
export function generateCityInWorker(
  seed: string,
  shape: CityShapeSetting,
  scale: number,
  tier: CityTier,
): Promise<CityBundle> | null {
  const w = getWorker();
  if (!w) return null;
  // The sketch rides the main thread's registry (synced by the store before any
  // consumer regenerates) — the key matches the gen caches' sketchKey() so a
  // sketch flip can't be served a stale no-sketch bundle.
  const key = `${seed}::${shape}::${scale}::${tier}::${sketchKey()}::${fieldDeviation()}::${densityProfileKey()}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const reqId = ++seq;
  const promise = new Promise<CityBundle>((resolve, reject) => {
    pending.set(reqId, { ctx: { seed, shape, scale, tier }, resolve, reject });
    const req: CityGenRequest = {
      reqId,
      seed,
      shape,
      scale,
      tier,
      sketch: activeCitySketch(),
      deviation: fieldDeviation(),
      density: densityProfile(),
    };
    w.postMessage(req);
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
