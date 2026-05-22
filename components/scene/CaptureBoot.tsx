"use client";

import { useEffect } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";

/**
 * Reads URL params on mount and hydrates the store. Supports:
 *   ?seed=<masterSeed>   — sets master seed
 *   ?capture=1           — hides UI + forces still mode, used by scripts/capture.ts
 */
export function CaptureBoot() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const seed = params.get("seed");
    const capture = params.get("capture") === "1";
    const state = useSceneStore.getState();
    if (seed) state.setSeed(seed);
    if (capture) {
      state.setCaptureMode(true);
      state.setCameraMode("still");
      state.resetCamera();
    }
  }, []);
  return null;
}
