---
tags:
  - domain/perf
  - status/open
  - scope/m2
---

# Plan — Device-Adaptive Quality (#53)

Agent-scoped 2026-06-23. Mobile now in scope (past v1). Companion: GitHub #53.

## Key finding: most of it already EXISTS but is default-OFF and unverified

- `lib/perf/deviceTier.ts` — `probeGpu()` (throwaway WebGL ctx → `UNMASKED_RENDERER_WEBGL`),
  `classifyGpu()` (discrete/apple/integrated/mobile/unknown), `suggestTier({renderer,dpr,cores})`
  → `{tier, cls, radiusScale, reason}`. `cores` accepted but unused. Hand-rolled because
  `detect-gpu` couldn't install in a shared-node_modules worktree (deliberate fallback).
- `components/scene/AdaptiveQuality.tsx` — (a) boot device-fit (only on manual enable), (b) runtime
  DPR ramp via drei `<PerformanceMonitor>` (refresh-rate-scaled bounds, flipflops, DPR step 0.25).
  Author TODOs: `CEIL_DPR` ignores the tier `dprMax`; unverified on a struggling device; fit doesn't
  auto-run at boot; `adaptive` defaults false.
- Store/UI: `qualityTier` (QUALITY_TIERS low/med/high/ultra → dprMax + starCount), `dprCap`,
  `antialias` (canvas remount on toggle), `adaptive`, `cityShapeScale` (crop lever, byte-identical
  subset, no re-gen), `PerfMonitor`/`FpsHud`/`PerfOverlay`. `DEFAULT_STARS.count` 24000 vs high-tier
  16000 mismatch.

## Work (wiring + activation, not greenfield)
1. **`?quality=` URL param** in `CaptureBoot.tsx` (PRD-promised; manual override + escape hatch).
2. **Run device-fit once at boot** (guarded by a new transient `qualityUserSet` flag + no `?quality=`
   + no saved tier) — today it only fires on manual enable.
3. **Reconcile** `CEIL_DPR` = `min(devicePixelRatio, QUALITY_TIERS[tier].dprMax)`; fix the 24000-vs-16000
   star-count mismatch.
4. **Extend detection**: fold `probeGpu`→`probeCaps` (add `MAX_TEXTURE_SIZE`, webgl2, deviceMemory,
   coarse-pointer, mobile-UA); layered `suggestTier` (form-factor first → renderer class → cores/mem
   tie-breakers → masked-renderer conservative `med`). Optional: swap in `detect-gpu` (async, self-host
   benchmark JSON) in a non-worktree checkout.
5. **Runtime ramp**: add a second knob below the DPR floor — step `cityShapeScale` (crop) down on
   sustained low fps, back up on headroom (separate hysteresis from DPR). Respect `qualityUserSet`.

## Files
`lib/perf/deviceTier.ts`, `components/scene/AdaptiveQuality.tsx`, `components/scene/CaptureBoot.tsx`,
`lib/state/sceneStore.ts` (+ `qualityUserSet`), `components/ui/CameraPanel.tsx` (show class + reason),
new `lib/perf/applyDeviceFit.ts`.

## Determinism: clean
Perf/DPR/crop are render-only (never seed inputs). `performance.now()` for FPS is fine — it drives
DPR/crop/tier (Zustand runtime), not the seeded generator or per-window shader state.

## Verification (no device farm)
Unit-test `suggestTier`/`classifyGpu` (fixture renderer strings → expected tier). DevTools GPU/CPU
throttle + DPR pin to force the ramp; stub `probeCaps` to a Pixel-6/integrated string; Chrome device
toolbar for coarse-pointer/mobile-UA + high DPR. Real Pixel-6 pass is the final fillrate gate
(emulation is GPU-ish, not fillrate-accurate). Run gate1 before/after to prove crop+tier don't alter
geometry (cross-crop byte-identical subset).
