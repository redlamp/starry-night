"use client";

import { useState } from "react";
import {
  LayoutGrid,
  Building2,
  Milestone,
  Route,
  Lightbulb,
  X,
} from "lucide-react";
import { PlanView, type PlanLayers } from "@/components/plan/PlanView";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";

const LAYER_KEYS: (keyof PlanLayers)[] = [
  "districts",
  "buildings",
  "highways",
  "arterials",
  "streetlights",
];

const LAYER_ICONS: Record<keyof PlanLayers, React.ReactNode> = {
  districts: <LayoutGrid size={12} />,
  buildings: <Building2 size={12} />,
  highways: <Milestone size={12} />,
  arterials: <Route size={12} />,
  streetlights: <Lightbulb size={12} />,
};

const CELL_SIZE = 320;
const LIGHTBOX_SIZE = 720;

export default function PlanPage() {
  const [baseSeed, setBaseSeed] = useState("plan");
  const [seedCount, setSeedCount] = useState(16);
  const [gridFirst, setGridFirst] = useState(false);
  const [layers, setLayers] = useState<PlanLayers>({
    districts: true,
    buildings: true,
    highways: true,
    arterials: true,
    streetlights: true,
  });
  const [activeSeed, setActiveSeed] = useState<string | null>(null);

  const seeds = Array.from({ length: seedCount }, (_, i) => {
    const seed = `${baseSeed}-${i}`;
    return gridFirst ? `${seed}::gridfirst` : seed;
  });

  function toggleLayer(key: keyof PlanLayers) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function reroll() {
    setBaseSeed(Math.random().toString(36).slice(2, 8));
  }

  return (
    <main
      className="min-h-screen bg-[#080c18] p-4 text-white"
      style={{ position: "fixed", inset: 0, overflow: "auto" }}
    >
      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-4 bg-[#080c18]/95 py-2 backdrop-blur">
        <h1 className="shrink-0 font-mono text-sm text-zinc-300">
          Plan view — streets-first review
        </h1>

        <div className="flex flex-wrap items-center gap-3">
          {LAYER_KEYS.map((key) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-1.5 text-xs select-none"
            >
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => toggleLayer(key)}
                className="accent-sky-400"
              />
              <span className="flex items-center gap-1 text-zinc-300">
                <span className="text-zinc-500">{LAYER_ICONS[key]}</span>
                {key}
              </span>
            </label>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-400">seed</span>
            <input
              value={baseSeed}
              onChange={(e) => setBaseSeed(e.target.value)}
              className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-400">count</span>
            <input
              type="number"
              min="1"
              max="64"
              step="1"
              value={seedCount}
              onChange={(e) =>
                setSeedCount(
                  Math.max(1, Math.min(64, parseInt(e.target.value) || 1)),
                )
              }
              className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs select-none">
            <input
              type="checkbox"
              checked={gridFirst}
              onChange={() => setGridFirst(!gridFirst)}
              className="accent-sky-400"
            />
            <span className="text-zinc-300">grid-first</span>
          </label>
          <button
            onClick={reroll}
            className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-700"
          >
            Reroll
          </button>
          <a href="/" className="text-xs text-zinc-500 underline hover:text-white">
            &larr; scene
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {seeds.map((seed) => (
          <button
            key={seed}
            onClick={() => setActiveSeed(seed)}
            className="cursor-zoom-in overflow-hidden rounded border border-zinc-800 transition-colors hover:border-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            style={{ width: CELL_SIZE, height: CELL_SIZE }}
            title={`Click to enlarge: ${seed}`}
            aria-label={`Enlarge seed ${seed}`}
          >
            <PlanView seed={seed} size={CELL_SIZE} layers={layers} />
          </button>
        ))}
      </div>

      {/* Lightbox dialog */}
      <Dialog
        open={activeSeed !== null}
        onOpenChange={(open) => {
          if (!open) setActiveSeed(null);
        }}
      >
        <DialogBackdrop />
        <DialogPopup>
          <DialogContent
            style={{
              width: `min(90vw, 90vh, ${LIGHTBOX_SIZE}px)`,
              height: `min(90vw, 90vh, ${LIGHTBOX_SIZE}px)`,
            }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
              <DialogTitle>{activeSeed ?? ""}</DialogTitle>
              <DialogClose aria-label="Close">
                <X size={14} />
              </DialogClose>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-hidden">
              {activeSeed !== null && (
                <PlanView
                  seed={activeSeed}
                  size={LIGHTBOX_SIZE}
                  layers={layers}
                />
              )}
            </div>
          </DialogContent>
        </DialogPopup>
      </Dialog>
    </main>
  );
}
