import * as THREE from "three";

// Per-tile culling + lazy materialisation (#55). Pure render-side machinery —
// generation always runs on the full MAX domain; this only decides which of
// those seed-derived items are MATERIALISED into the GPU buffers each frame.
//
// Model: items are partitioned once into world-space tiles and their source
// records stored tile-major (each tile's items contiguous). Per frame the tile
// AABBs are tested against the camera frustum (a few hundred cheap tests); when
// the visible tile SET changes, each visible tile's contiguous slice is copied
// to the head of the draw buffers and the draw count lowered to the visible
// total. Draw-call count is unchanged (the meshes stay whole); what shrinks is
// the per-frame vertex/instance workload + additive overdraw. Eviction is the
// same copy — an exited tile simply stops being copied in; its source slice
// stays in RAM, so re-entry is lossless and instant (generate-at-max
// guarantees the records never need recomputing).

export type Tile = {
  start: number; // first item index in the tile-major order
  count: number;
  box: THREE.Box3; // world AABB, pre-expanded by the build margin
};

export type TilePartition = {
  /** Item indices in tile-major order — `order[start..start+count)` per tile. */
  order: Uint32Array;
  tiles: Tile[];
  total: number;
};

// World-space tile edge length, metres — the grid partitionByTile buckets
// items into. Exported (with tileKeyFor below) so callers OUTSIDE this module
// — e.g. the #87 building info panel's tile-id readout — can derive the same
// tile id for an arbitrary (x, z) without duplicating the bucketing formula.
export const TILE_SIZE = 500;

/** Tile-grid key for a world (x, z) position — the same bucketing partitionByTile uses. */
export function tileKeyFor(x: number, z: number, tileSize: number = TILE_SIZE): string {
  return `${Math.floor(x / tileSize)},${Math.floor(z / tileSize)}`;
}

/**
 * Partition `n` items into square world tiles of `tileSize` metres.
 * `getY` (optional) reports an item's max height so tall buildings keep their
 * tile's AABB honest; `margin` expands every box so items near a tile edge
 * (and point sprites' screen size) never pop at the frustum boundary.
 */
export function partitionByTile(
  n: number,
  getX: (i: number) => number,
  getZ: (i: number) => number,
  getY: ((i: number) => number) | null = null,
  tileSize: number = TILE_SIZE,
  margin = 80,
): TilePartition {
  const byTile = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = tileKeyFor(getX(i), getZ(i), tileSize);
    const list = byTile.get(k);
    if (list) list.push(i);
    else byTile.set(k, [i]);
  }
  const order = new Uint32Array(n);
  const tiles: Tile[] = [];
  let write = 0;
  for (const list of byTile.values()) {
    const start = write;
    const box = new THREE.Box3();
    for (const i of list) {
      order[write++] = i;
      const x = getX(i);
      const z = getZ(i);
      const y = getY ? getY(i) : 8;
      box.min.x = Math.min(box.min.x, x);
      box.min.z = Math.min(box.min.z, z);
      box.max.x = Math.max(box.max.x, x);
      box.max.z = Math.max(box.max.z, z);
      box.max.y = Math.max(box.max.y, y);
    }
    box.min.y = 0;
    box.expandByScalar(margin);
    tiles.push({ start, count: list.length, box });
  }
  return { order, tiles, total: n };
}

/** Reorder an item-indexed source array into the partition's tile-major order. */
export function reorderToTiles(
  part: TilePartition,
  src: Float32Array,
  itemSize: number,
): Float32Array {
  const out = new Float32Array(src.length);
  for (let w = 0; w < part.order.length; w++) {
    const i = part.order[w];
    out.set(src.subarray(i * itemSize, (i + 1) * itemSize), w * itemSize);
  }
  return out;
}

const _projScreen = new THREE.Matrix4();

// Debug freeze (#55 panel): when set, every visibleTiles call tests against
// this captured projection matrix instead of the live camera, so the camera
// can fly OUT of the cull frustum and inspect the evicted set from outside.
// Render-only inspection state — never an input to generation.
let _frozen: THREE.Matrix4 | null = null;

/** Pin (or with `null` release) the cull frustum to `camera`'s current pose. */
export function freezeCullCamera(camera: THREE.Camera | null): void {
  _frozen = camera
    ? new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    : null;
}

/** Visible tile indices for `camera`, plus a cheap signature for change detection. */
export function visibleTiles(
  part: TilePartition,
  camera: THREE.Camera,
  frustum: THREE.Frustum,
  out: number[],
): string {
  if (_frozen) _projScreen.copy(_frozen);
  else _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(_projScreen);
  out.length = 0;
  let sig = "";
  for (let t = 0; t < part.tiles.length; t++) {
    if (frustum.intersectsBox(part.tiles[t].box)) {
      out.push(t);
      sig += t + ",";
    }
  }
  return sig;
}

export type CompactChannel = {
  src: Float32Array; // tile-major source records
  dst: THREE.BufferAttribute | THREE.InstancedBufferAttribute;
  itemSize: number;
};

/**
 * Materialise the visible tiles: copy each one's contiguous slice to the head
 * of every channel's draw buffer. Returns the visible item count (the caller
 * sets mesh.count / drawRange to it). Pass `null` visible to materialise ALL
 * tiles (the culling-disabled fallback).
 */
export function compactVisible(
  part: TilePartition,
  visible: number[] | null,
  channels: CompactChannel[],
): number {
  let write = 0;
  const tiles = visible === null ? part.tiles : visible.map((t) => part.tiles[t]);
  for (const tile of tiles) {
    for (const ch of channels) {
      const dst = ch.dst.array as Float32Array;
      dst.set(
        ch.src.subarray(tile.start * ch.itemSize, (tile.start + tile.count) * ch.itemSize),
        write * ch.itemSize,
      );
    }
    write += tile.count;
  }
  for (const ch of channels) ch.dst.needsUpdate = true;
  return write;
}
