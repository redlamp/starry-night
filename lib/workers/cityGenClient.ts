// Main-thread host for the city-generation worker (#59). A lazily-created
// singleton worker serves warm-up requests; responses are matched by reqId and
// in-flight requests are deduped by key so the /plan grid (many tiles) doesn't
// queue duplicates. Returns null where Workers don't exist (SSR, old browsers,
// construction failure) — callers fall back to the synchronous path.
import type { CityBundle } from "@/lib/seed/cityGen";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { CityTier } from "@/lib/seed/topology";
import type { CityGenRequest, CityGenResponse } from "./cityGen.worker";

let worker: Worker | null = null;
let workerBroken = false; // a failed construction/crash flips the app to the sync fallback
let seq = 0;
const pending = new Map<number, { resolve: (b: CityBundle) => void; reject: (e: Error) => void }>();
const inFlight = new Map<string, Promise<CityBundle>>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    // The literal new Worker(new URL(...)) form is what the bundler statically
    // analyses to emit the worker chunk — do not refactor into a variable.
    worker = new Worker(new URL("./cityGen.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<CityGenResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.reqId);
      if (!p) return; // stale/unknown — already cancelled
      pending.delete(msg.reqId);
      if (msg.ok) p.resolve(msg.bundle);
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
  const key = `${seed}::${shape}::${scale}::${tier}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const reqId = ++seq;
  const promise = new Promise<CityBundle>((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    const req: CityGenRequest = { reqId, seed, shape, scale, tier };
    w.postMessage(req);
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
