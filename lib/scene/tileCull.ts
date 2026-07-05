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
//
// #70 crop cull: a live "radius" crop (InstancedCity's shape-scale slider)
// folds into this SAME pass instead of getting its own path — partitionByTile
// optionally sorts each tile ascending by distance-from-centre, so
// tileCropCount can prefix-cull a boundary tile (compactVisible copies fewer
// than `tile.count` items) at per-instance precision. A crop notch therefore
// triggers one recompaction, exactly like frustum re-entry — never a rebuild.

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
  // #70 crop cull: tile-major distances, ascending WITHIN each tile — present
  // only when partitionByTile was given a `getRadius`. Lets a live radius
  // threshold prefix-cull a tile with a binary search (tileCropCount) instead
  // of re-testing every item's membership each frame: the same "cheap test,
  // rare recompaction" shape as the frustum AABB test below.
  radius?: Float32Array;
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
 *
 * `getRadius` (#70, optional) sorts each tile's members ascending by this
 * value before the tile-major order is finalised, and keeps the per-item
 * values (tile-major) on the returned partition's `radius` array — a caller
 * can then prefix-cull a tile to "the N closest-to-centre members" with a
 * binary search (tileCropCount) instead of testing every item each frame.
 * Omitted (every pre-#70 caller), the order is unchanged from today.
 */
export function partitionByTile(
  n: number,
  getX: (i: number) => number,
  getZ: (i: number) => number,
  getY: ((i: number) => number) | null = null,
  tileSize: number = TILE_SIZE,
  margin = 80,
  getRadius?: (i: number) => number,
): TilePartition {
  const byTile = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = tileKeyFor(getX(i), getZ(i), tileSize);
    const list = byTile.get(k);
    if (list) list.push(i);
    else byTile.set(k, [i]);
  }
  if (getRadius) {
    // Ascending per tile — a crop threshold's "keep everything within radius R"
    // then reads off each tile's members as a plain PREFIX.
    for (const list of byTile.values()) list.sort((a, b) => getRadius(a) - getRadius(b));
  }
  const order = new Uint32Array(n);
  const radius = getRadius ? new Float32Array(n) : undefined;
  const tiles: Tile[] = [];
  let write = 0;
  for (const list of byTile.values()) {
    const start = write;
    const box = new THREE.Box3();
    for (const i of list) {
      const w = write++;
      order[w] = i;
      if (radius) radius[w] = getRadius!(i);
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
  return { order, tiles, total: n, radius };
}

/**
 * #70: count of tile `t`'s members with `radius <= threshold` — a PREFIX
 * count, since `partitionByTile`'s `getRadius` sorted each tile ascending.
 * Binary search, O(log tile.count), so folding a crop into the per-frame
 * cull costs one extra search per VISIBLE tile, not a per-item test.
 *
 * Falls back to the tile's full count when the partition carries no radius
 * data (partitionByTile was called without `getRadius`) or `threshold` is
 * `Infinity` — both mean "nothing is cropped, everything passes."
 */
export function tileCropCount(part: TilePartition, tile: Tile, threshold: number): number {
  const radius = part.radius;
  if (!radius || threshold === Infinity) return tile.count;
  let lo = 0;
  let hi = tile.count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (radius[tile.start + mid] <= threshold) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
 *
 * `counts` (#70, optional) overrides each tile's copied length — one entry per
 * `visible` index (or per `part.tiles` index when `visible` is `null`),
 * typically from `tileCropCount` — so a radius crop can fold a PARTIAL
 * (prefix) tile into this SAME copy pass alongside whole ones. The copy
 * itself is untouched: still one contiguous `[tile.start, tile.start+count)`
 * slice per channel, just with `count` sourced from the override when given.
 * Omitted (every pre-#70 caller), every tile copies its full `tile.count`,
 * unchanged.
 */
export function compactVisible(
  part: TilePartition,
  visible: number[] | null,
  channels: CompactChannel[],
  counts?: number[],
): number {
  let write = 0;
  const tiles = visible === null ? part.tiles : visible.map((t) => part.tiles[t]);
  for (let ti = 0; ti < tiles.length; ti++) {
    const tile = tiles[ti];
    const count = counts ? counts[ti] : tile.count;
    for (const ch of channels) {
      const dst = ch.dst.array as Float32Array;
      dst.set(
        ch.src.subarray(tile.start * ch.itemSize, (tile.start + count) * ch.itemSize),
        write * ch.itemSize,
      );
    }
    write += count;
  }
  for (const ch of channels) ch.dst.needsUpdate = true;
  return write;
}
