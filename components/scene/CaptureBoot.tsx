"use client";

import { useEffect } from "react";
import { useSceneStore, QUALITY_TIERS, type QualityTier } from "@/lib/state/sceneStore";
import { CITY_SHAPES, type CityShapeSetting } from "@/lib/seed/cityShape";

/**
 * Reads URL params and hash on mount + keeps URL hash in sync with the seed.
 *
 *   ?seed=<masterSeed>   — sets master seed (used by capture script)
 *   ?capture=1           — hides UI, forces still mode (used by capture script)
 *   ?intro=instant       — collapse the wake cascade to ~1s and hold windows ON
 *                          (headless stills otherwise catch a dark, waking city)
 *   ?quality=low|med|high|ultra — sets initial quality tier (DPR cap + star count)
 *   ?shape=auto|square|circle|blob|coastline — forces the city footprint shape
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
    const queryShape = params.get("shape");
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
      // resetCamera now lands in orbit; force still afterwards so the headless
      // screenshot is static.
      state.resetCamera();
      state.setCameraMode("still");
      // Expose the store so verification scripts can drive settings at runtime
      // (page.evaluate → __sceneStore.getState().setX). Capture mode only.
      (window as unknown as Record<string, unknown>).__sceneStore = useSceneStore;
    }
    if (params.get("intro") === "instant") {
      // Wake everything within ~1s and park the on/off cycle so a still a few
      // seconds in shows the fully-lit city. AFTER resetCamera (capture mode),
      // which resets intro settings to their defaults.
      state.setIntroDuration(1);
      state.setStreetlightDuration(1);
      state.setOffCycle(9999);
    }
    // AFTER resetCamera — it resets every persisted setting (incl. cityShape) to
    // its default, so applying the shape override here keeps it from being clobbered.
    if (
      queryShape &&
      (queryShape === "auto" || (CITY_SHAPES as readonly string[]).includes(queryShape))
    ) {
      state.setCityShape(queryShape as CityShapeSetting);
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
