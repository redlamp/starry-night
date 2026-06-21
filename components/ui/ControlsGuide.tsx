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
import { useIdle } from "@/lib/useIdle";
import { Switch } from "@/components/ui/switch";
import { toggleProjection } from "@/lib/scene/cameraView";
import { MapPin } from "lucide-react";

// In-app controls cheat-sheet. A small, NON-MODAL card anchored bottom-right (no scrim — it STAYS UP
// while you test the gestures; dismiss with the ✕, the "?" button, or Esc — a click on the scene does
// not close it). shadcn Tabs split Mouse vs Touch and AUTO-SWITCH to whichever input you last used.
// As you perform a gesture, its row HIGHLIGHTS amber (DreiSceneControls marks the live action via
// lib/scene/cameraActivity). Glyphs are editable SVG assets in public/controls/*.svg (open in Figma);
// the active part — pressed button / fingertips / motion arrows — is the app's selection amber.
// Bindings live in DreiSceneControls; keep this list in sync when they change.

type Mode = "mouse" | "touch";
type Item = { icon: string; motion?: "ud" | "all"; badge?: string; label: string; sub?: string };

// Focal Height's one-button twin uses Ctrl on Windows/Linux, ⌘ on macOS — resolve to the user's
// platform so the hint shows the one key they actually press. navigator only exists client-side; the
// panel content isn't rendered during SSR (closed by default), so this module-eval value is correct.
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";

const MOUSE_ITEMS: Item[] = [
  { icon: "mouse-left", motion: "all", label: "Rotate & Tilt" },
  { icon: "mouse-right", motion: "all", label: "Move", sub: "Shift + LMB" },
  { icon: "mouse-wheel", motion: "ud", label: "Zoom", sub: "z: cursor ↔ pin" },
  { icon: "mouse-both", motion: "ud", label: "Focal Height", sub: `${MOD} + LMB` },
  { icon: "mouse-left", badge: "×2", label: "Reset", sub: "double-click" },
];
const TOUCH_ITEMS: Item[] = [
  { icon: "finger-1", motion: "all", label: "Rotate & Tilt" },
  { icon: "finger-2", motion: "all", label: "Move" },
  { icon: "pinch", label: "Zoom", sub: "pinch in / out" },
  { icon: "pin", motion: "ud", label: "Focal Height", sub: "drag the pin" },
  { icon: "finger-1", badge: "×2", label: "Reset", sub: "double-tap" },
];

// Toggle rows under the gestures: the keyboard shortcut (desktop only) + label + a live Switch wired
// to the SAME store state the key flips, so the card doubles as a control surface. On touch the keycap
// is hidden (no keyboard) but the label + switch stay. Keys mirror the app's real shortcuts.
type HotkeyId = "autoOrbit" | "projection" | "showPin" | "zoom" | "settings";
const HOTKEYS: { k: string; label: string; icon?: string; id: HotkeyId }[] = [
  { k: "Space", label: "Auto-Orbit", id: "autoOrbit" },
  { k: "P", label: "Ortho / Perspective", id: "projection" },
  { k: "I", label: "Show Pin", icon: "pin", id: "showPin" },
  { k: "Z", label: "Zoom", id: "zoom" },
  { k: "H", label: "Settings", id: "settings" },
];

// which row each live action maps to (label-matched, so the highlight lands in either tab)
const ACTION_LABEL: Record<CameraAction, string> = {
  rotate: "Rotate & Tilt",
  focalY: "Focal Height",
  pan: "Move",
  look: "Look Around",
  zoom: "Zoom",
  reset: "Reset",
};

