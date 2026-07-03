"use client";

import { useMemo } from "react";
import { approachById, type WindowRanges } from "./approaches";
import { buildBuildingTiles } from "./textureTiles";
import { SPECIMENS } from "./specimens";

// Hover-to-inspect tooltip (user 2026-07-03): the textures behind the building
// under the cursor, at SOURCE size — which makes the density story visceral:
// the current shader's whole "texture" for a tower is a postage stamp of
// texels, the bakes are wall-sized bitmaps. Regenerated deterministically at
// the scene time the hover started (matches the live wake/sleep state).

export function TextureHoverTip({
  buildingId,
  approachId,
  windows,
  timeSec,
}: {
  buildingId: number;
  approachId: string;
  windows: WindowRanges;
  timeSec: number;
}) {
  const b = useMemo(() => SPECIMENS.find((s) => s.id === buildingId), [buildingId]);
  const built = useMemo(
    () => (b ? buildBuildingTiles(b, approachId, windows, timeSec) : null),
    [b, approachId, windows, timeSec],
  );
  if (!b || !built) return null;
  return (
    <div className="max-h-[70vh] overflow-hidden rounded-md border border-zinc-700 bg-black/90 p-3 shadow-xl">
      <div className="font-mono text-sm text-zinc-300">
        #{b.id} {b.archetype} · {b.colsPerFace}×{b.floors} cells ·{" "}
        {approachById(approachId)?.name ?? approachId}
      </div>
      <div className="mb-2 font-mono text-xs text-zinc-500">{built.common}</div>
      <div className="flex items-start gap-3">
        {built.tiles.map((t, i) => (
          // Captions ABOVE the images: tall source-size bakes clip at the
          // tooltip's max height, and the labels should survive the clipping.
          <figure key={i} className="flex flex-col gap-1">
            {t.label ? (
              <figcaption className="font-mono text-xs text-zinc-500">{t.label}</figcaption>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, not an asset */}
            <img
              src={t.url}
              alt={t.label || built.common}
              style={{ width: t.w, height: t.h }}
              className="rounded-sm border border-zinc-800 [image-rendering:pixelated]"
            />
          </figure>
        ))}
      </div>
    </div>
  );
}
