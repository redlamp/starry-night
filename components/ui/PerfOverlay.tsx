"use client";

import { useEffect, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { getTimeline, getStats, type BootMark } from "@/lib/perf/bootTrace";

// Cold-load + runtime perf overlay, gated behind ?perf (zero cost / not mounted
// otherwise). Shows the boot timeline (time-to-first-star, worker gen, city
// first frame) and live fps / DPR / draw-calls / triangles / long-task total —
// the measurement tool for the device-quality work, usable in a real browser
// since headless Chromium hangs on this box. Read-only; never feeds scene state.
export function PerfOverlay() {
  // Single polled state object, written only inside the interval callback (never
  // synchronously in the effect body — that trips React 19's set-state-in-effect
  // rule). `on` starts false on both server and client, so no hydration mismatch;
  // the overlay appears on the first ~400ms tick when ?perf is set.
  const [poll, setPoll] = useState<{
    on: boolean;
    timeline: BootMark[];
    stats: { dpr: number; longTasks: number; longTaskMs: number; lastGenMs: number; lastGenSource: string };
  }>({ on: false, timeline: [], stats: { dpr: 0, longTasks: 0, longTaskMs: 0, lastGenMs: 0, lastGenSource: "" } });
  const perf = useSceneStore((s) => s.perf);

  useEffect(() => {
    const id = window.setInterval(() => {
      const on = new URLSearchParams(window.location.search).has("perf");
      setPoll({ on, timeline: getTimeline(), stats: getStats() });
    }, 400);
    return () => window.clearInterval(id);
  }, []);

  const { on, timeline, stats } = poll;
  if (!on) return null;

  const fpsColor = perf.fps >= 55 ? "#6ee7b7" : perf.fps >= 35 ? "#fcd34d" : "#fb7185";
  const rows: Array<{ name: string; t: number; delta: number }> = [];
  for (let i = 0; i < timeline.length; i++) {
    rows.push({ name: timeline[i].name, t: timeline[i].t, delta: i ? timeline[i].t - timeline[i - 1].t : 0 });
  }

  return (
    <div
      className="pointer-events-none absolute top-3 right-3 z-50 rounded bg-black/65 px-3 py-2 font-mono text-[11px] leading-relaxed backdrop-blur-sm"
      style={{ minWidth: 248 }}
    >
      <div className="mb-1 flex justify-between gap-4">
        <span style={{ color: fpsColor }} className="tabular-nums">
          {Math.round(perf.fps)} fps
        </span>
        <span className="text-white/60 tabular-nums">DPR {stats.dpr.toFixed(2)}</span>
      </div>
      <div className="mb-1 flex justify-between gap-4 text-white/60 tabular-nums">
        <span>{perf.calls} calls</span>
        <span>{(perf.triangles / 1000).toFixed(0)}k tris</span>
      </div>
      <div className="mb-1 text-white/60 tabular-nums">
        long tasks: {stats.longTasks} ({stats.longTaskMs.toFixed(0)} ms)
      </div>
      {stats.lastGenMs > 0 ? (
        <div className="mb-1 text-white/60 tabular-nums">
          last gen: {stats.lastGenMs.toFixed(0)} ms ({stats.lastGenSource})
        </div>
      ) : null}
      <div className="mt-1 border-t border-white/15 pt-1 text-white/45">boot timeline (ms)</div>
      {rows.map((r) => (
        <div key={r.name} className="flex justify-between gap-3 tabular-nums">
          <span className="text-white/70">{r.name}</span>
          <span className="text-white/55">
            {r.t.toFixed(0)}
            {r.delta ? <span className="text-white/35"> (+{r.delta.toFixed(0)})</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
