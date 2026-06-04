/**
 * #55 tile-cull sanity — headless proof of the partition/compaction machinery:
 *  1. CONSERVATION: materialising ALL tiles reproduces every source record
 *     exactly once (no loss, no duplication — just reordered).
 *  2. NO FALSE NEGATIVES: every item the camera frustum actually contains is in
 *     a visible tile (margins make tiles conservative; extras are fine).
 *  3. CULLING BITES: a narrow camera over a wide field keeps well under half
 *     the tiles.
 *
 *   bun run scripts/tileCullSanity.ts
 */
import * as THREE from "three";
import seedrandom from "seedrandom";
import {
  partitionByTile,
  reorderToTiles,
  visibleTiles,
  compactVisible,
  type CompactChannel,
} from "@/lib/scene/tileCull";

const rng = seedrandom("tile-cull-sanity");
const N = 20000;
const EXTENT = 3000;

// Synthetic city: items spread over ±EXTENT with heights up to 220.
const xs = new Float32Array(N);
const zs = new Float32Array(N);
const hs = new Float32Array(N);
const payload = new Float32Array(N * 3); // any per-item record
for (let i = 0; i < N; i++) {
  xs[i] = (rng() * 2 - 1) * EXTENT;
  zs[i] = (rng() * 2 - 1) * EXTENT;
  hs[i] = rng() * 220;
  payload[i * 3] = i;
  payload[i * 3 + 1] = xs[i];
  payload[i * 3 + 2] = zs[i];
}

const part = partitionByTile(
  N,
  (i) => xs[i],
  (i) => zs[i],
  (i) => hs[i],
);
const src = reorderToTiles(part, payload, 3);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${name.padEnd(30)} ${ok ? "PASS" : `FAIL ${detail}`}`);
  if (!ok) failed++;
};

// 1. Conservation — compact ALL tiles, compare multisets via per-item flags.
{
  const dstArr = new Float32Array(N * 3);
  const dst = new THREE.BufferAttribute(dstArr, 3);
  const channels: CompactChannel[] = [{ src, dst, itemSize: 3 }];
  const count = compactVisible(part, null, channels);
  const seen = new Uint8Array(N);
  let dupes = 0;
  for (let w = 0; w < count; w++) {
    const id = dstArr[w * 3];
    if (seen[id]) dupes++;
    seen[id] = 1;
  }
  const missing = seen.reduce((acc, v) => acc + (1 - v), 0);
  check(
    "conservation",
    count === N && dupes === 0 && missing === 0,
    `count=${count} dupes=${dupes} missing=${missing}`,
  );
}

// 2. No false negatives under a real perspective camera.
{
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 24000);
  // In-city pose looking outward — the case tile culling exists for: everything
  // behind/beside the camera drops. (Top-down full-extent views legitimately
  // keep most tiles; conservation + no-false-negatives still hold there.)
  camera.position.set(0, 200, 0);
  camera.lookAt(2000, 80, 300);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const frustum = new THREE.Frustum();
  const vis: number[] = [];
  visibleTiles(part, camera, frustum, vis);
  const inVisible = new Uint8Array(N); // item (source order) → in a visible tile
  for (const t of vis) {
    const tile = part.tiles[t];
    for (let w = tile.start; w < tile.start + tile.count; w++) inVisible[src[w * 3]] = 1;
  }
  const p = new THREE.Vector3();
  let falseNegatives = 0;
  let contained = 0;
  for (let i = 0; i < N; i++) {
    p.set(xs[i], Math.min(hs[i], 4), zs[i]);
    if (frustum.containsPoint(p)) {
      contained++;
      if (!inVisible[i]) falseNegatives++;
    }
  }
  check(
    "no false negatives",
    falseNegatives === 0,
    `${falseNegatives}/${contained} contained items missed`,
  );
  check(
    "culling bites",
    vis.length < part.tiles.length / 2,
    `${vis.length}/${part.tiles.length} tiles visible`,
  );
  console.log(
    `  (info) ${vis.length}/${part.tiles.length} tiles, ${contained}/${N} items in frustum`,
  );
}

console.log(failed === 0 ? "\nTILE CULL SANITY PASS" : `\nTILE CULL SANITY FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