function Glyph({ icon, motion, badge }: { icon: string; motion?: "ud" | "all"; badge?: string }) {
  return (
    <span className="flex w-20 shrink-0 items-center justify-start gap-1.5">
      {icon === "pin" ? (
        // the actual scene pin — lucide MapPin in the same sky-blue (#7dd3fc = sky-300) it renders at
        <MapPin className="h-9 w-auto text-sky-300" strokeWidth={2.5} />
      ) : (
        <img src={asset(`/controls/${icon}.svg`)} alt="" className="h-10 w-auto" draggable={false} />
      )}
      {motion && (
        <img
          src={asset(`/controls/motion-${motion}.svg`)}
          alt=""
          className="h-8 w-8"
          draggable={false}
        />
      )}
      {badge && <span className="text-xl font-bold text-amber-500">{badge}</span>}
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
              "flex h-12 items-center gap-3 rounded px-1.5 transition-colors",
              on ? "bg-amber-500/15" : "hover:bg-foreground/5",
            )}
          >
            <Glyph icon={it.icon} motion={it.motion} badge={it.badge} />
            <div className="min-w-0">
              <div
                className={cn("text-base", on ? "font-medium text-amber-300" : "text-foreground/90")}
              >
                {it.label}
              </div>
              {it.sub && <div className="text-foreground/45 text-xs leading-tight">{it.sub}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Live toggle switches for the camera shortcuts — each reads + writes the SAME store state its key
// flips, so the card doubles as a control surface (essential on touch, which has no keyboard).
function HotkeyToggles({ showKeys }: { showKeys: boolean }) {
  const orbitPaused = useSceneStore((s) => s.orbitPaused);
  const setOrbitPaused = useSceneStore((s) => s.setOrbitPaused);
  const isOrtho = useSceneStore((s) => s.projection === "orthographic");
  const showPin = useSceneStore((s) => s.showFocalIndicator);
  const setShowPin = useSceneStore((s) => s.setShowFocalIndicator);
  const zoomToPin = useSceneStore((s) => s.orbitZoomToPin);
  const setZoomToPin = useSceneStore((s) => s.setOrbitZoomToPin);
  const panelHidden = useSceneStore((s) => s.panelHidden);
  const setPanelHidden = useSceneStore((s) => s.setPanelHidden);

  const state: Record<HotkeyId, { on: boolean; toggle: (v: boolean) => void }> = {
    autoOrbit: { on: !orbitPaused, toggle: (v) => setOrbitPaused(!v) },
    projection: { on: isOrtho, toggle: () => toggleProjection() },
    showPin: { on: showPin, toggle: (v) => setShowPin(v) },
    zoom: { on: zoomToPin, toggle: (v) => setZoomToPin(v) },
    settings: { on: !panelHidden, toggle: (v) => setPanelHidden(!v) },
  };

  return (
    <div className="border-foreground/10 mt-2.5 flex flex-col gap-2 border-t pt-2.5">
      {HOTKEYS.map((hk) => {
        const s = state[hk.id];
        return (
          <div key={hk.id} className="flex items-center gap-2">
            {showKeys && (
              <kbd className="inline-flex min-w-[3rem] justify-center rounded bg-amber-400 px-1.5 py-0.5 font-mono text-xs font-semibold text-black">
                {hk.k}
              </kbd>
            )}
            <span className="text-foreground/70 text-sm">{hk.label}</span>
            {hk.icon === "pin" && <MapPin className="h-5 w-auto text-sky-300" strokeWidth={2.5} />}
            <Switch checked={s.on} onCheckedChange={s.toggle} size="sm" className="ml-auto" />
          </div>
        );
      })}
    </div>
  );
}

export function ControlsGuide() {
  const captureMode = useSceneStore((s) => s.captureMode);
  const idle = useIdle(); // fade the "?" button when idle (unless the panel is open)
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
          className="border-foreground/10 bg-popover/70 text-foreground pointer-events-auto fixed right-3 bottom-16 z-30 flex max-h-[75dvh] w-80 flex-col overflow-y-auto rounded-lg border p-3 shadow-2xl backdrop-blur-md"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-foreground/80 text-sm font-semibold tracking-wide">Controls</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-foreground/50 hover:text-foreground text-base leading-none"
            >
              ✕
            </button>
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="mb-2 w-full">
              <TabsTrigger
                value="mouse"
                className="flex-1 text-sm data-[state=active]:bg-amber-500 data-[state=active]:text-black"
              >
                Mouse
              </TabsTrigger>
              <TabsTrigger
                value="touch"
                className="flex-1 text-sm data-[state=active]:bg-amber-500 data-[state=active]:text-black"
              >
                Touch
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Rows items={mode === "mouse" ? MOUSE_ITEMS : TOUCH_ITEMS} active={activeLabel} />
          <HotkeyToggles showKeys={mode === "mouse"} />
        </div>
      )}
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Camera controls"
        title="Camera controls"
        className={cn(
          "border-foreground/10 bg-popover/70 text-foreground/85 hover:bg-foreground/10 fixed right-3 bottom-3 z-20 flex size-11 items-center justify-center rounded-full border text-lg font-semibold shadow-lg backdrop-blur-md transition-[opacity,background-color] duration-700",
          open && "bg-foreground/10",
          idle && !open ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100",
        )}
      >
        ?
      </button>
    </>
  );
}
