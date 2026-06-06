"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Map,
  Building2,
  Dices,
  Expand,
  Milestone,
  Route,
  Lightbulb,
  Ruler,
  Scaling,
  Spline,
  LayoutGrid,
  X,
} from "lucide-react";
import { PlanView, type PlanLayers } from "@/components/plan/PlanView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LabSection as Section, LabSlider } from "@/components/ui/lab-controls";
import {
  NumberField,
  NumberFieldScrubArea,
  NumberFieldGroup,
  NumberFieldDecrement,
  NumberFieldInput,
  NumberFieldIncrement,
} from "@/components/ui/number-field";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogPopup,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { TIER_LABELS, tierKm } from "@/components/ui/cityTiers";
import { CITY_TIER_ORDER } from "@/lib/seed/topology";
import { useSceneStore } from "@/lib/state/sceneStore";
import { isTypingTarget } from "@/lib/utils";

// Sorted largest feature → smallest, per the requested order.
const LAYER_KEYS: (keyof PlanLayers)[] = [
  "districts",
  "buildings",
  "streets",
  "arterials",
  "highways",
  "streetlights",
];

const LAYER_ICONS: Record<keyof PlanLayers, React.ReactNode> = {
  districts: <Map size={16} />,
  buildings: <Building2 size={16} />,
  streets: <Spline size={16} />,
  arterials: <Route size={16} />,
  highways: <Milestone size={16} />,
  streetlights: <Lightbulb size={16} />,
};

const DEFAULT_COUNT = 4;
const TILE_GAP = 12;
const HANDLE_W = 4; // the w-1 sidebar drag handle
const CELL_STEP = 20; // tile-size slider step; fit-mode rounds to it too
const CELL_MIN = 160;
const CELL_MAX = 960;

// Fit mode: the largest tile size at which `count` tiles cover the content area
// without scrolling — try every column split, keep the best. Rounded DOWN to the
// slider step so sidebar/window drags only redraw the canvases per step crossed.
function fitCellSize(count: number, w: number, h: number): number {
  let best = 0;
  for (let c = 1; c <= count; c++) {
    const r = Math.ceil(count / c);
    best = Math.max(best, Math.min((w - (c - 1) * TILE_GAP) / c, (h - (r - 1) * TILE_GAP) / r));
  }
  return Math.min(CELL_MAX, Math.max(CELL_MIN, Math.floor(best / CELL_STEP) * CELL_STEP));
}

