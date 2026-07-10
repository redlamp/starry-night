"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { MapPin } from "lucide-react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity, tensorDistrictField } from "@/lib/seed/cityGen";

// #87 follow-up: trace an outline around a district's true, irregular
// perimeter. Samples the district field on a grid (the SAME field DistrictShells
// draws from) and emits a segment on every cell edge where the target district
// meets a different district or the field edge. Coloured by the district's own
// colour, so it matches the info panel's district label and the plan-view
// legend. Drawn as a GIS-style overlay (depthTest off) so the whole boundary
// reads regardless of building occlusion. The target district is, in priority
// order: the directory's hovered district, its pinned district (user
// 2026-07-08), else the SELECTED building's district (inspect mode).
const STEPS = 80; // match DistrictShells' sampling resolution
const OUTLINE_Y = 0.35; // just above DistrictShells' border line (0.3)
const PIN_Y = 10; // marker height above ground, clear of buildings' bases
// Keep the marker's <Html> permanently mounted and park it far off-screen
// when nothing is pinned — mounting/unmounting drei <Html> flashes at the
// origin for a frame (same gotcha BuildingPin.tsx works around).
const PIN_PARKED: [number, number, number] = [0, -100000, 0];

export function SelectedDistrictOutline({ masterSeed }: { masterSeed: string }) {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const hoverDistrictId = useSceneStore((s) => s.hoverDistrictId);
  const pinnedDistrictId = useSceneStore((s) => s.pinnedDistrictId);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const lines = useMemo(() => {
    void citySize; // tier drives the module-level gen extent — a switch must resample
    void citySketch; // sketch field likewise — a different city
    const directDistrictId = hoverDistrictId ?? pinnedDistrictId;
    if (directDistrictId === null && selectedBuildingId === null) return null;

    // Resolve the target district: directory-driven id wins; otherwise the
    // selected building's owner. (generateCity is module-cached — this repeat
    // call is free, and matches the info panel's building -> district
    // resolution.)
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    let districtId = directDistrictId;
    if (districtId === null) {
      const b = buildings.find((x) => x.id === selectedBuildingId);
      if (!b) return null;
      districtId = b.districtId;
    }
    const owner = districts.find((d) => d.id === districtId);
    if (!owner) return null;

    const field = tensorDistrictField(masterSeed);
    // classify() returns a district's `.index`; use that value directly rather
    // than assuming the districts array is ordered by index.
    const target = field.districts.find((d) => d.id === districtId);
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
  }, [
    selectedBuildingId,
    hoverDistrictId,
    pinnedDistrictId,
    masterSeed,
    cityShape,
    cityShapeScale,
    citySize,
    citySketch,
  ]);

  useEffect(() => {
    return () => {
      if (!lines) return;
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    };
  }, [lines]);

  // #2.2: a MapPin marker at the PINNED district's centre only (not hover, not
  // selection). Centroid of the district's membership grid, reusing the same
  // tensor field sampled above — a fine approximation of "centre" for the
  // irregular tensor-field district shapes.
  const pin = useMemo(() => {
    void citySize;
    void citySketch;
    if (pinnedDistrictId === null) return null;
    const { districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    const owner = districts.find((d) => d.id === pinnedDistrictId);
    if (!owner) return null;

    const field = tensorDistrictField(masterSeed);
    const target = field.districts.find((d) => d.id === pinnedDistrictId);
    if (!target) return null;
    const targetIdx = target.index;

    const { minX, maxX, minZ, maxZ } = field.bounds;
    const stepX = (maxX - minX) / STEPS;
    const stepZ = (maxZ - minZ) / STEPS;
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (let gx = 0; gx < STEPS; gx++) {
      for (let gz = 0; gz < STEPS; gz++) {
        const x = minX + (gx + 0.5) * stepX;
        const z = minZ + (gz + 0.5) * stepZ;
        if (field.classify(x, z) === targetIdx) {
          sumX += x;
          sumZ += z;
          count++;
        }
      }
    }
    if (count === 0) return null;
    return { x: sumX / count, z: sumZ / count, color: owner.color };
  }, [pinnedDistrictId, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  return (
    <>
      {lines && <primitive object={lines} />}
      <Html
        position={pin ? [pin.x, PIN_Y, pin.z] : PIN_PARKED}
        center
        zIndexRange={[20, 0]}
        style={{ pointerEvents: "none", display: pin ? undefined : "none" }}
      >
        <div
          className="flex items-center justify-center rounded-full bg-foreground/90 p-1 shadow"
          style={{ color: pin?.color }}
        >
          <MapPin size={20} strokeWidth={2.25} />
        </div>
      </Html>
    </>
  );
}
