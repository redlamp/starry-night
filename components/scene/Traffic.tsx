"use client";

import { useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { buildTraffic } from "@/lib/seed/traffic";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { sharedStreetlightIntroProgress } from "@/lib/shaders/sharedIntro";
import { trafficVertexShader, trafficFragmentShader } from "@/lib/shaders/traffic";

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

  const points = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const t = buildTraffic(
      masterSeed,
      density,
      { highway, arterial, minor },
      cityShape,
      cityShapeScale,
    );
    const geo = new THREE.BufferGeometry();
    // `position` only defines the draw count; the real location is computed in
    // the vertex shader from aA/aB. Use aA so any bounds query is sane.
    geo.setAttribute("position", new THREE.BufferAttribute(t.aA.slice(), 3));
    geo.setAttribute("aA", new THREE.BufferAttribute(t.aA, 3));
    geo.setAttribute("aB", new THREE.BufferAttribute(t.aB, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(t.aPhase, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(t.aSpeed, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(t.aColor, 3));
    geo.setAttribute("aTail", new THREE.BufferAttribute(t.aTail, 3));
    geo.setAttribute("aHead", new THREE.BufferAttribute(t.aHead, 1));
    geo.setAttribute("aReveal", new THREE.BufferAttribute(t.aReveal, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(t.aSize, 1));

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
    return pts;
  }, [masterSeed, density, highway, arterial, minor, cityShape, cityShapeScale, citySize]);

  useEffect(() => {
    return () => {
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    };
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
  });

  if (!enabled) return null;
  return <primitive object={points} />;
}
