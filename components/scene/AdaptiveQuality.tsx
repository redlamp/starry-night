"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useRef } from "react";

// Dynamic DPR regression — the runtime safety net for the iMac problem (default
// "high" tier = DPR 2 on a Retina panel → fill-rate bound, 15-30 fps, no auto-
// downshift). drei <PerformanceMonitor> tracks average fps against a hysteresis
// band scaled to the refresh rate; when fps sags it steps the renderer DPR down,
// when headroom returns it steps back up, and after a few flip-flops it locks
// (the documented fix for the adaptive-DPR oscillation trap).
//
// GATED behind ?adaptive so it is DEFAULT-INERT (renders null) — safe to ship
// while UNVERIFIED in-browser. Enable with ?adaptive and watch ?perf: on a
// Retina iMac the DPR line should fall from 2.0 toward ~1.0 and fps climb to 60.
// VERIFY ON REAL DEVICES BEFORE making this the default (see samples/perf-report.html).
const ADAPTIVE = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("adaptive");
const DPR_FLOOR = 1;
const DPR_STEP = 0.25;

// devicePixelRatio is stable for the session — read it as a plain value (not a
// ref accessed during render). Capped at 2: rendering above 2x is rarely worth it.
const CEIL_DPR = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1.5;

export function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr);
  const cur = useRef(CEIL_DPR);
  if (!ADAPTIVE) return null;
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
