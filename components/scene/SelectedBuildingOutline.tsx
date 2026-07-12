"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";
import { SELECT_OUTLINE_COLOR } from "@/lib/state/sceneDefaults";

// Selection highlight: a translucent CUBE that SURROUNDS the selected building,
// rendered BackSide so you see its INSIDE faces — the far interior walls and the
// bottom from within — a cage around the building, not the building itself. X-ray
// (depthTest off) and lifted so the bottom clears the road and wraps the base
// (user 30). The old x-ray wireframe + floor plate is retired.
export function SelectedBuildingOutline({ masterSeed }: { masterSeed: string }) {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const mesh = useMemo(() => {
    void citySize;
    void citySketch;
    if (selectedBuildingId === null) return null;
    const { buildings } = generateCity(masterSeed, cityShape, cityShapeScale);
    const b = buildings.find((x) => x.id === selectedBuildingId);
    if (!b) return null;

    const grow = 1.08; // the cage sits just outside the building on every side
    const boxH = b.height * grow;
    const ground = Math.min(6, b.height * 0.08); // lift the bottom off the road

    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(SELECT_OUTLINE_COLOR),
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide, // inside faces visible — a cage you see the inner walls + floor of
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    m.position.set(b.x, ground + boxH / 2, b.z);
    m.rotation.set(0, -b.rotationY, 0);
    m.scale.set(b.width * grow, boxH, b.depth * grow);
    m.frustumCulled = false;
    m.renderOrder = 1001; // under the unit highlights (1002)
    return m;
  }, [selectedBuildingId, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    return () => {
      if (!mesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };
  }, [mesh]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
