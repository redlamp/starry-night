"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";

// Entity columns: while a STREET column is topmost, its whole polyline draws
// x-ray on the scene (the road-hover highlight, made persistent) so "this
// street" has a body, not just a name. A road hovered on that card — a
// highway's crossing rows (user 2026-07-27) — draws at the same time, in its
// own tier color, so the junction reads on the map before it's opened.

const TIER_COLOR: Record<string, string> = {
  highway: "#e8b04a",
  arterial: "#d9c27a",
  minor: "#9fb3d1",
};

// One x-ray polyline for a road id, or null. Hovered lines draw brighter and
// above the card's own street so a crossing stands out against it.
function useRoadLine(roadId: string | null, hovered: boolean): THREE.Line | null {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

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
    for (const v of road.vertices) pts.push(v.x, hovered ? 2.5 : 2, v.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(hovered ? "#ffffff" : TIER_COLOR[tier]),
      transparent: true,
      opacity: hovered ? 1 : 0.85,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const l = new THREE.Line(geo, mat);
    l.renderOrder = hovered ? 1002 : 1001;
    l.frustumCulled = false;
    return l;
  }, [roadId, hovered, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    return () => {
      if (!line) return;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    };
  }, [line]);

  return line;
}

export function StreetHighlight() {
  const columnPath = useSceneStore((s) => s.columnPath);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  const hoverRoadId = useSceneStore((s) => s.hoverRoadId);

  const top = columnCursor >= 0 ? columnPath[columnCursor] : undefined;
  const roadId = top?.kind === "street" ? top.id : null;

  const line = useRoadLine(roadId, false);
  const hoverLine = useRoadLine(hoverRoadId === roadId ? null : hoverRoadId, true);

  return (
    <>
      {line && <primitive object={line} />}
      {hoverLine && <primitive object={hoverLine} />}
    </>
  );
}
