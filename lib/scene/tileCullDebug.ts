// #55 tile-cull debug instrumentation. The three cull consumers (InstancedCity,
// Streetlights, Traffic) report their per-frame counts here and the Debug
// panel's Tile-culling readout polls them at a slow interval. Module-level
// mutable singleton (same pattern as sharedTime): render-only telemetry,
// never an input to scene state.

export const TILE_LAYERS = ["buildings", "streetlights", "traffic"] as const;
export type TileLayerKey = (typeof TILE_LAYERS)[number];

export type TileCullStats = {
  tilesVisible: number;
  tilesTotal: number;
  /** Items currently materialised in the draw buffers (0 = layer hidden). */
  itemsDrawn: number;
  itemsTotal: number;
  /** False = lod.tiles off for this layer this frame (everything materialised). */
  culling: boolean;
};

const empty = (): TileCullStats => ({
  tilesVisible: 0,
  tilesTotal: 0,
  itemsDrawn: 0,
  itemsTotal: 0,
  culling: false,
});

const stats: Record<TileLayerKey, TileCullStats> = {
  buildings: empty(),
  streetlights: empty(),
  traffic: empty(),
};

export function reportTileCull(
  layer: TileLayerKey,
  tilesVisible: number,
  tilesTotal: number,
  itemsDrawn: number,
  itemsTotal: number,
  culling: boolean,
): void {
  const s = stats[layer];
  s.tilesVisible = tilesVisible;
  s.tilesTotal = tilesTotal;
  s.itemsDrawn = itemsDrawn;
  s.itemsTotal = itemsTotal;
  s.culling = culling;
}

export function readTileCull(layer: TileLayerKey): TileCullStats {
  return stats[layer];
}
