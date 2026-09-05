"use client";

import { useEffect, useRef, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { cameraCommand } from "@/lib/scene/cameraCommand";
import { useIdle } from "@/lib/useIdle";
import { cn } from "@/lib/utils";

// Transient view-mode notice (review 2026-07-25 1.4): the skyline regime swaps
// the gesture semantics (vertical LMB pedestals instead of ground-panning) but
// the flip itself is easy to miss — surface every regime change as a
// short-lived chip, top-center. Reads the same per-frame
// cameraCommand.liveSkyline telemetry the diagram label uses.
//
// Quiet rules (user 2026-07-26): no announcement during the first seconds
// after load (the default pose rests inside the 3° band, so boot always
// "changes" into skyline — that first one is noise), and none while the HUD
// chrome is idle-faded (the drift flight can cross the band on its own; a chip
// popping over an otherwise chromeless screensaver breaks the flow). Changes
// that happen during quiet periods are adopted silently. UI chrome only — no
// scene-state input, so the timers here are outside the determinism contract.
const SHOW_MS = 1800;
const BOOT_GRACE_MS = 4000;

export function ViewModeChip() {
  const enabled = useSceneStore(
    (s) => s.cameraModel === "snv3" && s.cameraMode === "orbit" && !s.captureMode,
  );
  const idle = useIdle();
  const [shown, setShown] = useState<{ skyline: boolean; nonce: number } | null>(null);
  const last = useRef<boolean | null>(null);
  const armAt = useRef(0); // first-enable timestamp + grace; announcements only after
  const nonce = useRef(0);
  const hideTimer = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (armAt.current === 0) armAt.current = performance.now() + BOOT_GRACE_MS;
    let raf = 0;
    const tick = () => {
      if (idle) setShown((s) => (s === null ? s : null)); // chrome faded — drop a lingering chip
      const sky = cameraCommand.liveSkyline;
      const quiet = idle || performance.now() < armAt.current;
      if (sky !== last.current) {
        if (last.current === null || quiet) {
          last.current = sky; // adopt silently
        } else {
          last.current = sky;
          setShown({ skyline: sky, nonce: ++nonce.current });
          window.clearTimeout(hideTimer.current);
          hideTimer.current = window.setTimeout(() => setShown(null), SHOW_MS);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hideTimer.current);
    };
  }, [enabled, idle]);

  if (!enabled || !shown) return null;
  return (
    <div className="pointer-events-none fixed top-14 left-1/2 z-30 -translate-x-1/2">
      <div
        key={shown.nonce}
        className={cn(
          // Popover tokens (presentation batch item 1) so the theme toggle reaches
          // this chip; the hue distinction still rides an inline oklch pair (amber
          // = skyline, sky-blue = aerial — the sky association, user 2026-07-26).
          "border-popover-foreground/10 bg-popover/70 animate-in fade-in slide-in-from-top-2 rounded-full border px-3 py-1 text-xs font-medium shadow-lg backdrop-blur-md duration-300 motion-reduce:transition-none",
        )}
        style={{
          color: shown.skyline ? "oklch(0.79 0.14 75)" : "oklch(0.78 0.12 230)",
        }}
      >
        {shown.skyline ? "Skyline View" : "Aerial View"}
      </div>
    </div>
  );
}
