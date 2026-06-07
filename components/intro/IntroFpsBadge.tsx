"use client";

import { useSceneStore } from "@/lib/state/sceneStore";

// Always-on FPS badge for /intro (same styling as FpsHud, minus the
// persisted toggle — perf is being watched on this page by design).
// Fed by PerfMonitor's 500ms store samples from the intro Canvas.
export function IntroFpsBadge() {
  const perf = useSceneStore((s) => s.perf);
  const color =
    perf.fps >= 55 ? "text-emerald-300" : perf.fps >= 35 ? "text-amber-300" : "text-rose-400";
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-50 rounded bg-black/55 px-2 py-1 font-mono text-xs backdrop-blur-sm">
      <span className={`${color} tabular-nums`}>{Math.round(perf.fps)} fps</span>
      <span className="text-foreground/50 tabular-nums"> · {perf.calls} calls</span>
    </div>
  );
}
