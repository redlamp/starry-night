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
    // Positioned by the page's bottom-left HUD stack (2026-07-26) — no own offsets.
    // Popover tokens (presentation batch item 1) so the theme toggle reaches it.
    <div className="border-foreground/10 bg-popover/70 text-foreground pointer-events-none relative rounded border px-2 py-1 font-mono text-xs backdrop-blur-sm">
      <span className={`${color} tabular-nums`}>{Math.round(perf.fps)} fps</span>
      <span className="text-muted-foreground tabular-nums"> · {perf.calls} calls</span>
    </div>
  );
}
