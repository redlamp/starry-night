"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";
import { SELECT_OUTLINE_COLOR } from "@/lib/state/sceneDefaults";

// #87 follow-up: an X-RAY outline of the SELECTED building's box, drawn on top
// (depthTest off) so it stays visible even when a nearer building occludes it.
// The #69 inverted-hull outline shell hugs the silhouette but is depth-tested,
// so it vanishes behind foreground buildings — this box (the building's 12 edges
// in the cool-blue selection colour) shows through them, marking where the
// selection is. Renders null until a building is selected (inspect mode only).
const EDGES: ReadonlyArray<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0], // base ring
  [4, 5], [5, 6], [6, 7], [7, 4], // roof ring
  [0, 4], [1, 5], [2, 6], [3, 7], // verticals
];

export function SelectedBuildingOutline({ masterSeed }: { masterSeed: string }) {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const seg = useMemo(() => {
    void citySize;
    void citySketch;
    if (selectedBuildingId === null) return null;
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    const b = buildings.find((x) => x.id === selectedBuildingId);
    if (!b) return null;
    // Match the building's district colour (same legend as the info panel + the
    // district outline); fall back to the neutral selection blue if unresolved.
    const color = districts.find((d) => d.id === b.districtId)?.color ?? SELECT_OUTLINE_COLOR;

    // Edges of a CENTRED unit box (-0.5..0.5). We then apply the EXACT same
    // transform InstancedCity composes per instance — centre at (x, height/2, z),
    // scale (width, height, depth), Y-rotation -rotationY (the road-aligned
    // bearing) — so the wireframe stays glued to the (rotated) building.
    const h = 0.5;
    const c: Array<[number, number, number]> = [
      [-h, -h, -h],
      [h, -h, -h],
      [h, -h, h],
      [-h, -h, h],
      [-h, h, -h],
      [h, h, -h],
      [h, h, h],
      [-h, h, h],
    ];
    const pts: number[] = [];
    for (const [a, d] of EDGES) pts.push(...c[a], ...c[d]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.95,
      depthTest: false, // X-ray: visible through occluding buildings
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const line = new THREE.LineSegments(geo, mat);
    line.position.set(b.x, b.height / 2, b.z);
    line.rotation.set(0, -b.rotationY, 0);
    line.scale.set(b.width, b.height, b.depth);
    line.frustumCulled = false;
    line.renderOrder = 1002; // above the district outline (1001)
    return line;
  }, [selectedBuildingId, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    return () => {
      if (!seg) return;
      seg.geometry.dispose();
      (seg.material as THREE.Material).dispose();
    };
  }, [seg]);

  if (!seg) return null;
  return <primitive object={seg} />;
}
