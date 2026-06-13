"use client";

import { useSceneStore } from "@/lib/state/sceneStore";

// Screen-space guide shown ONLY while the Screen Y slider is being adjusted: a vertical
// dimension line from the top of the screen down to the focal pin, with the % at its midpoint.
//
// Deliberately a DIFFERENT treatment from the world-space dashed plumb line (which drops from
// the focal point to the ground): this is a flat-UI dimension line, OFFSET to the side of the
// pin (so the pin icon never covers it), with extension caps running from the pin and the screen
// top out to the line and outward arrowheads (the standard screen-measurement idiom). The pin is
// parked at horizontal centre and (1 - orbitPivotFromBottom) down from the top (a pure function of
// orbitPivotFromBottom on a fullbleed canvas), so no 3D projection is needed. DOM overlay outside
// <Canvas>.
export function ScreenYGuide() {
  const active = useSceneStore((s) => s.focalAdjust === "screenY");
  const pivot = useSceneStore((s) => s.orbitPivotFromBottom);
  if (!active) return null;
  const screenY = Math.round((1 - pivot) * 100); // 0 = top of screen, 100 = bottom

  return (
    <div className="pointer-events-none fixed inset-0 z-10" aria-hidden>
      {/* Dimension line offset to the RIGHT of the pin (so the pin icon over the centre never
          covers it). The group spans pin-X → offset-X horizontally and screen-top → pin
          vertically; the extension caps run from the pin and the screen top out to the line. */}
      <div className="absolute top-0 left-1/2 w-12" style={{ height: `${screenY}%` }}>
        {/* vertical run, at the offset (right) edge */}
        <div className="absolute top-0 right-0 h-full w-px bg-white/70" />
        {/* extension caps: pin (bottom) and screen-top (top) → the dimension line */}
        <div className="absolute top-0 left-0 h-px w-full bg-white/70" />
        <div className="absolute bottom-0 left-0 h-px w-full bg-white/70" />
        {/* arrowheads on the dimension line, pointing outward to each cap */}
        <div
          className="absolute top-0 right-0 h-0 w-0 translate-x-1/2"
          style={{
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderBottom: "6px solid rgba(255,255,255,0.9)",
          }}
        />
        <div
          className="absolute right-0 bottom-0 h-0 w-0 translate-x-1/2"
          style={{
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderTop: "6px solid rgba(255,255,255,0.9)",
          }}
        />
        {/* % beside the dimension line */}
        <div className="absolute top-1/2 left-full ml-1 -translate-y-1/2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {screenY}%
        </div>
      </div>
    </div>
  );
}
