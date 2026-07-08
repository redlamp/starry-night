"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";

// Entity columns: while a STREET column is topmost, its whole polyline draws
// x-ray on the scene (the road-hover highlight, made persistent) so "this
// street" has a body, not just a name.

const TIER_COLOR: Record<string, string> = {
  highway: "#e8b04a",
  arterial: "#d9c27a",
  minor: "#9fb3d1",
};

export function StreetHighlight({ masterSeed }: { masterSeed: string }) {
  const columnPath = useSceneStore((s) => s.columnPath);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const top = columnCursor >= 0 ? columnPath[columnCursor] : undefined;
  const roadId = top?.kind === "street" ? top.id : null;

  const line = useMemo(() => {
    void citySize;
    void citySketch;
    if (!roadId) return null;
    const city = generateCity(masterSeed, cityShape, cityShapeScale);
    const road =
      city.arterials.find((r) => r.id === roadId) ??
      city.streets.find((r) => r.id === roadId) ??
      city.topology.highways.find((h) => h.id === roadId);
    if (!road) return null;
    const tier = city.topology.highways.includes(road as never)
      ? "highway"
      : city.arterials.includes(road as never)
        ? "arterial"
        : "minor";
    const pts: number[] = [];
    for (const v of road.vertices) pts.push(v.x, 2, v.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(TIER_COLOR[tier]),
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const l = new THREE.Line(geo, mat);
    l.renderOrder = 1001;
    l.frustumCulled = false;
    return l;
  }, [roadId, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    return () => {
      if (!line) return;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    };
  }, [line]);

  if (!line) return null;
  return <primitive object={line} />;
}
