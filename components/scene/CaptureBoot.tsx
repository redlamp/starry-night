"use client";

import { useEffect } from "react";
import { useSceneStore, QUALITY_TIERS, type QualityTier } from "@/lib/state/sceneStore";

/**
 * Reads URL params and hash on mount + keeps URL hash in sync with the seed.
 *
 *   ?seed=<masterSeed>   — sets master seed (used by capture script)
 *   ?capture=1           — hides UI, forces still mode (used by capture script)
 *   ?quality=low|med|high|ultra — sets initial quality tier (DPR cap + star count)
 *   #seed=<masterSeed>   — shareable URL hash for the live app (preferred for users)
 *
 * Query-string `?seed=` wins over hash if both present.
 */
export function CaptureBoot() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const querySeed = params.get("seed");
    const hashSeed = readHashSeed();
    const capture = params.get("capture") === "1";
    const queryQuality = params.get("quality");
    const state = useSceneStore.getState();
    const initial = querySeed ?? hashSeed;
    if (initial) state.setSeed(initial);
    if (queryQuality && queryQuality in QUALITY_TIERS) {
      const tier = queryQuality as QualityTier;
      state.setQualityTier(tier);
      state.setStars({ count: QUALITY_TIERS[tier].starCount });
    }
    if (capture) {
      state.setCaptureMode(true);
      state.setCameraMode("still");
      state.resetCamera();
    }

    // Sync hash on every seed change (skip while capture mode is on — we don't
    // want the headless screenshot URL to be a moving target).
    const unsub = useSceneStore.subscribe((s, prev) => {
      if (s.captureMode) return;
      if (s.masterSeed === prev.masterSeed) return;
      const next = `#seed=${encodeURIComponent(s.masterSeed)}`;
      if (window.location.hash !== next) {
        history.replaceState(null, "", next);
      }
    });

    // Listen for hash changes (back/forward button, manual edits).
    const onHashChange = () => {
      const s = readHashSeed();
      if (s && s !== useSceneStore.getState().masterSeed) {
        useSceneStore.getState().setSeed(s);
      }
    };
    window.addEventListener("hashchange", onHashChange);

    return () => {
      unsub();
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
  return null;
}

function readHashSeed(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const seed = params.get("seed");
  return seed ? decodeURIComponent(seed) : null;
}
