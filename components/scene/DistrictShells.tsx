"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { tensorDistrictField } from "@/lib/seed/cityGen";

// Color-coded district fill overlay for the planning layer. Samples the
// district field on a grid and draws one flat quad per occupied cell, colored
// by its district. Single InstancedMesh = one draw call. Sits just above the
// ground (y=0.25) and below the highway lines (y=0.5).
const OVERLAY_STEPS = 80;
const OVERLAY_Y = 0.25;

export function DistrictShells({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.cityPlanning.showDistrictShells);

  const mesh = useMemo(() => {
    const field = tensorDistrictField(masterSeed);
    const { minX, maxX, minZ, maxZ } = field.bounds;
    const step = (maxX - minX) / OVERLAY_STEPS;

    // Collect occupied cells first so the InstancedMesh is exactly sized.
    const cells: Array<{ x: number; z: number; color: string }> = [];
    for (let gx = 0; gx < OVERLAY_STEPS; gx++) {
      for (let gz = 0; gz < OVERLAY_STEPS; gz++) {
        const x = minX + (gx + 0.5) * step;
        const z = minZ + (gz + 0.5) * ((maxZ - minZ) / OVERLAY_STEPS);
        const idx = field.classify(x, z);
        if (idx < 0) continue;
        cells.push({ x, z, color: field.districts[idx].color });
      }
    }

    const geo = new THREE.PlaneGeometry(step, (maxZ - minZ) / OVERLAY_STEPS);
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
    // Lay flat on the ground plane.
    quat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const color = new THREE.Color();
    for (let i = 0; i < cells.length; i++) {
      pos.set(cells[i].x, OVERLAY_Y, cells[i].z);
      matrix.compose(pos, quat, scale);
      im.setMatrixAt(i, matrix);
      im.setColorAt(i, color.set(cells[i].color));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }, [masterSeed]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };
  }, [mesh]);

  if (!show) return null;
  return <primitive object={mesh} />;
}
