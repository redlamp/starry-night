"use client";

import { useSceneStore } from "@/lib/state/sceneStore";

// Screen-space guide shown ONLY while the Screen Y slider is being adjusted: a vertical line
// from the top of the screen down to the focal pin, with the % value at its midpoint.
//
// Deliberately a DIFFERENT treatment from the world-space dashed plumb line (which drops from
// the focal point to the ground): this is a flat UI measurement — a solid hairline + a label
// chip, in screen space. The pin is parked at horizontal centre and (1 - orbitPivotFromBottom)
// down from the top (a pure function of orbitPivotFromBottom on a fullbleed canvas), so no 3D
// projection is needed. Lives outside <Canvas> as a DOM overlay.
export function ScreenYGuide() {
  const active = useSceneStore((s) => s.focalAdjust === "screenY");
  const pivot = useSceneStore((s) => s.orbitPivotFromBottom);
  if (!active) return null;
  const screenY = Math.round((1 - pivot) * 100); // 0 = top of screen, 100 = bottom

  return (
    <div className="pointer-events-none fixed inset-0 z-10" aria-hidden>
      {/* top-of-screen → pin hairline */}
      <div
        className="absolute top-0 -translate-x-1/2 border-l border-white/70"
        style={{ left: "50%", height: `${screenY}%` }}
      />
      {/* % at the line's midpoint */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums"
        style={{ left: "50%", top: `${screenY / 2}%` }}
      >
        {screenY}%
      </div>
    </div>
  );
}
