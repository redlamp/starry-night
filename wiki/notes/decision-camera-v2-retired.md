---
tags:
  - domain/camera
  - status/adopted
---

# Decision: Camera V2 Retired

**Date:** 2026-09-05. Related: [[decision-camera-model-registry]], [[decision-snv2-wasd]], [[decision-camera-v3-continuous-modes]].

## Context

`StarryNightV2Model` ("Starry Night Cam v2", id `snv2`) was the app's drone-style interactive camera and the registry's registered fallback since [[decision-snv2-wasd]] (2026-07-06). `StarryNightV3Model` (`snv3`) forked v2 on 2026-07-15 ([[decision-camera-v3-continuous-modes]]) — same rig, plus Top-Down-as-flight, Drift integration, cone-view framing, and hand-rolled touch — and has been the default (`DEFAULT_CAMERA_MODEL`) ever since. v2 kept shipping only as an alternate selector entry; nothing in the app defaulted to it or depended on it over v3.

## Options

1. Keep both models registered indefinitely (status quo) — two nearly-identical rigs to maintain, test, and reason about.
2. Retire v2, keep the camera-model registry itself so models stay swappable — the registry's whole point ([[decision-camera-model-registry]]) is that a model is a pluggable component, not a special case.
3. Fold the registry away entirely and hardcode v3 — rejected, throws away the swappability the registry was built for.

## Choice

Option 2. Removed `StarryNightV2Model.tsx`, its `registry.tsx` / catalog entries, and its `snv2` store slice + setter + `SETTINGS_REGISTRY` entry. The registry (`CAMERA_MODEL_COMPONENTS`, `CameraModelId` union, `CAMERA_MODELS` catalog) stays exactly as pluggable as before — v3 is just the sole surviving "3 Cs" drone model now.

`Snv2Config` (the tunables type) and `DEFAULT_SNV2` survive in `lib/state/sceneTypes.ts` / `sceneDefaults.ts` — unused as a v2 concept, but `Snv3Config extends Snv2Config` and `DEFAULT_SNV3` spreads `DEFAULT_SNV2`, so v3's own tuning still builds on that shape.

A persisted `cameraModel: "snv2"` migrates to `"snv3"` on load; a persisted `snv2` config block is dropped (v3 has always read its own `snv3` block, never `snv2`'s).

## Why

v2 had no remaining reason to exist once v3 fully superseded it as the default and nothing else read its state. Two copies of a nearly-identical ~2000-line camera rig were pure maintenance weight (drift risk between the two on every future tuning pass) for a selector entry nobody was defaulting to.

## What retiring removes

v2's touch model left camera-controls' native touch actions on: 2-finger pinch-zoom **+ twist-to-rotate**. v3 hand-rolls touch instead (1-finger move, 2-finger latched swipe → orbit *or* tilt, pinch zoom) and retired twist-rotate on 2026-07-27 as a deliberate disambiguation call, not an oversight — but it means twist-rotate-by-touch is gone with v2. Also lost: v2's slightly snappier focus-glide tuning (`FOCUS_SMOOTH_TIME` 0.18 vs v3's deliberate 0.45) and its faster wheel-zoom curve (`WHEEL_ZOOM_SPEED` 1.0 vs v3's 1.6, tuned for v3's smoothed dolly) — both intentional v3 re-tunings, not gaps, but worth knowing v2's feel is no longer available to A/B against.
