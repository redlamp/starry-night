"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdle } from "@/lib/useIdle";
import { useSceneStore } from "@/lib/state/sceneStore";

// Inspect-mode toggle — a floating round button matching ControlsGuide's "?"
// button (size / shape / idle-fade), sitting just to its left. On = buildings
// highlight on hover and a click opens the info panel; off = pointer picking is
// inert. Shows a filled "enabled" state so it reads as a sticky mode, not a
// one-shot action, and (like "?") stays visible while enabled even when idle.
export function InspectModeButton() {
  const inspectMode = useSceneStore((s) => s.inspectMode);
  const setInspectMode = useSceneStore((s) => s.setInspectMode);
  const idle = useIdle();
  return (
    <button
      onClick={() => setInspectMode(!inspectMode)}
      aria-label="Inspect buildings"
      aria-pressed={inspectMode}
      title="Inspect buildings"
      className={cn(
        "fixed right-16 bottom-3 z-20 flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-[opacity,background-color,color] duration-700",
        inspectMode
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-foreground/10 bg-popover/70 text-foreground/85 hover:bg-foreground/10",
        idle && !inspectMode ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100",
      )}
    >
      <Info className="size-5" />
    </button>
  );
}
