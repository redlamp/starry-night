"use client";

import { useMemo, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Building } from "@/lib/seed/cityGen";
import { APPROACHES, type WindowRanges } from "./approaches";
import { buildAtlasSheetTiles, buildBuildingTiles, type Built, type Tile } from "./textureTiles";
import { SPECIMENS } from "./specimens";

// Texture inspector (user 2026-07-03): every bitmap the approaches sample,
// laid out flat in the hover tooltip's format — per-building groups (sides
// grouped for the current shader), tallest building first. Tiles are rebuilt
// from the same deterministic functions the racks use at the scene time the
// panel was opened; nothing reaches into live GPU objects.

const ZOOMS = [0.5, 1, 2, 4, 8, 16];

// Tiles render at an exact texel multiple (width/height set outright, CSS
// image-rendering: pixelated) so zooming shows hard nearest-neighbour texels,
// never bilinear blur.
function TileRow({ tiles, zoom }: { tiles: Tile[]; zoom: number }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {tiles.map((t, i) => (
        <figure key={i} className="flex flex-col gap-1">
          {t.label ? (
            <figcaption className="max-w-56 font-mono text-xs text-zinc-500">{t.label}</figcaption>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, not an asset */}
          <img
            src={t.url}
            alt={t.label || "texture"}
            style={{ width: t.w * zoom, height: t.h * zoom }}
            className="rounded-sm border border-zinc-800 [image-rendering:pixelated]"
          />
        </figure>
      ))}
    </div>
  );
}

function BuildingCard({ b, built, zoom }: { b: Building; built: Built; zoom: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-zinc-800/70 p-2.5">
      <div className="font-mono text-sm text-zinc-300">
        #{b.id} {b.archetype} · {b.colsPerFace}×{b.floors} cells · {Math.round(b.height)} m
      </div>
      <div className="font-mono text-xs text-zinc-500">{built.common}</div>
      <TileRow tiles={built.tiles} zoom={zoom} />
    </div>
  );
}

export function TextureInspector({
  open,
  onClose,
  windows,
  timeSec,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  windows: WindowRanges;
  // Scene time the parent captured when opening / refreshing: tiles bake at
  // the CURRENT wake/sleep state (live view, user 2026-07-03) instead of t=0.
  timeSec: number;
  onRefresh: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const built = useMemo(() => {
    if (!open) return null;
    const byHeight = [...SPECIMENS].sort((x, y) => y.height - x.height);
    return {
      byHeight,
      sections: APPROACHES.map((ap) => ({
        approach: ap,
        cards: byHeight.map((b) => buildBuildingTiles(b, ap.id, windows, timeSec)),
      })),
      sheet: buildAtlasSheetTiles(),
    };
  }, [open, windows, timeSec]);

  if (!open || !built) return null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black/95">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-sm tracking-wider text-zinc-300 uppercase">Textures</h2>
          <HelpHint side="bottom">
            Every building&apos;s textures per approach, tallest first, in the hover tooltip&apos;s
            format — a snapshot of the scene&apos;s wake/sleep state when opened (each live facade
            lands within ~a second of this; Refresh resyncs). Only the production shader varies a
            building&apos;s sides; the bakes share one bitmap across all four.
          </HelpHint>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="bg-foreground/10 text-foreground hover:bg-foreground/20"
            onClick={onRefresh}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <span className="font-mono text-xs tracking-wider text-zinc-500 uppercase">zoom</span>
          <div className="flex items-center gap-1">
            {ZOOMS.map((z) => (
              <Button
                key={z}
                size="sm"
                variant="secondary"
                className={cn(
                  "px-2 tabular-nums",
                  zoom === z
                    ? "bg-foreground text-background hover:bg-foreground"
                    : "bg-foreground/10 text-foreground hover:bg-foreground/20",
                )}
                onClick={() => setZoom(z)}
              >
                {z < 1 ? "½" : z}×
              </Button>
            ))}
          </div>
          <HelpHint side="bottom">
            Exact texel multiples, nearest-neighbour — edges stay hard at any zoom. The current
            shader&apos;s tiles are 1 texel per window; the bakes are 16 px per window, so crank
            the zoom to study the atlas tiles.
          </HelpHint>
          <Button size="sm" variant="secondary" onClick={onClose} aria-label="Close textures">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {built.sections.map(({ approach, cards }) => (
          <section key={approach.id} className="mb-8 flex flex-col gap-2">
            <h3 className="font-mono text-xs tracking-wider text-zinc-500 uppercase">
              {approach.name}
            </h3>
            <div className="flex flex-wrap items-start gap-3">
              {built.byHeight.map((b, i) => (
                <BuildingCard key={b.id} b={b} built={cards[i]} zoom={zoom} />
              ))}
            </div>
          </section>
        ))}

        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-xs tracking-wider text-zinc-500 uppercase">
            current shader — the actual GPU texture (whole rack, one packed sheet)
          </h3>
          <TileRow tiles={built.sheet} zoom={zoom * 3} />
        </section>
      </div>
    </div>
  );
}
