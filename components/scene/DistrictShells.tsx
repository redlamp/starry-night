"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { tensorDistrictField } from "@/lib/seed/cityGen";

// Color-coded district fill overlay for the planning layer. Samples the
// district field on a grid and draws one flat quad per occupied cell, colored
// by its district. Single InstancedMesh = one draw call. A white LineSegments
// pass traces every cell edge where the two neighbours belong to different
// districts (internal seams + outer perimeter), so each district reads as an
// outlined region. Sits just above the ground (y=0.25) and below the highway
// lines (y=0.5).
const OVERLAY_STEPS = 80;
const OVERLAY_Y = 0.25;
const BORDER_Y = 0.3; // just above the fill so the line is never z-hidden

export function DistrictShells({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.cityPlanning.showDistrictShells);
  const highlightId = useSceneStore((s) => s.highlightDistrictId);
  const citySize = useSceneStore((s) => s.citySize);

  const { group, cellsByDistrict, stepX, stepZ } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const field = tensorDistrictField(masterSeed);
    const { minX, maxX, minZ, maxZ } = field.bounds;
    const stepX = (maxX - minX) / OVERLAY_STEPS;
    const stepZ = (maxZ - minZ) / OVERLAY_STEPS;

    // Sample district index per cell once; reused for the fill + the borders.
    const idxGrid: number[][] = [];
    for (let gx = 0; gx < OVERLAY_STEPS; gx++) {
      const col: number[] = [];
      for (let gz = 0; gz < OVERLAY_STEPS; gz++) {
        const x = minX + (gx + 0.5) * stepX;
        const z = minZ + (gz + 0.5) * stepZ;
        col.push(field.classify(x, z));
      }
      idxGrid.push(col);
    }

    // --- Fill: one quad per occupied cell ---
    const cells: Array<{ x: number; z: number; color: string }> = [];
    // Cells grouped by owning district — the hover-highlight layer (Population
    // panel district list) builds its emphasis mesh from these.
    const cellsByDistrict = new Map<string, { cells: Array<{ x: number; z: number }>; color: string }>();
    for (let gx = 0; gx < OVERLAY_STEPS; gx++) {
      for (let gz = 0; gz < OVERLAY_STEPS; gz++) {
        const idx = idxGrid[gx][gz];
        if (idx < 0) continue;
        const x = minX + (gx + 0.5) * stepX;
        const z = minZ + (gz + 0.5) * stepZ;
        const d = field.districts[idx];
        cells.push({ x, z, color: d.color });
        let entry = cellsByDistrict.get(d.id);
        if (!entry) {
          entry = { cells: [], color: d.color };
          cellsByDistrict.set(d.id, entry);
        }
        entry.cells.push({ x, z });
      }
    }

    const geo = new THREE.PlaneGeometry(stepX, stepZ);
    // Planning overlay: draws over the scene (depthTest off, high render order)
    // like a GIS layer so districts read regardless of building occlusion or
    // camera angle. Fog off so distant cells keep their colour.
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const im = new THREE.InstancedMesh(geo, mat, cells.length);
    im.frustumCulled = false;
    im.renderOrder = 999;

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    quat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); // lay flat
    const color = new THREE.Color();
    for (let i = 0; i < cells.length; i++) {
      pos.set(cells[i].x, OVERLAY_Y, cells[i].z);
      matrix.compose(pos, quat, scale);
      im.setMatrixAt(i, matrix);
      im.setColorAt(i, color.set(cells[i].color));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;

    // --- Borders: a segment on each cell edge where the two sides differ ---
    const pts: number[] = [];
    const isBorder = (a: number, b: number) => a !== b && (a >= 0 || b >= 0);
    for (let gx = 0; gx < OVERLAY_STEPS; gx++) {
      for (let gz = 0; gz < OVERLAY_STEPS; gz++) {
        const a = idxGrid[gx][gz];
        // shared edge with the right neighbour → vertical line in XZ
        if (gx + 1 < OVERLAY_STEPS && isBorder(a, idxGrid[gx + 1][gz])) {
          const ex = minX + (gx + 1) * stepX;
          pts.push(ex, BORDER_Y, minZ + gz * stepZ, ex, BORDER_Y, minZ + (gz + 1) * stepZ);
        }
        // shared edge with the bottom neighbour → horizontal line in XZ
        if (gz + 1 < OVERLAY_STEPS && isBorder(a, idxGrid[gx][gz + 1])) {
          const ez = minZ + (gz + 1) * stepZ;
          pts.push(minX + gx * stepX, BORDER_Y, ez, minX + (gx + 1) * stepX, BORDER_Y, ez);
        }
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
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

    const g = new THREE.Group();
    g.add(im);
    g.add(lines);
    return { group: g, cellsByDistrict, stepX, stepZ };
  }, [masterSeed, citySize]);

  // Hover highlight: the hovered district's cells, brighter + above everything
  // (renders with or without the base shells — hover alone reveals a district).
  const highlight = useMemo(() => {
    if (!highlightId) return null;
    const entry = cellsByDistrict.get(highlightId);
    if (!entry || entry.cells.length === 0) return null;
    const geo = new THREE.PlaneGeometry(stepX, stepZ);
    const color = new THREE.Color(entry.color).lerp(new THREE.Color("#ffffff"), 0.25);
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
    const im = new THREE.InstancedMesh(geo, mat, entry.cells.length);
    im.frustumCulled = false;
    im.renderOrder = 1002; // above fill, borders, and the population heat map
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    quat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < entry.cells.length; i++) {
      pos.set(entry.cells[i].x, BORDER_Y + 0.1, entry.cells[i].z);
      matrix.compose(pos, quat, scale);
      im.setMatrixAt(i, matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, [highlightId, cellsByDistrict, stepX, stepZ]);

  useEffect(() => {
    return () => {
      group.traverse((o) => {
        const m = o as THREE.Mesh | THREE.LineSegments;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        mat?.dispose();
      });
    };
  }, [group]);

  useEffect(() => {
    return () => {
      if (!highlight) return;
      highlight.geometry.dispose();
      (highlight.material as THREE.Material).dispose();
    };
  }, [highlight]);

  if (!show && !highlight) return null;
  return (
    <>
      {show && <primitive object={group} />}
      {highlight && <primitive object={highlight} />}
    </>
  );
}
