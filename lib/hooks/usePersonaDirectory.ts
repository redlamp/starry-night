"use client";

import { useEffect, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { peekPersonaDirectory, buildPersonaDirectory, type PersonaDirectory } from "@/lib/seed/personas";

// Stage A of the persona-perf fix: buildPersonaDirectory() is a synchronous
// ~2.2s cold build of ~39k seeded persona records, module-cached by recipe
// (see personas.ts's dirCache). Every consumer of this hook shares that same
// cache, so exactly ONE build runs per (masterSeed, cityShape, cityShapeScale,
// citySize, citySketch, ...) recipe no matter how many components ask for it
// concurrently — the rest just hit the warm Map.
//
// `enabled` lets a caller defer even the PEEK until its own gate (open/
// selected) is true, so a closed panel costs nothing. While the build hasn't
// been paid yet this returns null — callers render a Skeleton in that case,
// never block the render thread waiting on the cold build.
export function usePersonaDirectoryDeferred(enabled: boolean): PersonaDirectory | null {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  // citySize/citySketch don't feed buildPersonaDirectory's args directly, but
  // drive module-level generator state that its cache key accounts for
  // (dirCacheKey folds in maxHalfExtent()/sketchKey()/...) — subscribing them
  // forces a re-peek when a tier/sketch switch makes the current cache entry
  // stale, mirroring the citySize/citySketch idiom in entityData.ts.
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const dir = enabled ? peekPersonaDirectory(masterSeed, cityShape, cityShapeScale) : null;

  // Bump this to force a re-render once the deferred build lands — the built
  // directory itself lives in personas.ts's module cache, not in React state.
  const [, setBuildTick] = useState(0);

  useEffect(() => {
    if (!enabled || dir) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    // rAF (let the skeleton frame paint) then setTimeout(0) (fall behind any
    // work already queued for that painted frame) before paying the cold
    // build — the same "off the mount-critical path" idiom as
    // useGeneratedCity, just simpler: no worker/IndexedDB path here yet.
    const rafId = requestAnimationFrame(() => {
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        buildPersonaDirectory(masterSeed, cityShape, cityShapeScale);
        if (cancelled) return;
        setBuildTick((t) => t + 1);
      }, 0);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [enabled, dir, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  return dir;
}
