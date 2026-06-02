"use client";

import { useEffect, useState } from "react";
import { generateCity } from "@/lib/seed/cityGen";
import type { CityShapeSetting } from "@/lib/seed/cityShape";

// First-load jank fix (#44): the cold `generateCity(seed, shape, scale)` call is
// the dominant CPU cost on mount (~200ms in-browser, builds the tensor field,
// district flood-fill, and lines every street with buildings). Every scene
// consumer — InstancedCity, Streetlights, Traffic, Roads, Beacons, DistrictShells,
// PlanView, DistrictsPanel — funnels through the SAME module-level cache in
// cityGen.ts: the first caller pays the full cost, the rest hit the warm cache
// at ~0ms.
//
// So we only need to move that ONE cold call off the mount-critical path. This
// hook warms the cache on an idle callback AFTER the canvas has mounted and the
// first frame (sky / stars / moon / ground) has painted, then flips `ready`.
// Consumers gate their generation + render on `ready`; once it's true the
// cache is warm and their own `generateCity` / `generateStreetlights` /
// `buildTraffic` calls return synchronously. The intro already eases content in,
// so the one- or two-frame deferral reads as part of the wake-up, not a stall.
//
// Determinism is untouched: this calls the exact same seeded pure function with
// the same args — the deferred result is byte-identical to the synchronous one.
// It is a SCHEDULING change, not a generation change. cityGen.ts is not modified.

// A key that already has a warm cache entry can render synchronously on the very
// first pass (no flash-of-nothing) — e.g. a seed re-used within the bounded
// module cache, or any environment where generation already happened. We never
// store the heavy CityData here; we only track which keys are known-warm so the
// hook can decide between sync-now and defer.
const warmedKeys = new Set<string>();

function cityKey(seed: string, shape: CityShapeSetting, scale: number): string {
  return `${seed}::${shape}::${scale}`;
}

// Run `cb` off the mount-critical path: prefer requestIdleCallback (yields until
// the browser is idle, so first paint wins), fall back to a double rAF (after the
// next painted frame), then a macrotask. Returns a cancel fn. SSR-safe: the
// caller only schedules inside an effect, which never runs during prerender.
function scheduleOffCritical(cb: () => void): () => void {
  if (typeof window === "undefined") {
    // Should not happen (effects don't run on the server), but stay safe: run
    // synchronously so we never silently drop the work.
    cb();
    return () => {};
  }
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    // timeout caps the wait so a perpetually-busy main thread still generates
    // the city within ~200ms rather than starving the scene forever.
    const id = w.requestIdleCallback(cb, { timeout: 200 });
    return () => w.cancelIdleCallback?.(id);
  }
  // Safari < 16.4 etc.: paint one frame, then run on the following frame.
  let raf2 = 0;
  const raf1 = window.requestAnimationFrame(() => {
    raf2 = window.requestAnimationFrame(cb);
  });
  return () => {
    window.cancelAnimationFrame(raf1);
    if (raf2) window.cancelAnimationFrame(raf2);
  };
}

/**
 * Warms the seeded city-generation cache off the mount-critical main thread and
 * reports when scene consumers may generate synchronously.
 *
 * @returns `ready` — false until the cold `generateCity` has run for this
 *   (seed, shape, scale); true once the cache is warm (or immediately if it
 *   already was). While false, consumers should render nothing; once true their
 *   own seeded generators hit the warm cache at ~0ms.
 */
export function useGeneratedCity(
  seed: string,
  shape: CityShapeSetting,
  scale: number,
): { ready: boolean } {
  const key = cityKey(seed, shape, scale);

  // Track which key the current `ready` value belongs to, so a key change is
  // detected during render (the "adjust state when a prop changes" pattern)
  // rather than in an effect — that keeps the warm-cache case flash-free and
  // avoids a synchronous setState inside useEffect. `ready` starts true only if
  // this key is already warm.
  const [state, setState] = useState(() => ({ key, ready: warmedKeys.has(key) }));
  let ready = state.ready;
  if (state.key !== key) {
    // Seed / shape / scale changed this render: re-derive readiness immediately.
    // A previously-warmed key reads ready at once; a new key starts not-ready and
    // the effect below schedules the warm-up.
    ready = warmedKeys.has(key);
    setState({ key, ready });
  }

  useEffect(() => {
    if (warmedKeys.has(key)) return; // already warm — nothing to schedule
    let cancelled = false;
    const cancel = scheduleOffCritical(() => {
      if (cancelled) return;
      generateCity(seed, shape, scale); // warms cityGen's cache + the shared field
      warmedKeys.add(key);
      setState({ key, ready: true });
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, [key, seed, shape, scale]);

  return { ready };
}
