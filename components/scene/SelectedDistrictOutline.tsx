"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity, tensorDistrictField } from "@/lib/seed/cityGen";

// #87 follow-up: trace an outline around the district the SELECTED building
// belongs to. Samples the district field on a grid (the SAME field DistrictShells
// draws from) and emits a segment on every cell edge where the selected district
// meets a different district or the field edge — the district's true, irregular
// perimeter, not its bounding box. Coloured by the district's own colour, so it
// matches the info panel's district label and the plan-view legend. Drawn as a
// GIS-style overlay (depthTest off) so the whole boundary reads regardless of
// building occlusion. Renders null until a building is selected (inspect mode
// only — selectedBuildingId is cleared when inspect turns off).
const STEPS = 80; // match DistrictShells' sampling resolution
const OUTLINE_Y = 0.35; // just above DistrictShells' border line (0.3)

export function SelectedDistrictOutline({ masterSeed }: { masterSeed: string }) {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const lines = useMemo(() => {
    void citySize; // tier drives the module-level gen extent — a switch must resample
    void citySketch; // sketch field likewise — a different city
    if (selectedBuildingId === null) return null;

    // Which district does the selected building belong to? (generateCity is
    // module-cached — this repeat call is free, and matches the info panel's
    // building -> district resolution.)
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    const b = buildings.find((x) => x.id === selectedBuildingId);
    if (!b) return null;
    const owner = districts.find((d) => d.id === b.districtId);
    if (!owner) return null;

    const field = tensorDistrictField(masterSeed);
    // classify() returns a district's `.index`; use that value directly rather
    // than assuming the districts array is ordered by index.
    const target = field.districts.find((d) => d.id === b.districtId);
    if (!target) return null;
    const targetIdx = target.index;

    const { minX, maxX, minZ, maxZ } = field.bounds;
    const stepX = (maxX - minX) / STEPS;
    const stepZ = (maxZ - minZ) / STEPS;

    // Membership grid for the target district.
    const sel: boolean[][] = [];
    for (let gx = 0; gx < STEPS; gx++) {
      const col: boolean[] = [];
      for (let gz = 0; gz < STEPS; gz++) {
        const x = minX + (gx + 0.5) * stepX;
        const z = minZ + (gz + 0.5) * stepZ;
        col.push(field.classify(x, z) === targetIdx);
      }
      sel.push(col);
    }

    // A segment on each edge of a selected cell whose neighbour across it is NOT
    // selected (or off-grid) — emitted once, from the selected side, so the
    // result is the district's closed perimeter with no doubled interior edges.
    const pts: number[] = [];
    for (let gx = 0; gx < STEPS; gx++) {
      for (let gz = 0; gz < STEPS; gz++) {
        if (!sel[gx][gz]) continue;
        const x0 = minX + gx * stepX;
        const x1 = x0 + stepX;
        const z0 = minZ + gz * stepZ;
        const z1 = z0 + stepZ;
        if (gx === 0 || !sel[gx - 1][gz]) pts.push(x0, OUTLINE_Y, z0, x0, OUTLINE_Y, z1);
        if (gx + 1 >= STEPS || !sel[gx + 1][gz]) pts.push(x1, OUTLINE_Y, z0, x1, OUTLINE_Y, z1);
        if (gz === 0 || !sel[gx][gz - 1]) pts.push(x0, OUTLINE_Y, z0, x1, OUTLINE_Y, z0);
        if (gz + 1 >= STEPS || !sel[gx][gz + 1]) pts.push(x0, OUTLINE_Y, z1, x1, OUTLINE_Y, z1);
      }
    }
    if (pts.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(owner.color),
      transparent: true,
      opacity: 0.95,
      depthTest: false, // GIS overlay — visible through buildings, like DistrictShells
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const seg = new THREE.LineSegments(geo, mat);
    seg.frustumCulled = false;
    seg.renderOrder = 1001; // above the district shells' fill (999) + seams (1000)
    return seg;
  }, [selectedBuildingId, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  useEffect(() => {
    return () => {
      if (!lines) return;
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    };
  }, [lines]);

  if (!lines) return null;
  return <primitive object={lines} />;
}
