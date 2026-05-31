"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";

export function Arterials({ masterSeed }: { masterSeed: string }) {
  const showArterials = useSceneStore((s) => s.cityPlanning.showArterials);
  const setArterialCount = useSceneStore((s) => s.setArterialCount);

  const { geometry, count } = useMemo(() => {
    const arterials = generateCity(masterSeed).arterials;
    const segs: number[] = [];
    for (const a of arterials) {
      for (let i = 0; i < a.vertices.length - 1; i++) {
        segs.push(a.vertices[i].x, 0, a.vertices[i].z);
        segs.push(a.vertices[i + 1].x, 0, a.vertices[i + 1].z);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs), 3));
    return { geometry: geom, count: arterials.length };
  }, [masterSeed]);

  useEffect(() => {
    setArterialCount(count);
  }, [count, setArterialCount]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  if (!showArterials) return null;

  return (
    <lineSegments position={[0, 0.4, 0]}>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color="#7fa8d0" toneMapped={false} />
    </lineSegments>
  );
}