export function PlanPage() {
  const [baseSeed, setBaseSeed] = useState("plan");
  const [seedCount, setSeedCount] = useState(DEFAULT_COUNT);
  const [autoFill, setAutoFill] = useState(false);
  // null = fit mode (default): size derives from count + content area. Dragging
  // the tile slider sets a manual size; the Fit button returns to null.
  const [cellSize, setCellSize] = useState<number | null>(null);
  const [layers, setLayers] = useState<PlanLayers>({
    districts: true,
    buildings: true,
    highways: true,
    arterials: true,
    streets: true,
    streetlights: false,
  });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  // STATE, not a ref: the Dialog popup mounts in base-ui's portal a render
  // AFTER `activeIndex` opens it, so an effect keyed on activeIndex reads a
  // still-null ref and never attaches the wheel listener. A state-ref re-runs
  // the effects exactly when the node appears/disappears.
  const [zoomEl, setZoomEl] = useState<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  // City size tier — the SAME store setting as the settings panel (#58), so the
  // scene and every plan tile share one tier. Drag previews the label only; the
  // store (and therefore generation, × every tile here) commits on RELEASE —
  // same rationale as the settings panel's notched slider.
  const citySize = useSceneStore((s) => s.citySize);
  const setCitySize = useSceneStore((s) => s.setCitySize);
  const tierIdx = CITY_TIER_ORDER.indexOf(citySize);
  const [dragTierIdx, setDragTierIdx] = useState<number | null>(null);
  const shownTier = CITY_TIER_ORDER[dragTierIdx ?? tierIdx];

  // Sidebar width — drag the border to resize (same pattern as the tensor lab).
  const [sideW, setSideW] = useState(300);
  const sideDrag = useRef(false);
  const contentLeft = sideW + HANDLE_W;

  // Window size so the tile grid can auto-fill the content area and the
  // lightbox can pin the square plan to the smaller side.
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Fit and Fill are inverse auto modes: Fit (the default) fixes the COUNT and
  // derives the tile size from the content area; Fill fixes the SIZE and derives
  // the count. Fit therefore computes from `seedCount` (enabling Fill freezes
  // the size first, so the two never chase each other).
  const contentW = vp.w - contentLeft;
  const usableW = contentW - 32; // grid p-4 (16px) each side
  const usableH = vp.h - 32;
  const fitted = fitCellSize(seedCount, usableW, usableH);
  const effectiveCell = cellSize ?? fitted;

  // Auto-fill: enough tiles to cover the content area right of the sidebar —
  // cols floor so the row never h-scrolls, rows ceil so there's no empty band
  // at the bottom. Editing `count` switches to a manual override; the Fill
  // button re-enables it.
  const cols = Math.max(1, Math.floor(usableW / (effectiveCell + TILE_GAP)));
  const rows = Math.max(1, Math.ceil(usableH / (effectiveCell + TILE_GAP)));
  const fillCount = Math.min(64, cols * rows);
  const effectiveCount = autoFill ? fillCount : seedCount;

  // Lightbox tracks the tile INDEX, not a frozen seed string, so rerolling
  // updates the enlarged view live. Tensor is the only city model now.
  const seedFor = (i: number) => `${baseSeed}-${i}`;
  const seeds = Array.from({ length: effectiveCount }, (_, i) => seedFor(i));
  const activeSeed = activeIndex !== null ? seedFor(activeIndex) : null;

  // Lightbox: fills the content area (right of the sidebar). The (square) plan
  // fits the smaller axis at zoom 1; `baseSize × zoom` is the rendered pixel
  // size, panned/zoomed inside the rectangle.
  const lbAvailW = Math.max(240, contentW - 32); // popup p-4 (16px) each side
  const lbAvailH = Math.max(240, vp.h - 32 - 44); // − padding − header
  const baseSize = Math.floor(Math.min(lbAvailW, lbAvailH));

  // Lightbox keyboard nav: Esc closes (the Dialog also handles this),
  // Left/Right step (wrapping) through tiles — unless focus is in a text field.
  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveIndex(null);
      else if (isTypingTarget(e)) return;
      else if (e.key === "ArrowRight") {
        setActiveIndex((i) => (i === null ? i : (i + 1) % effectiveCount));
        setZoom(1);
      } else if (e.key === "ArrowLeft") {
        setActiveIndex((i) => (i === null ? i : (i - 1 + effectiveCount) % effectiveCount));
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, effectiveCount]);

  // Lightbox wheel-zoom. Native non-passive listener so preventDefault actually
  // blocks page scroll (React's onWheel is passive). The plan re-renders at a
  // larger pixel size (crisp, not CSS-upscaled); the scroll container recenters
  // on each step so the city stays centred. Zoom is reset to 1 wherever the
  // active tile changes (tile-open + arrow-nav), so no set-state-in-effect.
  useEffect(() => {
    if (zoomEl === null) return; // only mounted while the lightbox is open
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    zoomEl.addEventListener("wheel", onWheel, { passive: false });
    return () => zoomEl.removeEventListener("wheel", onWheel);
  }, [zoomEl]);
  useEffect(() => {
    if (zoomEl === null) return;
    zoomEl.scrollLeft = (zoomEl.scrollWidth - zoomEl.clientWidth) / 2;
    zoomEl.scrollTop = (zoomEl.scrollHeight - zoomEl.clientHeight) / 2;
  }, [zoomEl, zoom, baseSize, activeIndex]);

  function toggleLayer(key: keyof PlanLayers) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function reroll() {
    setBaseSeed(Math.random().toString(36).slice(2, 8));
  }

  // Drag-to-pan inside the zoomed lightbox (pointer events → mouse + touch).
  function onPanDown(e: React.PointerEvent<HTMLDivElement>) {
    if (zoomEl === null) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sl: zoomEl.scrollLeft, st: zoomEl.scrollTop };
    zoomEl.setPointerCapture(e.pointerId);
  }
  function onPanMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (zoomEl === null || d === null) return;
    zoomEl.scrollLeft = d.sl - (e.clientX - d.x);
    zoomEl.scrollTop = d.st - (e.clientY - d.y);
  }
  function onPanUp(e: React.PointerEvent<HTMLDivElement>) {
    if (zoomEl !== null && zoomEl.hasPointerCapture(e.pointerId))
      zoomEl.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }

  return (
    <TooltipProvider>
      <main className="fixed inset-0 flex bg-[#080c18] text-white">
        {/* Left sidebar — all settings (layout mirrors the tensor lab) */}
        <aside className="shrink-0" style={{ width: sideW }}>
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex items-baseline justify-between">
                <h1 className="font-mono text-sm text-zinc-300">Plan view</h1>
                <Button
                  variant="link"
                  size="xs"
                  className="px-0 text-zinc-400 hover:text-white"
                  render={<Link href="/" />}
                  nativeButton={false}
                >
                  ← scene
                </Button>
              </div>
              <p className="-mt-3 text-xs text-zinc-500">streets-first review</p>

              <Section title="seeds">
                <div className="flex w-full items-center gap-2">
                  <span className="w-20 shrink-0 text-xs text-zinc-400">seed</span>
                  <Input
                    value={baseSeed}
                    onChange={(e) => setBaseSeed(e.target.value)}
                    className="h-8 min-w-0 flex-1 font-mono text-sm"
                  />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={reroll}
                          aria-label="Reroll seed"
                        />
                      }
                    >
                      <Dices size={16} />
                    </TooltipTrigger>
                    <TooltipContent>Reroll seed</TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex w-full items-center gap-2">
                  <NumberField
                    value={effectiveCount}
                    min={1}
                    max={64}
                    step={1}
                    onValueChange={(v) => {
                      if (v === null) return;
                      setAutoFill(false);
                      setSeedCount(Math.max(1, Math.min(64, Math.round(v))));
                    }}
                    className="min-w-0 flex-1"
                  >
                    <div className="flex w-full items-center gap-2">
                      <NumberFieldScrubArea className="w-20 shrink-0">
                        <span className="text-xs text-zinc-400">count</span>
                      </NumberFieldScrubArea>
                      <NumberFieldGroup className="min-w-0 flex-1">
                        <NumberFieldDecrement />
                        <NumberFieldInput className="font-mono text-xs" />
                        <NumberFieldIncrement />
                      </NumberFieldGroup>
                    </div>
                  </NumberField>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant={autoFill ? "secondary" : "outline"}
                          size="icon"
                          onClick={() => {
                            // Freeze the current size — Fill derives count FROM size.
                            setCellSize(effectiveCell);
                            setAutoFill(true);
                          }}
                          aria-label="Fill the view with tiles"
                        />
                      }
                    >
                      <LayoutGrid size={16} />
                    </TooltipTrigger>
                    <TooltipContent>Fill the view with tiles</TooltipContent>
                  </Tooltip>
                </div>
              </Section>

              {/* Layer toggles, largest feature → smallest. Label left, switch
                  right — the main settings panel's ToggleRow arrangement. */}
              <Section title="layers">
                {LAYER_KEYS.map((key) => (
                  <Label
                    key={key}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-normal text-zinc-300 capitalize"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-zinc-400">{LAYER_ICONS[key]}</span>
                      {key}
                    </span>
                    <Switch checked={layers[key]} onCheckedChange={() => toggleLayer(key)} />
                  </Label>
                ))}
              </Section>

              {/* #58 size tier — notched: each notch generates a DIFFERENT city
                  for the same seed (a bigger canvas re-rolls the layout). */}
              <Section title="city">
                <div className="flex items-center justify-between gap-2">
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="flex items-center gap-1.5 text-xs text-zinc-400" />}
                    >
                      <Ruler size={14} /> city size
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      Generated extent — re-rolls every tile on release
                    </TooltipContent>
                  </Tooltip>
                  <span className="font-mono text-xs text-zinc-300 tabular-nums">
                    {TIER_LABELS[shownTier]} ({tierKm(shownTier)} km)
                  </span>
                </div>
                <Slider
                  min={0}
                  max={CITY_TIER_ORDER.length - 1}
                  step={1}
                  value={dragTierIdx ?? tierIdx}
                  onValueChange={(v) => setDragTierIdx(typeof v === "number" ? v : v[0])}
                  onValueCommitted={(v) => {
                    setDragTierIdx(null);
                    setCitySize(CITY_TIER_ORDER[typeof v === "number" ? v : v[0]]);
                  }}
                  className="w-full"
                />
              </Section>

              <Section title="tiles">
                <LabSlider
                  label={
                    <>
                      <Scaling size={14} /> tile px
                    </>
                  }
                  min={CELL_MIN}
                  max={CELL_MAX}
                  step={CELL_STEP}
                  value={effectiveCell}
                  onCommit={setCellSize}
                  stacked
                  trailing={
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant={cellSize === null ? "secondary" : "outline"}
                            size="icon"
                            onClick={() => {
                              // Fit derives size FROM count — mutually exclusive with Fill.
                              setAutoFill(false);
                              setCellSize(null);
                            }}
                            aria-label="Fit tiles to the space"
                          />
                        }
                      >
                        <Expand size={16} />
                      </TooltipTrigger>
                      <TooltipContent>Fit tiles to the space</TooltipContent>
                    </Tooltip>
                  }
                />
              </Section>
            </div>
          </ScrollArea>
        </aside>

        {/* Drag handle — the sidebar border */}
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="separator"
                aria-orientation="vertical"
                className="w-1 shrink-0 cursor-col-resize touch-none bg-zinc-800 transition-colors hover:bg-sky-600 active:bg-sky-500"
                onPointerDown={(e) => {
                  sideDrag.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (sideDrag.current) setSideW(Math.min(520, Math.max(220, e.clientX)));
                }}
                onPointerUp={(e) => {
                  sideDrag.current = false;
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  sideDrag.current = false;
                }}
              />
            }
          />
          <TooltipContent side="right">Drag to resize</TooltipContent>
        </Tooltip>

        {/* Tile grid */}
        <section className="min-w-0 flex-1 overflow-auto p-4">
          <div className="flex flex-wrap gap-3">
            {seeds.map((seed, i) => (
              <Tooltip key={seed}>
                <TooltipTrigger
                  render={
                    <button
                      onClick={() => {
                        setActiveIndex(i);
                        setZoom(1);
                      }}
                      className="cursor-zoom-in overflow-hidden rounded border border-zinc-800 transition-colors hover:border-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                      style={{ width: effectiveCell, height: effectiveCell }}
                      aria-label={`Enlarge seed ${seed}`}
                    />
                  }
                >
                  <PlanView seed={seed} size={effectiveCell} layers={layers} />
                </TooltipTrigger>
                <TooltipContent>Click to enlarge: {seed}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </section>

        {/* Lightbox — a NON-modal Dialog over the content area only: the sidebar
            stays interactive (modal={false}) and sidebar clicks must not close
            it (disablePointerDismissal), so its filters + Reroll stay live and
            the enlarged view updates with them. Click the padding or press Esc
            closes; ←/→ step. */}
        <Dialog
          open={activeSeed !== null}
          onOpenChange={(open) => {
            if (!open) setActiveIndex(null);
          }}
          modal={false}
          disablePointerDismissal
        >
          <DialogPortal>
            <DialogBackdrop className="z-40 bg-black/75" style={{ left: contentLeft }} />
            <DialogPopup
              className="z-50 items-stretch justify-stretch outline-none"
              style={{ left: contentLeft }}
              onClick={() => setActiveIndex(null)}
            >
              <DialogContent
                className="w-full flex-1 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
                  <DialogTitle className="text-sm text-zinc-300">{activeSeed}</DialogTitle>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger
                        render={<span className="font-mono text-xs text-zinc-500 tabular-nums" />}
                      >
                        {Math.round(zoom * 100)}%
                      </TooltipTrigger>
                      <TooltipContent>Scroll to zoom · drag to pan</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setActiveIndex(null)}
                      aria-label="Close"
                    >
                      <X size={16} />
                    </Button>
                  </div>
                </div>
                <div
                  ref={setZoomEl}
                  onPointerDown={onPanDown}
                  onPointerMove={onPanMove}
                  onPointerUp={onPanUp}
                  onPointerCancel={onPanUp}
                  className="min-h-0 flex-1 cursor-grab touch-none overflow-auto select-none active:cursor-grabbing"
                >
                  <div className="flex min-h-full min-w-full items-center justify-center">
                    {activeSeed !== null ? (
                      <PlanView
                        seed={activeSeed}
                        size={Math.round(baseSize * zoom)}
                        layers={layers}
                      />
                    ) : null}
                  </div>
                </div>
              </DialogContent>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}
