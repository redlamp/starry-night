"use client";

import { useEffect } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { useGeneratedCity } from "@/lib/hooks/useGeneratedCity";
import { peekPersonaDirectory, stepPersonaDirectoryBuild } from "@/lib/seed/personas";
import { ensureBuildingStories } from "@/lib/seed/personaStory";

// Idle staged generation (test plan 07-10 §7.5): once the city geometry is
// ready and a settle delay has passed, quietly run the persona-directory
// build in ~5ms rAF slices, then keep going and weave every building's
// stories the same way — so by the time the user opens the directory or
// clicks a building, the skeleton either never shows or shows briefly.
// No sudden hits: each frame donates at most BUDGET_MS of main-thread time.
//
// Shares the resumable build handle with buildPersonaDirectory(), so a panel
// open mid-prewarm resumes the same generator synchronously (finishing the
// remainder, not restarting), and the prewarmer then finds the warm cache.

const SETTLE_MS = 3000; // let boot / intro cascade own the first seconds
const BUDGET_MS = 5; // per-frame slice — ~1/3 of a 60fps frame at worst

export function DirectoryPrewarm() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  // Recipe mirrors (same idiom as entityData/usePersonaDirectory): tier and
  // sketch changes re-key the module caches, so restart the prewarm on them.
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const { ready } = useGeneratedCity(masterSeed, cityShape);

  useEffect(() => {
    void citySize;
    void citySketch;
    if (!ready) return;
    let cancelled = false;
    let raf = 0;
    const startedAt = performance.now();
    // Story-phase cursor: buildings woven in directory order, a budget's
    // worth per frame (ensureBuildingStories is idempotent, so buildings the
    // user already materialized are free skips).
    let storyIds: number[] | null = null;
    let storyIdx = 0;

    const tick = () => {
      if (cancelled) return;
      if (performance.now() - startedAt < SETTLE_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const dir =
        peekPersonaDirectory(masterSeed, cityShape, cityShapeScale) ??
        stepPersonaDirectoryBuild(masterSeed, cityShape, cityShapeScale, BUDGET_MS);
      if (!dir) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!storyIds) storyIds = [...dir.byHomeBuilding.keys()];
      const deadline = performance.now() + BUDGET_MS;
      while (storyIdx < storyIds.length && performance.now() < deadline) {
        ensureBuildingStories(masterSeed, dir, storyIds[storyIdx++]);
      }
      if (storyIdx < storyIds.length) raf = requestAnimationFrame(tick);
      // else: everything is warm — stop scheduling, nothing to clean up.
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [ready, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  return null;
}
