/**
 * Shelf-pack per-building window DataTexture pixels into a single atlas
 * so all building shaders can share one texture (one texture binding,
 * one sampler) and the city collapses into a handful of InstancedMesh
 * draw calls instead of one mesh per building.
 */

export type PackInput = {
  id: number;
  cols: number;
  rows: number;
  data: Uint8Array; // length = cols * rows * 4 (RGBA)
};

export type PackEntry = {
  offsetX: number;
  offsetY: number;
  cols: number;
  rows: number;
};

export type PackResult = {
  atlas: Uint8Array;
  width: number;
  height: number;
  entries: Map<number, PackEntry>;
};

const ATLAS_WIDTH = 1024;

export function packWindowAtlas(items: PackInput[]): PackResult {
  // Sort tallest-first for tighter shelf packing.
  const sorted = [...items].sort((a, b) => b.rows - a.rows);

  let shelfY = 0;
  let shelfHeight = 0;
  let cursorX = 0;
  const entries = new Map<number, PackEntry>();

  for (const item of sorted) {
    if (cursorX + item.cols > ATLAS_WIDTH) {
      shelfY += shelfHeight;
      shelfHeight = 0;
      cursorX = 0;
    }
    if (item.rows > shelfHeight) shelfHeight = item.rows;
    entries.set(item.id, {
      offsetX: cursorX,
      offsetY: shelfY,
      cols: item.cols,
      rows: item.rows,
    });
    cursorX += item.cols;
  }

  const usedHeight = shelfY + shelfHeight;
  // Round to next power of 2 for sampler safety; minimum 16.
  const height = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(1, usedHeight))));

  const atlas = new Uint8Array(ATLAS_WIDTH * height * 4);

  for (const item of items) {
    const entry = entries.get(item.id);
    if (!entry) continue;
    for (let y = 0; y < entry.rows; y++) {
      for (let x = 0; x < entry.cols; x++) {
        const srcIdx = (y * entry.cols + x) * 4;
        const dstIdx = ((entry.offsetY + y) * ATLAS_WIDTH + (entry.offsetX + x)) * 4;
        atlas[dstIdx + 0] = item.data[srcIdx + 0];
        atlas[dstIdx + 1] = item.data[srcIdx + 1];
        atlas[dstIdx + 2] = item.data[srcIdx + 2];
        atlas[dstIdx + 3] = item.data[srcIdx + 3];
      }
    }
  }

  return { atlas, width: ATLAS_WIDTH, height, entries };
}
