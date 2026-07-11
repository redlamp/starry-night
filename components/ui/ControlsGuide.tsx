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
import { toggleProjection, toggleAllWireframe } from "@/lib/scene/cameraView";
import { Eye, MapPin, Move } from "lucide-react";
import { getCameraModelMeta } from "@/components/scene/camera-models/catalog";
import type { CameraModelId } from "@/lib/state/sceneStore";
import { IconTip } from "@/components/ui/columns/EntityColumns";

// In-app controls cheat-sheet. A small, NON-MODAL card anchored bottom-right (no scrim — it STAYS UP
// while you test the gestures; dismiss with the ✕, the "?" button, or Esc — a click on the scene does
// not close it). shadcn Tabs split Mouse vs Touch and AUTO-SWITCH to whichever input you last used.
// As you perform a gesture, its row HIGHLIGHTS amber (DreiSceneControls marks the live action via
// lib/scene/cameraActivity). Glyphs are editable SVG assets in public/controls/*.svg (open in Figma);
// the active part — pressed button / fingertips / motion arrows — is the app's selection amber.
// Bindings live in DreiSceneControls; keep this list in sync when they change.

type Mode = "mouse" | "touch";
type Item = {
  icon: string;
  motion?: "ud" | "all" | "lr";
  badge?: string;
  label: string;
  sub?: string;
  affordance?: "pin" | "move" | "eye"; // right-aligned scene-affordance icon (mirrors the on-screen glyph)
  action?: CameraAction; // which live activity signal lights this row (explicit — labels are copy, not ids)
};

// Focal Height's one-button twin uses Ctrl on Windows/Linux, ⌘ on macOS — resolve to the user's
// platform so the hint shows the one key they actually press. navigator only exists client-side; the
// panel content isn't rendered during SSR (closed by default), so this module-eval value is correct.
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";

// Map model — the full hands-on controller (the original sheet).
const MAP_MOUSE: Item[] = [
  { icon: "mouse-left", motion: "all", label: "Rotate & Tilt", action: "rotate" },
  { icon: "mouse-right", motion: "all", label: "Move", sub: "Shift + LMB", action: "pan" },
  { icon: "mouse-wheel", motion: "ud", label: "Zoom", sub: "z: cursor ↔ pin", action: "zoom" },
  { icon: "mouse-both", motion: "ud", label: "Focal Height", sub: `${MOD} + LMB`, action: "focalY" },
  { icon: "mouse-left", badge: "×2", label: "Reset", sub: "double-click", action: "reset" },
];
const MAP_TOUCH: Item[] = [
  { icon: "finger-1", motion: "all", label: "Rotate & Tilt", action: "rotate" },
  { icon: "finger-2", motion: "all", label: "Move", action: "pan" },
  { icon: "pinch", label: "Zoom", sub: "pinch in / out", action: "zoom" },
  { icon: "pin", motion: "ud", label: "Focal Height", sub: "drag the pin", action: "focalY" },
  { icon: "finger-1", badge: "×2", label: "Reset", sub: "double-tap", action: "reset" },
];

type KeyRow = { cap: string; label: string; action?: CameraAction };
type GuideSpec = {
  mouse: Item[];
  touch: Item[];
  keys?: KeyRow[]; // keyboard rows (Fly) — shown on the Mouse tab only
  note?: string; // shown when a model has few/no pointer gestures
  hotkeys: HotkeyId[]; // which toggle switches are relevant to this model
};

