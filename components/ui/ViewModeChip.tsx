"use client";

import { useEffect, useRef, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { cameraCommand } from "@/lib/scene/cameraCommand";
import { cn } from "@/lib/utils";

// Transient view-mode notice (review 2026-07-25 1.4): the skyline regime swaps
// the gesture semantics (LMB pedestals instead of ground-panning) but the flip
// itself is easy to miss — surface every regime change as a short-lived chip,
// top-center, without needing the side-view diagram open. Reads the same
// per-frame cameraCommand.liveSkyline telemetry the diagram label uses; the
// boot value never flashes (only CHANGES announce themselves). UI chrome only —
// no scene-state input, so the rAF/timer here is outside the determinism
// contract.
const SHOW_MS = 1800;

export function ViewModeChip() {
  const enabled = useSceneStore(
    (s) => s.cameraModel === "snv3" && s.cameraMode === "orbit" && !s.captureMode,
  );
  const [shown, setShown] = useState<{ skyline: boolean; nonce: number } | null>(null);
  const last = useRef<boolean | null>(null);
  const nonce = useRef(0);
  const hideTimer = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const tick = () => {
      const sky = cameraCommand.liveSkyline;
      if (last.current === null) {
        last.current = sky; // adopt the boot value silently
      } else if (sky !== last.current) {
        last.current = sky;
        setShown({ skyline: sky, nonce: ++nonce.current });
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setShown(null), SHOW_MS);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hideTimer.current);
      last.current = null;
      setShown(null);
    };
  }, [enabled]);

  if (!enabled || !shown) return null;
  return (
    <div className="pointer-events-none fixed top-14 left-1/2 z-30 -translate-x-1/2">
      <div
        key={shown.nonce}
        className={cn(
          "animate-in fade-in slide-in-from-top-2 rounded-full border px-3 py-1 text-xs font-medium shadow-lg backdrop-blur-md duration-300",
          shown.skyline
            ? "border-amber-300/40 bg-amber-950/60 text-amber-200"
            : "border-foreground/15 bg-popover/70 text-foreground/85",
        )}
      >
        {shown.skyline ? "Skyline View" : "Standard View"}
      </div>
    </div>
  );
}
