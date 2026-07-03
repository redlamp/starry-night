"use client";

import { useEffect } from "react";
import { useSceneStore, QUALITY_TIERS, type QualityTier } from "@/lib/state/sceneStore";
import { CITY_SHAPES, type CityShapeSetting } from "@/lib/seed/cityShape";
import { readTileCull } from "@/lib/scene/tileCullDebug";
import { applyDeviceFit } from "@/lib/perf/applyDeviceFit";
import { GYM_POSES } from "@/lib/scene/gymPoses";

/**
 * Reads URL params and hash on mount + keeps URL hash in sync with the seed.
 *
 *   ?seed=<masterSeed>   — sets master seed (used by capture script)
 *   ?capture=1           — hides UI, forces still mode (used by capture script)
 *   ?intro=instant       — collapse the wake cascade to ~1s and hold windows ON
 *                          (headless stills otherwise catch a dark, waking city)
 *   ?quality=low|med|high|ultra — sets + LOCKS the quality tier (DPR cap + star
 *                          count); suppresses the boot device-fit (#53)
 *   ?shape=auto|square|circle|blob|coastline — forces the city footprint shape
 *   ?gym=<pose>          — parks the camera at a moire-gym pose (lib/scene/gymPoses)
 *                          in Still mode; works with the normal UI so artifact
 *                          poses can be eyeballed live. Pair with ?seed=.
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
    const hasQueryQuality = !!queryQuality && queryQuality in QUALITY_TIERS;
    if (hasQueryQuality) {
      const tier = queryQuality as QualityTier;
      state.setQualityTier(tier);
      state.setStars({ count: QUALITY_TIERS[tier].starCount });
      // An explicit ?quality= is a user choice — lock it so boot device-fit and
      // the runtime AdaptiveQuality monitor leave the tier alone. (#53)
      state.setQualityUserSet(true);
    }
    // Device-adaptive starting quality (#53). One-shot, guarded internally: it
    // no-ops when ?quality= is present, a tier was Saved, or the user already
    // picked a tier — so an explicit choice always wins. Capture mode skips it
    // so headless stills render at the deterministic default tier.
    if (!capture) applyDeviceFit({ hasQueryQuality });
    if (capture) {
      state.setCaptureMode(true);
      // resetCamera now lands in orbit; force still afterwards so the headless
      // screenshot is static.
      state.resetCamera();
      state.setCameraMode("still");
      // Expose the store so verification scripts can drive settings at runtime
      // (page.evaluate → __sceneStore.getState().setX). Capture mode only.
      (window as unknown as Record<string, unknown>).__sceneStore = useSceneStore;
      // #55: live tile-cull counters for verification scripts (same caveat).
      (window as unknown as Record<string, unknown>).__tileCullDebug = { readTileCull };
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

    // ?adaptive / ?perf are convenience shortcuts that flip the persisted settings
    // on boot (the real controls live in Performance → Adaptive quality / Stats).
    if (params.has("adaptive")) state.setAdaptive(true);
    if (params.has("perf")) state.setPerfStats(true);

    // ?gym=<pose>: park the camera at a moire-gym pose. AFTER the capture
    // block — resetCamera there would clobber the intent. Still mode applies
    // cameraIntent reactively (CameraControls), so this works in both live and
    // capture boots; in live mode pick a camera model in the panel to fly away.
    const gym = params.get("gym");
    if (gym && GYM_POSES[gym]) {
      const pose = GYM_POSES[gym];
      state.setCameraMode("still");
      state.setCameraIntent({
        position: pose.position,
        lookAt: pose.lookAt,
        fov: pose.fov,
        orient: "lookAt",
      });
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
