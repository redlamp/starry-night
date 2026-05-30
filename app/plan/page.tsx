"use client";

import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Building2,
  Grid2x2,
  Milestone,
  Route,
  Lightbulb,
  Spline,
  Grid3x3,
  Maximize2,
  X,
} from "lucide-react";
import { PlanView, type PlanLayers } from "@/components/plan/PlanView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const LAYER_KEYS: (keyof PlanLayers)[] = [
  "districts",
  "buildings",
  "blocks",
  "highways",
  "arterials",
  "seams",
  "streetlights",
];

const LAYER_ICONS: Record<keyof PlanLayers, React.ReactNode> = {
  districts: <LayoutGrid size={16} />,
  buildings: <Building2 size={16} />,
  blocks: <Grid2x2 size={16} />,
  highways: <Milestone size={16} />,
  arterials: <Route size={16} />,
  seams: <Spline size={16} />,
  streetlights: <Lightbulb size={16} />,
};

const CELL_SIZE = 320;
const TILE_GAP = 12;

export default function PlanPage() {
  const [baseSeed, setBaseSeed] = useState("plan");
  const [seedCount, setSeedCount] = useState(16);
  const [autoFill, setAutoFill] = useState(true);
  const [gridFirst, setGridFirst] = useState(true);
  const [layers, setLayers] = useState<PlanLayers>({
    districts: true,
    buildings: true,
    blocks: true,
    highways: true,
    arterials: true,
    seams: true,
    streetlights: true,
  });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Measure the toolbar's viewport-bottom + window size so the tile grid can
  // auto-fill and the lightbox can pin the square plan to the smaller side.
  const barRef = useRef<HTMLDivElement>(null);
  const [barBottom, setBarBottom] = useState(72);
  const [vp, setVp] = useState({ w: 1280, h: 800 });

  useEffect(() => {
    const measure = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      if (barRef.current) setBarBottom(barRef.current.getBoundingClientRect().bottom);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Auto-fill: enough tiles to cover the area below the toolbar — cols floor so
  // the row never h-scrolls, rows ceil so there's no empty band at the bottom.
  // Editing `count` switches to a manual override; the Fill button re-enables it.
  const cols = Math.max(1, Math.floor((vp.w - 32) / (CELL_SIZE + TILE_GAP)));
  const rows = Math.max(1, Math.ceil((vp.h - barBottom - 24) / (CELL_SIZE + TILE_GAP)));
  const fillCount = Math.min(64, cols * rows);
  const effectiveCount = autoFill ? fillCount : seedCount;

  // Lightbox tracks the tile INDEX, not a frozen seed string, so toggling
  // grid-first or rerolling updates the enlarged view live.
  const seedFor = (i: number) =>
    gridFirst ? `${baseSeed}-${i}::gridfirst` : `${baseSeed}-${i}`;
  const seeds = Array.from({ length: effectiveCount }, (_, i) => seedFor(i));
  const activeSeed = activeIndex !== null ? seedFor(activeIndex) : null;

  // Lightbox keyboard nav: Esc closes, Left/Right step (wrapping) through tiles.
  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveIndex(null);
      else if (e.key === "ArrowRight")
        setActiveIndex((i) => (i === null ? i : (i + 1) % effectiveCount));
      else if (e.key === "ArrowLeft")
        setActiveIndex((i) => (i === null ? i : (i - 1 + effectiveCount) % effectiveCount));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, effectiveCount]);

  function toggleLayer(key: keyof PlanLayers) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function reroll() {
    setBaseSeed(Math.random().toString(36).slice(2, 8));
  }

  // Lightbox square: fill the area below the toolbar, pinning the smaller side
  // (−~44px header, −48px padding) so the whole panel stays on screen.
  const lightboxSize = Math.max(
    240,
    Math.floor(Math.min(vp.w - 48, vp.h - barBottom - 100)),
  );

  return (
    <main
      className="min-h-screen bg-[#080c18] p-4 text-white"
      style={{ position: "fixed", inset: 0, overflow: "auto" }}
    >
      <div
        ref={barRef}
        className="sticky top-0 z-50 mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 bg-[#080c18]/95 py-3 backdrop-blur"
      >
        <h1 className="shrink-0 font-mono text-sm text-zinc-300">
          Plan view — streets-first review
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {LAYER_KEYS.map((key) => (
            <Label
              key={key}
              className="cursor-pointer gap-2 text-sm text-zinc-200 capitalize"
            >
              <Switch checked={layers[key]} onCheckedChange={() => toggleLayer(key)} />
              <span className="text-zinc-400">{LAYER_ICONS[key]}</span>
              {key}
            </Label>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-zinc-700" aria-hidden />
          <Label className="cursor-pointer gap-2 text-sm text-zinc-200">
            <Switch checked={gridFirst} onCheckedChange={setGridFirst} />
            <span className="text-zinc-400">
              <Grid3x3 size={16} />
            </span>
            grid-first
          </Label>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Label className="gap-2 text-sm text-zinc-300">
            seed
            <Input
              value={baseSeed}
              onChange={(e) => setBaseSeed(e.target.value)}
              className="h-8 w-32 font-mono text-sm"
            />
          </Label>
          <Label className="gap-2 text-sm text-zinc-300">
            count
            <Input
              type="number"
              min={1}
              max={64}
              step={1}
              value={effectiveCount}
              onChange={(e) => {
                setAutoFill(false);
                setSeedCount(Math.max(1, Math.min(64, parseInt(e.target.value) || 1)));
              }}
              className="h-8 w-20 font-mono text-sm"
            />
          </Label>
          <Button
            variant={autoFill ? "secondary" : "outline"}
            size="icon"
            onClick={() => setAutoFill(true)}
            title="Fill the view with tiles"
            aria-label="Fill the view with tiles"
          >
            <Maximize2 size={16} />
          </Button>
          <Button variant="outline" onClick={reroll}>
            Reroll
          </Button>
          <a
            href="/"
            className="text-sm text-zinc-400 underline-offset-4 hover:text-white hover:underline"
          >
            ← scene
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {seeds.map((seed, i) => (
          <button
            key={seed}
            onClick={() => setActiveIndex(i)}
            className="cursor-zoom-in overflow-hidden rounded border border-zinc-800 transition-colors hover:border-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            style={{ width: CELL_SIZE, height: CELL_SIZE }}
            title={`Click to enlarge: ${seed}`}
            aria-label={`Enlarge seed ${seed}`}
          >
            <PlanView seed={seed} size={CELL_SIZE} layers={layers} />
          </button>
        ))}
      </div>

      {/* Lightbox — a non-modal overlay (not a modal Dialog, which would block
          the background): the toolbar sits at z-50 above the z-40 dim, so its
          filters + grid-first + Reroll stay live and the enlarged view updates
          with them. Click the dim / padding or press Esc closes; ←/→ step. */}
      {activeSeed !== null && (
        <>
          <div className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm" aria-hidden />
          <div
            className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center p-6"
            style={{ top: barBottom }}
            onClick={() => setActiveIndex(null)}
          >
            <div
              className="relative flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-[#0b1020] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
                <span className="font-mono text-sm text-zinc-300">{activeSeed}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setActiveIndex(null)}
                  aria-label="Close"
                >
                  <X size={16} />
                </Button>
              </div>
              <PlanView seed={activeSeed} size={lightboxSize} layers={layers} />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
