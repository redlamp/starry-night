"use client";

/* eslint-disable @next/next/no-img-element -- the control glyphs are tiny static SVGs in
   public/controls/*.svg; next/image gives no benefit here, and plain <img> keeps the assets
   directly editable + swappable in Figma (the whole point of shipping them as files). */

import { useEffect, useRef, useState } from "react";
import { asset } from "@/lib/basePath";
import { useSceneStore } from "@/lib/state/sceneStore";
import { cameraActivity, type CameraAction } from "@/lib/scene/cameraActivity";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// In-app controls cheat-sheet. A small, NON-MODAL card anchored bottom-right (no scrim — it STAYS UP
// while you test the gestures; dismiss with the ✕, the "?" button, or Esc — a click on the scene does
// not close it). shadcn Tabs split Mouse vs Touch and AUTO-SWITCH to whichever input you last used.
// As you perform a gesture, its row HIGHLIGHTS amber (DreiSceneControls marks the live action via
// lib/scene/cameraActivity). Glyphs are editable SVG assets in public/controls/*.svg (open in Figma);
// the active part — pressed button / fingertips / motion arrows — is the app's selection amber.
// Bindings live in DreiSceneControls; keep this list in sync when they change.

type Mode = "mouse" | "touch";
type Item = { icon: string; motion?: "ud" | "all"; label: string; sub?: string };

const MOUSE_ITEMS: Item[] = [
  { icon: "mouse-left", motion: "all", label: "Rotate & tilt" },
  { icon: "mouse-left", motion: "ud", label: "Focal height", sub: "on the pin · pin shown (i)" },
  { icon: "mouse-right", motion: "all", label: "Pan", sub: "or Shift + left" },
  { icon: "mouse-both", motion: "all", label: "Look around", sub: "or Ctrl / ⌘ + left" },
  { icon: "mouse-wheel", label: "Zoom", sub: "z: cursor ↔ pin" },
  { icon: "reset", label: "Reset", sub: "double-click" },
];
const TOUCH_ITEMS: Item[] = [
  { icon: "finger-1", motion: "all", label: "Rotate & tilt" },
  { icon: "finger-1", motion: "ud", label: "Focal height", sub: "on the pin · pin shown" },
  { icon: "finger-2", motion: "all", label: "Pan" },
  { icon: "pinch", label: "Zoom", sub: "pinch in / out" },
  { icon: "finger-3", motion: "all", label: "Look around" },
  { icon: "reset", label: "Reset", sub: "double-tap" },
];
const KEYS: [string, string][] = [
  ["P", "projection"],
  ["Space", "pause"],
  ["i", "pin"],
  ["z", "zoom"],
  ["H", "panel"],
];

// which row each live action maps to (label-matched, so the highlight lands in either tab)
const ACTION_LABEL: Record<CameraAction, string> = {
  rotate: "Rotate & tilt",
  focalY: "Focal height",
  pan: "Pan",
  look: "Look around",
  zoom: "Zoom",
  reset: "Reset",
};

function Glyph({ icon, motion }: { icon: string; motion?: "ud" | "all" }) {
  return (
    <span className="flex w-14 shrink-0 items-center justify-center gap-1">
      <img src={asset(`/controls/${icon}.svg`)} alt="" className="h-7 w-auto" draggable={false} />
      {motion && (
        <img
          src={asset(`/controls/motion-${motion}.svg`)}
          alt=""
          className="h-6 w-6"
          draggable={false}
        />
      )}
    </span>
  );
}

function Rows({ items, active }: { items: Item[]; active: string | null }) {
  return (
    <div className="flex flex-col">
      {items.map((it, i) => {
        const on = it.label === active;
        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 rounded px-1 py-1 transition-colors",
              on ? "bg-amber-500/15" : "hover:bg-foreground/5",
            )}
          >
            <Glyph icon={it.icon} motion={it.motion} />
            <div className="min-w-0">
              <div className={cn("text-xs", on ? "font-medium text-amber-300" : "text-foreground/90")}>
                {it.label}
              </div>
              {it.sub && <div className="text-foreground/45 text-[10px] leading-tight">{it.sub}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ControlsGuide() {
  const captureMode = useSceneStore((s) => s.captureMode);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
      ? "touch"
      : "mouse",
  );
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Auto-detect modality: track the last pointer type used anywhere, so the tab reflects how the user
  // is actually interacting. setMode no-ops when unchanged, so ordinary same-input clicks don't render.
  useEffect(() => {
    const onPointer = (e: PointerEvent) => setMode(e.pointerType === "touch" ? "touch" : "mouse");
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, []);

  // Live behavior highlight: while open, read the activity signal each frame and light the matching
  // row. Treated as idle ~260ms after the last mark, so the highlight clears when the gesture stops.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const fresh =
        performance.now() - cameraActivity.at < 260 ? cameraActivity.action : null;
      const label = fresh ? ACTION_LABEL[fresh] : null;
      setActiveLabel((prev) => (prev === label ? prev : label));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Dismiss with Esc only — a click on the scene must NOT close it, so the panel stays up while you
  // try the gestures. The ✕ and the "?" button are the explicit closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (captureMode) return null; // headless stills hide all UI

  return (
    <>
      {open && (
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Camera controls"
          className="border-foreground/10 bg-popover/95 text-foreground pointer-events-auto fixed right-3 bottom-16 z-20 flex max-h-[75dvh] w-60 flex-col overflow-y-auto rounded-lg border p-2.5 shadow-xl backdrop-blur-md"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-foreground/80 text-xs font-semibold tracking-wide">Controls</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-foreground/50 hover:text-foreground text-sm leading-none"
            >
              ✕
            </button>
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="mb-1.5 w-full">
              <TabsTrigger
                value="mouse"
                className="flex-1 data-[state=active]:bg-amber-500 data-[state=active]:text-black"
              >
                Mouse
              </TabsTrigger>
              <TabsTrigger
                value="touch"
                className="flex-1 data-[state=active]:bg-amber-500 data-[state=active]:text-black"
              >
                Touch
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Rows items={mode === "mouse" ? MOUSE_ITEMS : TOUCH_ITEMS} active={activeLabel} />
          <div className="border-foreground/10 mt-2 flex flex-wrap gap-1 border-t pt-2">
            {KEYS.map(([k, v]) => (
              <span
                key={k}
                className="bg-foreground/5 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px]"
              >
                <kbd className="bg-foreground/10 text-foreground/80 rounded px-1 font-mono text-[9px]">
                  {k}
                </kbd>
                <span className="text-foreground/50">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Camera controls"
        title="Camera controls"
        className={cn(
          "border-foreground/10 bg-popover/70 text-foreground/85 hover:bg-foreground/10 pointer-events-auto fixed right-3 bottom-3 z-20 flex size-11 items-center justify-center rounded-full border text-lg font-semibold shadow-lg backdrop-blur-md transition-colors",
          open && "bg-foreground/10",
        )}
      >
        ?
      </button>
    </>
  );
}
