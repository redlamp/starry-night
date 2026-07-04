"use client";

import { useMemo, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, DEFAULT_ORTHO_SIZE } from "@/lib/state/sceneStore";
import { buildTraffic } from "@/lib/seed/traffic";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { sharedStreetlightIntroProgress } from "@/lib/shaders/sharedIntro";
import { trafficVertexShader, trafficFragmentShader } from "@/lib/shaders/traffic";
import {
  partitionByTile,
  reorderToTiles,
  visibleTiles,
  compactVisible,
  type CompactChannel,
  type TilePartition,
} from "@/lib/scene/tileCull";
import { reportTileCull } from "@/lib/scene/tileCullDebug";

// Ambient car head/tail-lights flowing along the road network (research D).
// Deterministic per seed; GPU-animated off the shared clock (no per-frame CPU).
// Head/tail colour is resolved in-shader from the camera direction (#45).
const SIZE_SCALE = 1.0; // global point-size multiplier (visual-tuning knob)
const HEAD_INTENSITY = 2.2; // headlight emissive boost for ACES bloom
const TAIL_INTENSITY = 1.2; // taillights ~0.55× as bright as headlights (research)

const _viewDir = new THREE.Vector3();

export function Traffic({ masterSeed }: { masterSeed: string }) {
  const enabled = useSceneStore((s) => s.traffic.enabled);
  const density = useSceneStore((s) => s.traffic.density);
  const highway = useSceneStore((s) => s.traffic.highway);
  const arterial = useSceneStore((s) => s.traffic.arterial);
  const minor = useSceneStore((s) => s.traffic.minor);
  // `?? 1` — configs saved before population coupling landed lack the key.
  const popCoupling = useSceneStore((s) => s.traffic.popCoupling ?? 1);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);

  const { points, partition, channels } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const t = buildTraffic(
      masterSeed,
      density,
      { highway, arterial, minor },
      cityShape,
      cityShapeScale,
      popCoupling,
    );

    // #55 tile partition: a car shuttles between aA and aB (shader-animated), so
    // tile by the segment midpoint and grow the margin to cover the longest
    // half-segment — the moving point can never leave its tile's AABB.
    const n = t.aA.length / 3;
    let maxHalf = 0;
    for (let i = 0; i < n; i++) {
      const half =
        Math.hypot(
          t.aB[i * 3] - t.aA[i * 3],
          t.aB[i * 3 + 1] - t.aA[i * 3 + 1],
          t.aB[i * 3 + 2] - t.aA[i * 3 + 2],
        ) / 2;
      if (half > maxHalf) maxHalf = half;
    }
    const part = partitionByTile(
      n,
      (i) => (t.aA[i * 3] + t.aB[i * 3]) / 2,
      (i) => (t.aA[i * 3 + 2] + t.aB[i * 3 + 2]) / 2,
      null,
      500,
      80 + maxHalf,
    );
    const srcs = {
      aA: reorderToTiles(part, t.aA, 3),
      aB: reorderToTiles(part, t.aB, 3),
      aPhase: reorderToTiles(part, t.aPhase, 1),
      aSpeed: reorderToTiles(part, t.aSpeed, 1),
      aColor: reorderToTiles(part, t.aColor, 3),
      aTail: reorderToTiles(part, t.aTail, 3),
      aHead: reorderToTiles(part, t.aHead, 1),
      aReveal: reorderToTiles(part, t.aReveal, 1),
      aSize: reorderToTiles(part, t.aSize, 1),
      aWinStart: reorderToTiles(part, t.aWinStart, 1),
      aWinEnd: reorderToTiles(part, t.aWinEnd, 1),
      aRoadEnd: reorderToTiles(part, t.aRoadEnd, 1),
    };

    const geo = new THREE.BufferGeometry();
    // `position` only defines the draw count; the real location is computed in
    // the vertex shader from aA/aB. Use aA so any bounds query is sane.
    geo.setAttribute("position", new THREE.BufferAttribute(srcs.aA.slice(), 3));
    geo.setAttribute("aA", new THREE.BufferAttribute(srcs.aA.slice(), 3));
    geo.setAttribute("aB", new THREE.BufferAttribute(srcs.aB.slice(), 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(srcs.aPhase.slice(), 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(srcs.aSpeed.slice(), 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(srcs.aColor.slice(), 3));
    geo.setAttribute("aTail", new THREE.BufferAttribute(srcs.aTail.slice(), 3));
    geo.setAttribute("aHead", new THREE.BufferAttribute(srcs.aHead.slice(), 1));
    geo.setAttribute("aReveal", new THREE.BufferAttribute(srcs.aReveal.slice(), 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(srcs.aSize.slice(), 1));
    geo.setAttribute("aWinStart", new THREE.BufferAttribute(srcs.aWinStart.slice(), 1));
    geo.setAttribute("aWinEnd", new THREE.BufferAttribute(srcs.aWinEnd.slice(), 1));
    geo.setAttribute("aRoadEnd", new THREE.BufferAttribute(srcs.aRoadEnd.slice(), 1));
    const chans: CompactChannel[] = [
      { src: srcs.aA, dst: geo.getAttribute("position") as THREE.BufferAttribute, itemSize: 3 },
      { src: srcs.aA, dst: geo.getAttribute("aA") as THREE.BufferAttribute, itemSize: 3 },
      { src: srcs.aB, dst: geo.getAttribute("aB") as THREE.BufferAttribute, itemSize: 3 },
      { src: srcs.aPhase, dst: geo.getAttribute("aPhase") as THREE.BufferAttribute, itemSize: 1 },
      { src: srcs.aSpeed, dst: geo.getAttribute("aSpeed") as THREE.BufferAttribute, itemSize: 1 },
      { src: srcs.aColor, dst: geo.getAttribute("aColor") as THREE.BufferAttribute, itemSize: 3 },
      { src: srcs.aTail, dst: geo.getAttribute("aTail") as THREE.BufferAttribute, itemSize: 3 },
      { src: srcs.aHead, dst: geo.getAttribute("aHead") as THREE.BufferAttribute, itemSize: 1 },
      { src: srcs.aReveal, dst: geo.getAttribute("aReveal") as THREE.BufferAttribute, itemSize: 1 },
      { src: srcs.aSize, dst: geo.getAttribute("aSize") as THREE.BufferAttribute, itemSize: 1 },
      { src: srcs.aWinStart, dst: geo.getAttribute("aWinStart") as THREE.BufferAttribute, itemSize: 1 },
      { src: srcs.aWinEnd, dst: geo.getAttribute("aWinEnd") as THREE.BufferAttribute, itemSize: 1 },
      { src: srcs.aRoadEnd, dst: geo.getAttribute("aRoadEnd") as THREE.BufferAttribute, itemSize: 1 },
    ];

    const mat = new THREE.ShaderMaterial({
      vertexShader: trafficVertexShader,
      fragmentShader: trafficFragmentShader,
      uniforms: {
        uTime: sharedTime,
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
        uSizeScale: { value: SIZE_SCALE },
        uViewDir: { value: new THREE.Vector3(0, -1, 0) },
        uHeadIntensity: { value: HEAD_INTENSITY },
        uTailIntensity: { value: TAIL_INTENSITY },
        uIntro: sharedStreetlightIntroProgress,
        uIntroCenter: { value: new THREE.Vector3(0, 0, -120) },
        uIntroMaxRadius: { value: t.maxRadius },
        uLodEnabled: { value: 1 },
        uLodNear: { value: 3200 },
        uLodFar: { value: 7500 },
        uLodCull: { value: 16000 },
        uLodSizeFloor: { value: 0.5 },
        uLodBrightFloor: { value: 0.4 },
        // Ortho light-size: in ortho the camera parks far (so the camera-distance
        // LOD floors every light) and orthoSize is the zoom, so fixed-pixel lights
        // ignore zoom. uOrthoT (0 persp → 1 ortho) blends the size driver from
        // camera-distance LOD to the ortho zoom ratio (uOrthoSizeScale), so ortho
        // lights match perspective at default framing and scale with zoom. (#78)
        uOrthoT: { value: 0 },
        uOrthoSizeScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; // positions live in the shader; bounds are unknown
    return { points: pts, partition: part as TilePartition, channels: chans };
  }, [masterSeed, density, highway, arterial, minor, popCoupling, cityShape, cityShapeScale, citySize]);

  useEffect(() => {
    return () => {
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    };
  }, [points]);

  // #55 per-frame tile cull state (see Streetlights for the pattern).
  const frustum = useRef(new THREE.Frustum());
  const visible = useRef<number[]>([]);
  const lastSig = useRef("");
  useEffect(() => {
    lastSig.current = "";
  }, [points]);

  // Feed the camera forward direction so the shader can decide which cars face
  // the viewer (white headlights) vs drive away (red tails).
  useFrame((state) => {
    if (!enabled) {
      // Keep the #55 debug readout honest while the layer is off.
      reportTileCull("traffic", 0, partition.tiles.length, 0, partition.total, false);
      return;
    }
    const s = useSceneStore.getState();
    const u = (points.material as THREE.ShaderMaterial).uniforms;
    state.camera.getWorldDirection(_viewDir);
    u.uViewDir.value.copy(_viewDir);
    u.uIntroCenter.value.set(s.orbit.centerX, 0, s.orbit.centerZ);
    u.uSizeScale.value = SIZE_SCALE * (s.traffic.lightSize ?? 1); // live car-light size knob
    // Distance LOD (#52) — live, render-only; shares the streetlights' settings.
    const lod = s.lod;
    u.uLodEnabled.value = lod.enabled ? 1 : 0;
    u.uLodNear.value = lod.near;
    u.uLodFar.value = lod.far;
    u.uLodCull.value = lod.cull;
    u.uLodSizeFloor.value = lod.sizeFloor;
    u.uLodBrightFloor.value = lod.brightnessFloor;
    // Ortho light-size: blend toward the ortho-zoom-driven size so lights track
    // the city's magnification (smaller orthoSize = zoomed in = bigger lights),
    // instead of the parked-far camera distance. refOrthoSize/orthoSize = 1 at the
    // default frame (matching perspective), clamped so deep zoom can't blow up.
    u.uOrthoT.value = s.projectionBlend;
    u.uOrthoSizeScale.value = Math.max(0.3, Math.min(6, DEFAULT_ORTHO_SIZE / Math.max(1, s.orthoSize)));

    // #55 per-tile culling: copy only the visible tiles' cars into the draw
    // buffers when the visible tile set changes.
    const culling = lod.tiles && partition.tiles.length > 1;
    if (culling) {
      const sig = visibleTiles(partition, state.camera, frustum.current, visible.current);
      if (sig !== lastSig.current) {
        lastSig.current = sig;
        points.geometry.setDrawRange(0, compactVisible(partition, visible.current, channels));
      }
    } else if (lastSig.current !== "ALL") {
      lastSig.current = "ALL";
      points.geometry.setDrawRange(0, compactVisible(partition, null, channels));
    }
    // #55 debug readout (Debug View → Tile culling) — cheap counter writes.
    reportTileCull(
      "traffic",
      culling ? visible.current.length : partition.tiles.length,
      partition.tiles.length,
      Math.min(points.geometry.drawRange.count, partition.total),
      partition.total,
      lod.tiles,
    );
  });

  if (!enabled) return null;
  return <primitive object={points} />;
}
