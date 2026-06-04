"use client";

import { useMemo, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
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
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; // positions live in the shader; bounds are unknown
    return { points: pts, partition: part as TilePartition, channels: chans };
  }, [masterSeed, density, highway, arterial, minor, cityShape, cityShapeScale, citySize]);

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
    if (!enabled) return;
    const s = useSceneStore.getState();
    const u = (points.material as THREE.ShaderMaterial).uniforms;
    state.camera.getWorldDirection(_viewDir);
    u.uViewDir.value.copy(_viewDir);
    u.uIntroCenter.value.set(s.orbit.centerX, 0, s.orbit.centerZ);
    // Distance LOD (#52) — live, render-only; shares the streetlights' settings.
    const lod = s.lod;
    u.uLodEnabled.value = lod.enabled ? 1 : 0;
    u.uLodNear.value = lod.near;
    u.uLodFar.value = lod.far;
    u.uLodCull.value = lod.cull;
    u.uLodSizeFloor.value = lod.sizeFloor;
    u.uLodBrightFloor.value = lod.brightnessFloor;

    // #55 per-tile culling: copy only the visible tiles' cars into the draw
    // buffers when the visible tile set changes.
    if (lod.tiles && partition.tiles.length > 1) {
      const sig = visibleTiles(partition, state.camera, frustum.current, visible.current);
      if (sig !== lastSig.current) {
        lastSig.current = sig;
        points.geometry.setDrawRange(0, compactVisible(partition, visible.current, channels));
      }
    } else if (lastSig.current !== "ALL") {
      lastSig.current = "ALL";
      points.geometry.setDrawRange(0, compactVisible(partition, null, channels));
    }
  });

  if (!enabled) return null;
  return <primitive object={points} />;
}
