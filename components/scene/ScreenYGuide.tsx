"use client";

import { useSceneStore } from "@/lib/state/sceneStore";

// Screen-space guide shown ONLY while the Screen Y slider is being adjusted: a vertical
// dimension line from the top of the screen down to the focal pin, with the % at its midpoint.
//
// Deliberately a DIFFERENT treatment from the world-space dashed plumb line (which drops from
// the focal point to the ground): this is a flat-UI dimension line — a hairline with
// perpendicular end caps + outward arrowheads (the standard screen-measurement idiom: |<-- % -->|),
// in screen space. The pin is parked at horizontal centre and (1 - orbitPivotFromBottom) down
// from the top (a pure function of orbitPivotFromBottom on a fullbleed canvas), so no 3D
// projection is needed. Lives outside <Canvas> as a DOM overlay.
export function ScreenYGuide() {
  const active = useSceneStore((s) => s.focalAdjust === "screenY");
  const pivot = useSceneStore((s) => s.orbitPivotFromBottom);
  if (!active) return null;
  const screenY = Math.round((1 - pivot) * 100); // 0 = top of screen, 100 = bottom

  return (
    <div className="pointer-events-none fixed inset-0 z-10" aria-hidden>
      {/* dimension line: top-of-screen → pin, end caps + outward arrowheads + % at the mid */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{ height: `${screenY}%` }}>
        {/* vertical run */}
        <div className="absolute top-0 left-1/2 h-full -translate-x-1/2 border-l border-white/70" />
        {/* top end cap + arrowhead pointing up toward it */}
        <div className="absolute top-0 left-1/2 h-px w-3 -translate-x-1/2 bg-white/70" />
        <div
          className="absolute top-0 left-1/2 h-0 w-0 -translate-x-1/2"
          style={{
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderBottom: "6px solid rgba(255,255,255,0.9)",
          }}
        />
        {/* bottom end cap (at the pin) + arrowhead pointing down toward it */}
        <div className="absolute bottom-0 left-1/2 h-px w-3 -translate-x-1/2 bg-white/70" />
        <div
          className="absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2"
          style={{
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderTop: "6px solid rgba(255,255,255,0.9)",
          }}
        />
        {/* % at the midpoint — opaque chip masks the line behind it */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {screenY}%
        </div>
      </div>
    </div>
  );
}
