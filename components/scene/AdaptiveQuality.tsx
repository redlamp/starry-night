"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useSceneStore, QUALITY_TIERS } from "@/lib/state/sceneStore";
import { suggestTier, probeGpu } from "@/lib/perf/deviceTier";

// Dynamic DPR regression — the runtime safety net for the iMac problem (default
// "high" tier = DPR 2 on a Retina panel → fill-rate bound, 15-30 fps, no auto-
// downshift). drei <PerformanceMonitor> tracks average fps against a hysteresis
// band scaled to the refresh rate; when fps sags it steps the renderer DPR down,
// when headroom returns it steps back up, and after a few flip-flops it locks
// (the documented fix for the adaptive-DPR oscillation trap).
//
// Driven by the `adaptive` setting (Performance panel toggle; the ?adaptive URL
// just sets it on boot). DEFAULT-OFF (renders null). Enable it and watch the Stats
// overlay: on a Retina iMac the DPR line should fall from 2.0 toward ~1.0 and fps
// climb to 60. Still UNVERIFIED on a struggling device (see samples/perf-report.html).
const DPR_FLOOR = 1;
const DPR_STEP = 0.25;

// devicePixelRatio is stable for the session — read it as a plain value (not a
// ref accessed during render). Capped at 2: rendering above 2x is rarely worth it.
const CEIL_DPR = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1.5;

export function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr);
  const adaptive = useSceneStore((s) => s.adaptive);
  const cur = useRef(CEIL_DPR);
  const fitted = useRef(false);

  // Device-fit, once per session on first enable: pick the starting tier (its
  // dprMax + star count) and a render RADIUS from the GPU/DPR/cores. Strong GPUs →
  // tier high, radius 1 (no change); weaker devices start at a smaller concentric
  // crop so instance/vertex/memory/upload costs drop. The TIER (layout) is identical
  // on every device — only the rendered radius differs — so the city is shared
  // (cross-crop is a byte-identical subset).
  // NB: the dynamic regression ceiling (CEIL_DPR) doesn't yet read the chosen
  // tier's dprMax — reconcile at the pairing pass.
  useEffect(() => {
    if (!adaptive || fitted.current || typeof window === "undefined") return;
    fitted.current = true;
    const fit = suggestTier({
      renderer: probeGpu(),
      dpr: window.devicePixelRatio || 1,
      cores: navigator.hardwareConcurrency || 0,
    });
    const st = useSceneStore.getState();
    st.setQualityTier(fit.tier);
    st.setStars({ count: QUALITY_TIERS[fit.tier].starCount });
    st.setCityShapeScale(fit.radiusScale); // 1 on strong GPUs = no change/no re-gen
  }, [adaptive]);

  if (!adaptive) return null;
  return (
    <PerformanceMonitor
      // Hysteresis band as a fraction of the display refresh rate (so it behaves
      // on 60 Hz AND 120 Hz panels): decline below 75%, recover above 95%.
      bounds={(rr) => [Math.round(rr * 0.75), Math.round(rr * 0.95)]}
      flipflops={3}
      onDecline={() => {
        cur.current = Math.max(DPR_FLOOR, cur.current - DPR_STEP);
        setDpr(cur.current);
      }}
      onIncline={() => {
        cur.current = Math.min(CEIL_DPR, cur.current + DPR_STEP);
        setDpr(cur.current);
      }}
      onFallback={() => {
        // Kept flip-flopping → stop hunting and rest at a conservative value.
        cur.current = Math.max(DPR_FLOOR, Math.min(cur.current, CEIL_DPR - DPR_STEP));
        setDpr(cur.current);
      }}
    />
  );
}