// Per-model control sheets. The guide renders whichever matches the active cameraModel, so
// it only ever shows gestures that do something now. Typed Record<CameraModelId, …> so a new
// model without a sheet is a compile error (mirrors the model registry). HotkeyId is declared
// just below — TS hoists the type, so forward-referencing it here is fine.
const MODEL_GUIDE: Record<CameraModelId, GuideSpec> = {
  map: {
    mouse: MAP_MOUSE,
    touch: MAP_TOUCH,
    hotkeys: ["autoOrbit", "projection", "showPin", "zoom", "settings"],
  },
  drift: {
    mouse: [],
    touch: [],
    note: "Hands-off — Drift flies itself. Pause it with the Auto-Orbit toggle below (or Space).",
    hotkeys: ["autoOrbit", "projection", "settings"],
  },
  turntable: {
    mouse: [{ icon: "mouse-left", motion: "lr", label: "Spin", sub: "drag left / right" }],
    touch: [{ icon: "finger-1", motion: "lr", label: "Spin", sub: "drag left / right" }],
    note: "Grab and drag to spin it by hand; the auto-spin resumes after a beat.",
    hotkeys: ["autoOrbit", "projection", "settings"],
  },
  topdown: {
    mouse: [],
    touch: [],
    note: "Fixed plan view — north up, straight down at the city centre. No camera controls.",
    hotkeys: ["settings"],
  },
  fly: {
    mouse: [
      { icon: "mouse-left", motion: "all", label: "Look", sub: "drag" },
      { icon: "mouse-wheel", motion: "ud", label: "Speed", sub: "wheel" },
    ],
    touch: [{ icon: "finger-1", motion: "all", label: "Look", sub: "drag" }],
    keys: [
      { cap: "W A S D", label: "Fly / Strafe" },
      { cap: "E / Q", label: "Up / Down" },
      { cap: "Shift", label: "Sprint" },
    ],
    hotkeys: ["settings"],
  },
  snv2: {
    mouse: [
      { icon: "mouse-left", motion: "all", label: "Rotate & Tilt", affordance: "pin", action: "rotate" },
      {
        icon: "mouse-right",
        motion: "all",
        label: "Move",
        sub: "or Shift + LMB",
        affordance: "move",
        action: "pan",
      },
      {
        icon: "mouse-both",
        motion: "all",
        label: "Look Around",
        sub: `or ${MOD} + LMB`,
        affordance: "eye",
        action: "look",
      },
      { icon: "mouse-wheel", motion: "ud", label: "Zoom", action: "zoom" },
      { icon: "mouse-left", badge: "×2", label: "Zoom In", sub: "double-click", action: "zoomIn" },
    ],
    touch: [
      { icon: "finger-1", motion: "all", label: "Move", action: "pan" },
      { icon: "pinch", label: "Zoom + Rotate", sub: "two fingers", action: "zoom" },
    ],
    keys: [
      { cap: "W A S D", label: "Move", action: "pan" },
      { cap: "Q / E", label: "Down / Up" },
      { cap: "R", label: "Reset Camera", action: "reset" },
    ],
    hotkeys: ["projection", "wireframe", "inspect", "settings"],
  },
  googleearth: {
    mouse: [
      { icon: "mouse-left", motion: "all", label: "Move", sub: "drag the ground", action: "pan" },
      { icon: "mouse-right", motion: "all", label: "Orbit + Tilt", sub: "or Shift + LMB", action: "rotate" },
      { icon: "mouse-wheel", motion: "ud", label: "Zoom", action: "zoom" },
      { icon: "mouse-left", badge: "×2", label: "Zoom In", sub: "double-click", action: "zoomIn" },
    ],
    touch: [
      { icon: "finger-1", motion: "all", label: "Move", action: "pan" },
      { icon: "pinch", label: "Zoom + Rotate", sub: "two fingers", action: "zoom" },
    ],
    note: "Google Earth reference controls (perspective only).",
    hotkeys: ["settings"],
  },
  dreimap: {
    mouse: [
      { icon: "mouse-left", motion: "all", label: "Pan", sub: "drag the ground", action: "pan" },
      { icon: "mouse-right", motion: "all", label: "Orbit", action: "rotate" },
      { icon: "mouse-wheel", motion: "ud", label: "Zoom", action: "zoom" },
    ],
    touch: [
      { icon: "finger-1", motion: "all", label: "Pan", action: "pan" },
      { icon: "finger-2", motion: "all", label: "Orbit", action: "rotate" },
      { icon: "pinch", label: "Zoom", sub: "pinch in / out", action: "zoom" },
    ],
    note: "Vanilla drei MapControls — perspective only.",
    hotkeys: ["settings"],
  },
  dreicamera: {
    mouse: [
      { icon: "mouse-left", motion: "all", label: "Orbit", action: "rotate" },
      { icon: "mouse-right", motion: "all", label: "Move", sub: "truck", action: "pan" },
      { icon: "mouse-wheel", motion: "ud", label: "Dolly", sub: "zoom", action: "zoom" },
    ],
    touch: [
      { icon: "finger-1", motion: "all", label: "Orbit", action: "rotate" },
      { icon: "pinch", label: "Zoom + Pan", sub: "two fingers", action: "zoom" },
    ],
    note: "Vanilla camera-controls — perspective only.",
    hotkeys: ["settings"],
  },
};

