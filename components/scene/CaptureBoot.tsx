"use client";

import { useEffect } from "react";
import { useSceneStore, QUALITY_TIERS, type QualityTier } from "@/lib/state/sceneStore";
import { CITY_SHAPES, type CityShapeSetting } from "@/lib/seed/cityShape";
import { readTileCull } from "@/lib/scene/tileCullDebug";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { applyDeviceFit } from "@/lib/perf/applyDeviceFit";
import { buildPersonaDirectory, personaFlavor } from "@/lib/seed/personas";
import { ensureBuildingStories, ensureAllStories } from "@/lib/seed/personaStory";
import { parseCamParam, encodeCamParam, liveViewPose } from "@/lib/scene/viewLink";

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
 *   ?cam=<view>          — shareable view link (lib/scene/viewLink): either a
 *                          comma pose "x,y,z,lx,ly,lz,fov,p|o[,orthoSize]" or a
 *                          named moire-gym pose. Parks the camera at the pose in
 *                          Still mode with the normal UI. Pair with ?seed=.
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
    // ?probe=1: expose the store on the NORMAL interactive page for verification
    // scripts that must drive real input (capture mode parks the camera, so
    // gesture probes can't use it). Read/drive-only affordance — changes no
    // scene state by itself.
    if (params.get("probe") === "1") {
      (window as unknown as Record<string, unknown>).__sceneStore = useSceneStore;
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
      // #55: live tile-cull counters for verification scripts (same caveat).
      (window as unknown as Record<string, unknown>).__tileCullDebug = { readTileCull };
      // #67: the shared clock every shader-animated layer (traffic/flights/
      // beacons) reads uTime from. Pausing (setPaused) stops TimeTicker from
      // advancing it, so a verification script can pin an exact uTime and get
      // a reproducible frame — e.g. a plane at a known point along its corridor.
      (window as unknown as Record<string, unknown>).__sharedTime = sharedTime;
      // Personas: directory access so capture scripts can find a persona by
      // predicate (e.g. "first resident with a commute") instead of guessing ids.
      (window as unknown as Record<string, unknown>).__personaDirectory = buildPersonaDirectory;
      // Deep tier is lazy (2026-07-10): scripts that read story/flavour fields
      // materialize them through the same gates the UI uses.
      (window as unknown as Record<string, unknown>).__personaLazy = {
        ensureBuildingStories,
        ensureAllStories,
        personaFlavor,
      };
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

    // ?cam=<view>: park the camera at a shared view (view link or named gym
    // pose). AFTER the capture block — resetCamera there would clobber the
    // intent. Still mode applies cameraIntent reactively (CameraControls), so
    // this works in both live and capture boots; in live mode pick a camera
    // model in the panel to fly away.
    const cam = params.get("cam");
    const pose = cam ? parseCamParam(cam) : null;
    if (pose) {
      if (pose.projection) state.setProjection(pose.projection);
      if (pose.orthoSize) state.setOrthoSize(pose.orthoSize);
      state.setCameraMode("still");
      state.setCameraIntent({
        position: pose.position,
        lookAt: pose.lookAt,
        fov: pose.fov,
        orient: "lookAt",
      });
    }

    // URL sync (skip while capture mode is on — we don't want the headless
    // screenshot URL to be a moving target). Two regimes:
    //  - liveViewLink OFF: hash tracks the seed only (`#seed=`, the original
    //    shareable-seed behavior).
    //  - liveViewLink ON: the address bar IS a view link — `?seed=&cam=`
    //    follows the camera, Google-Maps style. Trailing 500ms throttle keeps
    //    replaceState off the pose write-back hot path (~10/s while moving);
    //    replaceState adds no history entries, so back/forward stay sane.
    let urlTimer: ReturnType<typeof setTimeout> | null = null;
    const writeViewUrl = () => {
      urlTimer = null;
      const s = useSceneStore.getState();
      if (s.captureMode || !s.liveViewLink) return;
      const next = `${window.location.pathname}?seed=${encodeURIComponent(s.masterSeed)}&cam=${encodeCamParam(liveViewPose())}`;
      if (`${window.location.pathname}${window.location.search}` !== next) {
        history.replaceState(null, "", next); // drops any #seed — query wins on boot anyway
      }
    };
    const unsub = useSceneStore.subscribe((s, prev) => {
      if (s.captureMode) return;
      if (s.liveViewLink) {
        if (!urlTimer) urlTimer = setTimeout(writeViewUrl, 500);
        return;
      }
      if (prev.liveViewLink) return; // just toggled off — leave the last link in place
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
      if (urlTimer) clearTimeout(urlTimer);
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
