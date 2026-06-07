"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";
import {
  partitionByTile,
  visibleTiles,
  freezeCullCamera,
  type TilePartition,
} from "@/lib/scene/tileCull";

// Tile-culling view (#55). Draws the cull grid as translucent AABB boxes,
// recoloured live by the SAME frustum test the renderers run: green = the
// tile's slice is materialised, red = evicted. Built over all buildings with
// the renderers' partition parameters, so the boxes are the canonical view of
// the machinery (per-archetype partitions share the grid; their AABBs differ
// only by which items each contains).
//
// The component also owns the freeze switch: on the rising edge it pins the
// shared cull matrix (lib/scene/tileCull.ts) to the current camera, so ALL
// consumers keep culling against the captured pose while the camera flies out
// to inspect the evicted set. Unfrozen + unculled tiles are never on screen by
// definition — freeze is what makes the red set visible.
//
// Unlike the flat GIS overlays (TensorFieldOverlay), these are 3D volumes:
// depth-tested so a box only paints where its own tile is actually in view —
// with depthTest off, an evicted foreground box washes over the materialised
// city behind it and the read goes muddy. Off by default; never persisted.
// Shared 0.14-opacity material → contrast lives in the colours: visible stays
// a dim green wash, evicted burns bright red so it reads from a frozen fly-out.
const COLOR_VISIBLE = new THREE.Color("#1f8047");
const COLOR_CULLED = new THREE.Color("#ff5040");

export function TileCullOverlay({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.debug.tileOverlay);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const data = useMemo<{ mesh: THREE.InstancedMesh; partition: TilePartition } | null>(() => {
    if (!show) return null; // skip the partition + mesh build while hidden
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    void citySketch; // sketch swap likewise (#40)
    const { buildings } = generateCity(masterSeed, cityShape, cityShapeScale); // memoised
    if (buildings.length === 0) return null;
    // Same params as the renderers (500 m grid, 80 m margin, height-honest AABBs).
    const partition = partitionByTile(
      buildings.length,
      (i) => buildings[i].x,
      (i) => buildings[i].z,
      (i) => buildings[i].height + 10,
    );

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    const im = new THREE.InstancedMesh(geo, mat, partition.tiles.length);
    im.frustumCulled = false; // culled boxes must render — they're the point
    im.renderOrder = 998; // above the scene, below the tensor-field ticks

    const matrix = new THREE.Matrix4();
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    for (let t = 0; t < partition.tiles.length; t++) {
      const box = partition.tiles[t].box;
      box.getCenter(center);
      box.getSize(size);
      matrix.compose(center, quat, size);
      im.setMatrixAt(t, matrix);
      im.setColorAt(t, COLOR_VISIBLE);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return { mesh: im, partition };
  }, [show, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    if (!data) return;
    return () => {
      data.mesh.geometry.dispose();
      (data.mesh.material as THREE.Material).dispose();
    };
  }, [data]);

  const frustum = useRef(new THREE.Frustum());
  const visible = useRef<number[]>([]);
  const lastSig = useRef("");
  const wasFrozen = useRef(false);
  useEffect(() => {
    lastSig.current = "";
  }, [data]);
  // Release the freeze if the overlay's owner unmounts mid-freeze.
  useEffect(() => {
    return () => {
      freezeCullCamera(null);
      useSceneStore.getState().setTileFreeze(false);
    };
  }, []);

  useFrame((state) => {
    const s = useSceneStore.getState();
    // Freeze edge detection — capture/release the shared cull matrix. Runs
    // even with the overlay hidden, so freeze alone still demonstrates
    // pop-out on the real layers while orbiting.
    if (s.debug.tileFreeze !== wasFrozen.current) {
      wasFrozen.current = s.debug.tileFreeze;
      freezeCullCamera(s.debug.tileFreeze ? state.camera : null);
    }
    if (!data) return;
    // Recolour only when the visible SET changes (same signature trick as the
    // renderers); with culling off everything is materialised → all green.
    const culling = s.lod.tiles;
    const sig = culling
      ? visibleTiles(data.partition, state.camera, frustum.current, visible.current)
      : "ALL";
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    const vis = new Set(visible.current);
    for (let t = 0; t < data.partition.tiles.length; t++) {
      data.mesh.setColorAt(t, !culling || vis.has(t) ? COLOR_VISIBLE : COLOR_CULLED);
    }
    if (data.mesh.instanceColor) data.mesh.instanceColor.needsUpdate = true;
  });

  if (!show || !data) return null;
  return <primitive object={data.mesh} />;
}