// Toggle rows under the gestures: the keyboard shortcut (desktop only) + label + a live Switch wired
// to the SAME store state the key flips, so the card doubles as a control surface. On touch the keycap
// is hidden (no keyboard) but the label + switch stay. Keys mirror the app's real shortcuts.
type HotkeyId = "autoOrbit" | "projection" | "showPin" | "zoom" | "settings" | "wireframe" | "inspect";
const HOTKEYS: { k?: string; label: string; icon?: string; id: HotkeyId }[] = [
  { k: "Space", label: "Auto-Orbit", id: "autoOrbit" },
  { k: "P", label: "Perspective / Ortho", id: "projection" },
  { k: "F", label: "Wireframe", id: "wireframe" },
  { k: "I", label: "Inspect Buildings", id: "inspect" },
  { label: "Show Pin", icon: "pin", id: "showPin" }, // no keycap — `i` is now Inspect (global)
  { k: "Z", label: "Zoom", id: "zoom" },
  { k: "H", label: "Settings", id: "settings" },
];

function Glyph({
  icon,
  motion,
  badge,
}: {
  icon: string;
  motion?: "ud" | "all" | "lr";
  badge?: string;
}) {
  return (
    <span className="flex w-20 shrink-0 items-center justify-start gap-1.5">
      {icon === "pin" ? (
        // the actual scene pin — lucide MapPin in the same sky-blue (#7dd3fc = sky-300) it renders at
        <MapPin className="h-9 w-auto text-sky-300" strokeWidth={2.5} />
      ) : (
        <img
          src={asset(`/controls/${icon}.svg`)}
          alt=""
          className="h-10 w-auto"
          draggable={false}
        />
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

// Right-aligned scene-affordance icon on a control row: the same blue marker / glyph that appears in
// the scene during that gesture — pin (rotate/tilt), move arrows (move), eye (free-look) — so the sheet
// reads as "this is what you'll see". Same sky-blue (#7dd3fc) the scene renders them in.
function AffordanceIcon({ kind }: { kind: NonNullable<Item["affordance"]> }) {
  const Icon = kind === "pin" ? MapPin : kind === "move" ? Move : Eye;
  return <Icon aria-hidden className="ml-auto size-6 shrink-0 text-sky-300" strokeWidth={2.5} />;
}

function Rows({ items, active }: { items: Item[]; active: CameraAction | null }) {
  return (
    <div className="flex flex-col">
      {items.map((it, i) => {
        const on = active != null && it.action === active;
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
                className={cn(
                  "text-base",
                  on ? "font-medium text-amber-300" : "text-foreground/90",
                )}
              >
                {it.label}
              </div>
              {it.sub && <div className="text-foreground/45 text-xs leading-tight">{it.sub}</div>}
            </div>
            {it.affordance && <AffordanceIcon kind={it.affordance} />}
          </div>
        );
      })}
    </div>
  );
}

// Keyboard rows (Fly's WASD / E·Q / Shift, snv2's WASD / Q·E / R). No glyph assets for keys, so
// render keycaps in the same amber style + size as the hotkey switches below (matching keycap
// column). Rows with an action highlight like the gesture rows do — "Move" lights while gliding,
// "Reset Camera" for the whole R flight.
function KeyRows({ rows, active }: { rows: KeyRow[]; active: CameraAction | null }) {
  return (
    <div className="flex flex-col gap-1 py-1">
      {rows.map((r, i) => {
        const on = active != null && r.action === active;
        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 rounded px-1.5 py-1 transition-colors",
              on ? "bg-amber-500/15" : "hover:bg-foreground/5",
            )}
          >
            <kbd className="inline-flex min-w-[3rem] justify-center rounded bg-amber-400 px-1.5 py-0.5 font-mono text-xs font-semibold text-black">
              {r.cap}
            </kbd>
            <span
              className={cn("text-sm", on ? "font-medium text-amber-300" : "text-foreground/90")}
            >
              {r.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Live toggle switches for the camera shortcuts — each reads + writes the SAME store state its key
// flips, so the card doubles as a control surface (essential on touch, which has no keyboard). Only
// the shortcuts relevant to the active model are shown (ids).
function HotkeyToggles({ showKeys, ids }: { showKeys: boolean; ids: HotkeyId[] }) {
  const orbitPaused = useSceneStore((s) => s.orbitPaused);
  const setOrbitPaused = useSceneStore((s) => s.setOrbitPaused);
  const isOrtho = useSceneStore((s) => s.projection === "orthographic");
  const showPin = useSceneStore((s) => s.showFocalIndicator);
  const setShowPin = useSceneStore((s) => s.setShowFocalIndicator);
  const zoomToPin = useSceneStore((s) => s.orbitZoomToPin);
  const setZoomToPin = useSceneStore((s) => s.setOrbitZoomToPin);
  const panelHidden = useSceneStore((s) => s.panelHidden);
  const setPanelHidden = useSceneStore((s) => s.setPanelHidden);
  const inspectMode = useSceneStore((s) => s.inspectMode);
  const setInspectMode = useSceneStore((s) => s.setInspectMode);
  const allWireframe = useSceneStore((s) =>
    Object.values(s.debug.renderModes).every((m) => m === "wireframe"),
  );

  const state: Record<HotkeyId, { on: boolean; toggle: (v: boolean) => void }> = {
    autoOrbit: { on: !orbitPaused, toggle: (v) => setOrbitPaused(!v) },
    projection: { on: isOrtho, toggle: () => toggleProjection() },
    wireframe: { on: allWireframe, toggle: () => toggleAllWireframe() },
    inspect: { on: inspectMode, toggle: (v) => setInspectMode(v) },
    showPin: { on: showPin, toggle: (v) => setShowPin(v) },
    zoom: { on: zoomToPin, toggle: (v) => setZoomToPin(v) },
    settings: { on: !panelHidden, toggle: (v) => setPanelHidden(!v) },
  };

  const rows = HOTKEYS.filter((hk) => ids.includes(hk.id));
  if (rows.length === 0) return null;
  return (
    <div className="border-foreground/10 mt-2.5 flex flex-col gap-1 border-t pt-2.5">
      {rows.map((hk) => {
        const s = state[hk.id];
        return (
          <div key={hk.id} className="flex items-center gap-2 px-1.5 py-1">
            {showKeys &&
              (hk.k ? (
                <kbd className="inline-flex min-w-[3rem] justify-center rounded bg-amber-400 px-1.5 py-0.5 font-mono text-xs font-semibold text-black">
                  {hk.k}
                </kbd>
              ) : (
                // no shortcut (Show Pin lost its `i` key to Inspect) — hold the column width
                <span className="min-w-[3rem]" aria-hidden />
              ))}
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
  const cameraModel = useSceneStore((s) => s.cameraModel);
  const idle = useIdle(); // fade the "?" button when idle (unless the panel is open)
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
      ? "touch"
      : "mouse",
  );
  const [activeAction, setActiveAction] = useState<CameraAction | null>(null);
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
      const fresh = performance.now() - cameraActivity.at < 260 ? cameraActivity.action : null;
      setActiveAction((prev) => (prev === fresh ? prev : fresh));
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

  const guide = MODEL_GUIDE[cameraModel] ?? MODEL_GUIDE.map;
  const meta = getCameraModelMeta(cameraModel);
  const items = mode === "mouse" ? guide.mouse : guide.touch;

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
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="text-foreground/80 text-sm font-semibold tracking-wide">
                Controls
              </span>
              <span className="text-foreground/45 truncate text-xs">{meta.label}</span>
            </div>
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
          {items.length > 0 && <Rows items={items} active={activeAction} />}
          {mode === "mouse" && guide.keys && <KeyRows rows={guide.keys} active={activeAction} />}
          {guide.note && (
            <p className="text-foreground/55 px-1.5 py-1.5 text-sm leading-snug">{guide.note}</p>
          )}
          {items.length === 0 && !guide.keys && !guide.note && (
            <p className="text-foreground/45 px-1.5 py-1.5 text-sm">No pointer controls.</p>
          )}
          <HotkeyToggles showKeys={mode === "mouse"} ids={guide.hotkeys} />
        </div>
      )}
      <IconTip label="Camera Controls">
        <button
          ref={btnRef}
          onClick={() => setOpen((o) => !o)}
          aria-label="Camera controls"
          className={cn(
            "border-foreground/10 bg-popover/70 text-foreground/85 hover:bg-foreground/10 fixed right-3 bottom-3 z-20 flex size-11 items-center justify-center rounded-full border text-lg font-semibold shadow-lg backdrop-blur-md transition-[opacity,background-color,color] duration-700",
            open && "border-transparent bg-primary text-primary-foreground",
            idle && !open ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100",
          )}
        >
          ?
        </button>
      </IconTip>
    </>
  );
}
