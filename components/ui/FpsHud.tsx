"use client";

import { useSceneStore } from "@/lib/state/sceneStore";

// Always-on-screen FPS badge (top-left), fed by PerfMonitor's 500ms store
// samples. Toggled from the Performance section (persisted) — exists so perf
// passes (#55 tile culling, quality tiers) can be eyeballed without keeping
// the sidebar open.
export function FpsHud() {
  const show = useSceneStore((s) => s.fpsHud);
  const perf = useSceneStore((s) => s.perf);
  if (!show) return null;
  const color =
    perf.fps >= 55 ? "text-emerald-300" : perf.fps >= 35 ? "text-amber-300" : "text-rose-400";
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-50 rounded bg-black/55 px-2 py-1 font-mono text-xs backdrop-blur-sm">
      <span className={`${color} tabular-nums`}>{Math.round(perf.fps)} fps</span>
      <span className="text-foreground/50 tabular-nums"> · {perf.calls} calls</span>
    </div>
  );
}
