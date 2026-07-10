"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { MapPin } from "lucide-react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity, tensorDistrictField } from "@/lib/seed/cityGen";
import { districtBoundaryLoops } from "@/lib/seed/districtOutline";
import { loopsToSegments, loopsToFillGroup } from "@/lib/scene/districtOverlayGeometry";

// #87 follow-up: trace an outline around a district's true, irregular
// perimeter. Since 2026-07-10 the outline comes from districtBoundaryLoops —
// the label raster's native ~7.5m cells, Douglas-Peucker-simplified — so the
// border follows the bounding arterials' curves instead of the old 80×80
// sample grid's 75m stair-steps. Drawn as a GIS-style overlay (depthTest off)
// so the whole boundary reads regardless of building occlusion. The single
// highlighted district is, in priority order: the directory's hovered
// district, its pinned district (user 2026-07-08), else the SELECTED
// building's district (inspect mode).
//
// Two additions behind the directory's Districts-header toggle
// (showDistrictBoundaries, user 2026-07-10): every district outlined in its
// own colour, and a 20%-alpha fill under the hovered district.
const OUTLINE_Y = 0.35; // just above DistrictShells' border line (0.3)
const FILL_Y = 0.32; // hover fill sits under the outlines, above the shells
const PIN_Y = 10; // marker height above ground, clear of buildings' bases
// Keep the marker's <Html> permanently mounted and park it far off-screen
// when nothing is pinned — mounting/unmounting drei <Html> flashes at the
// origin for a frame (same gotcha BuildingPin.tsx works around).
const PIN_PARKED: [number, number, number] = [0, -100000, 0];

// Sampling resolution for the pin's centroid pass only (cheap and plenty for
// a marker position).
const CENTROID_STEPS = 80;

function outlineMaterial(color: string, opacity: number): THREE.LineBasicMaterial {
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthTest: false, // GIS overlay — visible through buildings, like DistrictShells
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  return mat;
}

function segmentsObject(pts: number[], mat: THREE.LineBasicMaterial): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const seg = new THREE.LineSegments(geo, mat);
  seg.frustumCulled = false;
  seg.renderOrder = 1001; // above the district shells' fill (999) + seams (1000)
  return seg;
}

function disposeObject(obj: THREE.Object3D | null): void {
  if (!obj) return;
  obj.traverse((child) => {
    const c = child as THREE.Mesh | THREE.LineSegments;
    if (c.geometry) c.geometry.dispose();
    if (c.material) (c.material as THREE.Material).dispose();
  });
}

export function SelectedDistrictOutline({ masterSeed }: { masterSeed: string }) {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const hoverDistrictId = useSceneStore((s) => s.hoverDistrictId);
  const pinnedDistrictId = useSceneStore((s) => s.pinnedDistrictId);
  const showBoundaries = useSceneStore((s) => s.showDistrictBoundaries);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  // The single highlighted district's outline (hover ?? pinned ?? selection).
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
    const target = field.districts.find((d) => d.id === districtId);
    if (!target) return null;
    const pts = loopsToSegments(districtBoundaryLoops(field, target.index), OUTLINE_Y);
    if (pts.length === 0) return null;
    return segmentsObject(pts, outlineMaterial(owner.color, 0.95));
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

  // Toggle mode: EVERY district's boundary in its own colour, dimmer than the
  // hovered/pinned highlight so that still pops.
  const allLines = useMemo(() => {
    void citySize;
    void citySketch;
    if (!showBoundaries) return null;
    const field = tensorDistrictField(masterSeed);
    const group = new THREE.Group();
    for (const d of field.districts) {
      const pts = loopsToSegments(districtBoundaryLoops(field, d.index), OUTLINE_Y);
      if (pts.length === 0) continue;
      group.add(segmentsObject(pts, outlineMaterial(d.color, 0.55)));
    }
    return group;
  }, [showBoundaries, masterSeed, citySize, citySketch]);

  // Toggle mode: hovering a district header fills it at 20% alpha.
  const fill = useMemo(() => {
    void citySize;
    void citySketch;
    if (!showBoundaries || hoverDistrictId === null) return null;
    const field = tensorDistrictField(masterSeed);
    const target = field.districts.find((d) => d.id === hoverDistrictId);
    if (!target) return null;
    const loops = districtBoundaryLoops(field, target.index);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(target.color),
      transparent: true,
      opacity: 0.2,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    // renderOrder 1000: above the shells' fill, below the outlines.
    const group = loopsToFillGroup(loops, mat, FILL_Y, 1000);
    return group.children.length > 0 ? group : null;
  }, [showBoundaries, hoverDistrictId, masterSeed, citySize, citySketch]);

  useEffect(() => () => disposeObject(lines), [lines]);
  useEffect(() => () => disposeObject(allLines), [allLines]);
  useEffect(() => () => disposeObject(fill), [fill]);

  // #2.2: a MapPin marker at the PINNED district's centre only (not hover, not
  // selection). Centroid of the district's membership grid — a fine
  // approximation of "centre" for the irregular tensor-field district shapes.
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
    const stepX = (maxX - minX) / CENTROID_STEPS;
    const stepZ = (maxZ - minZ) / CENTROID_STEPS;
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (let gx = 0; gx < CENTROID_STEPS; gx++) {
      for (let gz = 0; gz < CENTROID_STEPS; gz++) {
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
      {allLines && <primitive object={allLines} />}
      {fill && <primitive object={fill} />}
      {lines && <primitive object={lines} />}
      {/* Same presentation as the focused-building pin (BuildingPin.tsx, user
          2026-07-10): unfilled district-tinted MapPin, tip on the point, no
          plate behind it. */}
      <Html
        position={pin ? [pin.x, PIN_Y, pin.z] : PIN_PARKED}
        center={false}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            transform: "translate(-50%, -100%)",
            transformOrigin: "50% 100%", // tip (bottom centre) sits on the point
            color: pin?.color,
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
            display: pin ? undefined : "none",
          }}
        >
          <MapPin size={28} strokeWidth={2.5} />
        </div>
      </Html>
    </>
  );
}
