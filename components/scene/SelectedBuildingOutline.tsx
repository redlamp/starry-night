"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";
import { SELECT_OUTLINE_COLOR } from "@/lib/state/sceneDefaults";

// Selection highlight: a translucent CUBE that SURROUNDS the selected building,
// rendered BackSide so you see its INSIDE faces — the far interior walls and the
// bottom from within — a cage around the building, not the building itself. X-ray
// (depthTest off). Vertically aligned to the REAL building span — bottom flush with
// the ground, small pad above the roof (user 2026-07-27; the old base lift + height
// grow read as a misaligned floating box). The old x-ray wireframe is retired.
//
// A second, fainter white cage tracks `hoverBuildingId` — the building a card
// list row is pointing at (user 2026-07-27) — so hovering a row locates it in
// the city without committing to a selection.
export function SelectedBuildingOutline({ masterSeed }: { masterSeed: string }) {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const hoverBuildingId = useSceneStore((s) => s.hoverBuildingId);

  const selected = useBuildingCage(selectedBuildingId, masterSeed, false);
  const hovered = useBuildingCage(
    hoverBuildingId === selectedBuildingId ? null : hoverBuildingId,
    masterSeed,
    true,
  );

  return (
    <>
      {selected && <primitive object={selected} />}
      {hovered && <primitive object={hovered} />}
    </>
  );
}

function useBuildingCage(
  buildingId: number | null,
  masterSeed: string,
  hover: boolean,
): THREE.Mesh | null {
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const mesh = useMemo(() => {
    void citySize;
    void citySketch;
    if (buildingId === null) return null;
    const { buildings } = generateCity(masterSeed, cityShape, cityShapeScale);
    const b = buildings.find((x) => x.id === buildingId);
    if (!b) return null;

    // Lateral margin only (user 2026-07-27: the cage read as taller than the building and
    // floating off the road — the old 1.08 height grow + 6m base lift). Vertically it hugs
    // the real span: bottom exactly at the ground, a small fixed pad above the roof.
    const grow = 1.08; // the cage sits just outside the building's SIDES
    const topPad = Math.min(2, b.height * 0.02);
    const boxH = b.height + topPad;

    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(hover ? "#ffffff" : SELECT_OUTLINE_COLOR),
        transparent: true,
        // The hover cage has to be findable at a glance across a whole city
        // block, so it reads BRIGHTER than the selection cage, not fainter.
        opacity: hover ? 0.3 : 0.16,
        side: THREE.BackSide, // inside faces visible — a cage you see the inner walls + floor of
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    m.position.set(b.x, boxH / 2, b.z); // bottom flush with the ground
    m.rotation.set(0, -b.rotationY, 0);
    m.scale.set(b.width * grow, boxH, b.depth * grow);
    m.frustumCulled = false;
    m.renderOrder = 1001; // under the unit highlights (1002)
    return m;
  }, [buildingId, hover, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    return () => {
      if (!mesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };
  }, [mesh]);

  return mesh;
}
