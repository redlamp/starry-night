"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useSceneStore, QUALITY_TIERS } from "@/lib/state/sceneStore";

// Dynamic quality regression — the runtime safety net for the iMac/phone problem
// (a tier whose dprMax is too tall for the live GPU → fill-rate bound, no auto-
// downshift). drei <PerformanceMonitor> tracks average fps against a hysteresis
// band scaled to the refresh rate; when fps sags it steps the renderer DPR down,
// when headroom returns it steps back up, and after a few flip-flops it locks
// (the documented fix for the adaptive-DPR oscillation trap).
//
// Two knobs, in order: DPR first (cheapest, fully render-only), then — once DPR
// has bottomed out at the floor and fps is STILL sagging — the city render RADIUS
// (cityShapeScale, a concentric byte-identical crop). Separate hysteresis from
// the DPR ramp so the two don't fight. The boot device-fit (applyDeviceFit, #53)
// already picked the starting tier + radius; this only reacts to live fps.
//
// Driven by the `adaptive` setting (Performance panel toggle; ?adaptive sets it on
// boot). DEFAULT-OFF (renders null). When the user has explicitly picked a tier
// (qualityUserSet), the crop ramp is suppressed — DPR still rides (it never alters
// the tier, only resolution) but the rendered city extent is left exactly as set.
//
// Determinism: DPR + crop are render-only and never feed the seeded generator
// (cross-crop is a byte-identical subset), so fps → quality is safe.
const DPR_FLOOR = 1;
const DPR_STEP = 0.25;

// Runtime crop ramp (the second knob, below the DPR floor). Steps the city render
// radius down on sustained low fps once DPR can't drop further, and back up on
// headroom. Bounds keep it from cropping the city to a useless nub.
const CROP_STEP = 0.1;
const CROP_FLOOR = 0.45;
const CROP_CEIL = 1;

export function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr);
  const adaptive = useSceneStore((s) => s.adaptive);
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const qualityUserSet = useSceneStore((s) => s.qualityUserSet);

  // CEIL_DPR now honours the chosen tier's dprMax (the long-standing TODO): the
  // runtime ramp may climb back up to the device pixel ratio, but never past what
  // the active tier allows. Recomputed whenever the tier changes.
  const ceilDpr = useRef(1);
  const cur = useRef(1);
  useEffect(() => {
    const devicePR = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    ceilDpr.current = Math.min(devicePR, QUALITY_TIERS[qualityTier].dprMax);
    // Re-clamp the live DPR to the new ceiling and seed the ramp from it.
    cur.current = Math.min(cur.current || ceilDpr.current, ceilDpr.current);
    cur.current = Math.max(cur.current, DPR_FLOOR);
    if (adaptive) setDpr(cur.current);
  }, [qualityTier, adaptive, setDpr]);

  if (!adaptive) return null;
  return (
    <PerformanceMonitor
      // Hysteresis band as a fraction of the display refresh rate (so it behaves
      // on 60 Hz AND 120 Hz panels): decline below 75%, recover above 95%.
      bounds={(rr) => [Math.round(rr * 0.75), Math.round(rr * 0.95)]}
      flipflops={3}
      onDecline={() => {
        if (cur.current > DPR_FLOOR) {
          // First knob: drop DPR.
          cur.current = Math.max(DPR_FLOOR, cur.current - DPR_STEP);
          setDpr(cur.current);
        } else if (!qualityUserSet) {
          // DPR floored and still sagging → second knob: crop the render radius
          // (skipped when the user has locked the tier).
          stepCrop(-CROP_STEP);
        }
      }}
      onIncline={() => {
        const st = useSceneStore.getState();
        if (!qualityUserSet && st.cityShapeScale < CROP_CEIL && cur.current >= ceilDpr.current) {
          // Restore the radius first (it's the bigger visual win) before climbing
          // DPR past where it already sits.
          stepCrop(CROP_STEP);
        } else if (cur.current < ceilDpr.current) {
          cur.current = Math.min(ceilDpr.current, cur.current + DPR_STEP);
          setDpr(cur.current);
        }
      }}
      onFallback={() => {
        // Kept flip-flopping → stop hunting and rest at a conservative value.
        cur.current = Math.max(DPR_FLOOR, Math.min(cur.current, ceilDpr.current - DPR_STEP));
        setDpr(cur.current);
      }}
    />
  );
}

// Step the city render radius (cityShapeScale) by `delta`, clamped to the runtime
// crop band. Render-only — a concentric, byte-identical subset of the same city.
function stepCrop(delta: number) {
  const st = useSceneStore.getState();
  const next = Math.min(CROP_CEIL, Math.max(CROP_FLOOR, st.cityShapeScale + delta));
  if (next !== st.cityShapeScale) st.setCityShapeScale(next);
}
