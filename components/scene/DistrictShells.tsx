"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { tensorDistrictField, tensorWallRoads } from "@/lib/seed/cityGen";
import { districtBoundaryLoops } from "@/lib/seed/districtOutline";
import { loopsToSegments, loopsToFillGroup } from "@/lib/scene/districtOverlayGeometry";

// Color-coded district fill overlay for the planning layer. Since 2026-07-10
// this draws from districtOutline's traced boundary loops (the label raster's
// native ~7.5m resolution, simplified) instead of 80×80 sample-grid quads —
// the SAME street-following shapes the directory's boundary overlay uses, so
// there is exactly one district drawing style in the app. Fill = one flat
// shape per district; seams = white traced perimeters; the Population panel's
// hover highlight re-fills the hovered district brighter. Sits just above the
// ground and below the highway lines (y=0.5).
const OVERLAY_Y = 0.25;
const BORDER_Y = 0.3; // just above the fill so the line is never z-hidden
const HIGHLIGHT_Y = 0.4;

function disposeObject(obj: THREE.Object3D | null): void {
  if (!obj) return;
  obj.traverse((child) => {
    const c = child as THREE.Mesh | THREE.LineSegments;
    if (c.geometry) c.geometry.dispose();
    if (c.material) (c.material as THREE.Material).dispose();
  });
}

export function DistrictShells({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.cityPlanning.showDistrictShells);
  // hoverDistrictId (shared with the directory + settings hover, user
  // 2026-07-11) — the old highlightDistrictId lost its last setter when the
  // settings hover unified onto the directory's traced-outline path.
  const highlightId = useSceneStore((s) => s.hoverDistrictId);
  const citySize = useSceneStore((s) => s.citySize);

  const group = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const field = tensorDistrictField(masterSeed);
    const walls = tensorWallRoads(masterSeed);
    const g = new THREE.Group();
    const seamPts: number[] = [];
    for (const d of field.districts) {
      const loops = districtBoundaryLoops(field, d.index, walls);
      // Planning overlay: draws over the scene (depthTest off, high render
      // order) like a GIS layer so districts read regardless of building
      // occlusion or camera angle. Fog off so distant fills keep their colour.
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(d.color),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        depthTest: false,
        fog: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      g.add(loopsToFillGroup(loops, mat, OVERLAY_Y, 999));
      seamPts.push(...loopsToSegments(loops, BORDER_Y));
    }

    // Seams: every district's traced perimeter in white — internal boundaries
    // draw twice (once per side), which is invisible for coincident lines.
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(seamPts, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    lines.renderOrder = 1000; // above the fill
    g.add(lines);
    return g;
  }, [masterSeed, citySize]);

  // Hover highlight: the hovered district re-filled brighter, above everything
  // (renders with or without the base shells — hover alone reveals a district).
  const highlight = useMemo(() => {
    void citySize;
    if (!highlightId) return null;
    const field = tensorDistrictField(masterSeed);
    const target = field.districts.find((d) => d.id === highlightId);
    if (!target) return null;
    const loops = districtBoundaryLoops(field, target.index, tensorWallRoads(masterSeed));
    const color = new THREE.Color(target.color).lerp(new THREE.Color("#ffffff"), 0.25);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    // renderOrder 1002: above fill, borders, and the population heat map.
    const g = loopsToFillGroup(loops, mat, HIGHLIGHT_Y, 1002);
    return g.children.length > 0 ? g : null;
  }, [highlightId, masterSeed, citySize]);

  useEffect(() => () => disposeObject(group), [group]);
  useEffect(() => () => disposeObject(highlight), [highlight]);

  return (
    <>
      {show && <primitive object={group} />}
      {highlight && <primitive object={highlight} />}
    </>
  );
}
