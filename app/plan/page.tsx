"use client";

import { useState } from "react";
import { PlanView, type PlanLayers } from "@/components/plan/PlanView";

const LAYER_KEYS: (keyof PlanLayers)[] = [
  "districts",
  "buildings",
  "highways",
  "arterials",
  "streetlights",
];

const SEED_COUNT = 16;
const CELL_SIZE = 320;

export default function PlanPage() {
  const [baseSeed, setBaseSeed] = useState("plan");
  const [layers, setLayers] = useState<PlanLayers>({
    districts: true,
    buildings: true,
    highways: true,
    arterials: true,
    streetlights: true,
  });

  const seeds = Array.from({ length: SEED_COUNT }, (_, i) => `${baseSeed}-${i}`);

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
              <span className="text-zinc-300">{key}</span>
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {seeds.map((seed) => (
          <div
            key={seed}
            className="overflow-hidden rounded border border-zinc-800"
            style={{ width: CELL_SIZE, height: CELL_SIZE }}
          >
            <PlanView seed={seed} size={CELL_SIZE} layers={layers} />
          </div>
        ))}
      </div>
    </main>
  );
}
