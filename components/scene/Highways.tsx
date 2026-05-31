"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { flattenHighwaysToSegments } from "@/lib/seed/topology";
import { generateCity } from "@/lib/seed/cityGen";

export function Highways({ masterSeed }: { masterSeed: string }) {
  const showHighways = useSceneStore((s) => s.cityPlanning.showHighways);
  const setTopologyKind = useSceneStore((s) => s.setTopologyKind);

  const { geometry, kind } = useMemo(() => {
    const topo = generateCity(masterSeed).topology;
    const flat = flattenHighwaysToSegments(topo.highways);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    return { geometry: geom, kind: topo.kind };
  }, [masterSeed]);

  useEffect(() => {
    setTopologyKind(kind);
  }, [kind, setTopologyKind]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  if (!showHighways) return null;

  return (
    <lineSegments position={[0, 0.5, 0]}>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color="#f0c850" toneMapped={false} />
    </lineSegments>
  );
}
