"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, maxHalfExtent } from "@/lib/seed/topology";
import { computeLattice } from "@/lib/seed/lattice";
import { buildTensorField } from "@/lib/seed/tensorField";

// Tensor Field view (#40 Phase 1). Visualises the direction field that the road
// network follows: a grid of short "ticks" laid on the ground, each aligned to
// the MAJOR eigenvector (the grid grain) at that point and coloured by its
// angle. Reveals how the grid bends, and the tangential swirl around a radial
// plaza basis. One InstancedMesh = one draw call; pure function of the seed.
//
// GIS-overlay style like DistrictShells: depthTest off, high renderOrder, fog
// off — reads regardless of camera angle / building occlusion. Off by default.
const GRID_N = 44;
const OVERLAY_Y = 0.4; // above ground (0) + district shells (0.25), below the buildings' bulk

export function TensorFieldOverlay({ masterSeed }: { masterSeed: string }) {
  const show = useSceneStore((s) => s.debug.showTensorField);
  const citySize = useSceneStore((s) => s.citySize);

  const mesh = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const lattice = computeLattice(masterSeed);
    const field = buildTensorField(masterSeed, lattice);
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    // Cover the tier's full gen extent (#14/#58) — the field is laid out at the
    // tier extent; a smaller overlay would show only the inner region.
    const half = maxHalfExtent();
    const minX = cx - half;
    const minZ = cz - half;
    const step = (2 * half) / GRID_N;

    // Collect non-degenerate samples so the InstancedMesh is exactly sized.
    const ticks: Array<{ x: number; z: number; angle: number }> = [];
    for (let gi = 0; gi < GRID_N; gi++) {
      for (let gj = 0; gj < GRID_N; gj++) {
        const x = minX + (gi + 0.5) * step;
        const z = minZ + (gj + 0.5) * step;
        const dir = field.sample(x, z, true);
        if (!dir) continue;
        ticks.push({ x, z, angle: Math.atan2(dir.z, dir.x) });
      }
    }

    const len = step * 0.72;
    const wid = step * 0.14;
    const geo = new THREE.PlaneGeometry(len, wid);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const im = new THREE.InstancedMesh(geo, mat, ticks.length);
    im.frustumCulled = false;
    im.renderOrder = 1000;

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const color = new THREE.Color();
    // Lay the plane flat (long axis → world +X), then spin it about world Y so
    // the long axis points along the sampled direction.
    const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const yAxis = new THREE.Vector3(0, 1, 0);
    const qDir = new THREE.Quaternion();
    for (let i = 0; i < ticks.length; i++) {
      const t = ticks[i];
      qDir.setFromAxisAngle(yAxis, -t.angle);
      quat.multiplyQuaternions(qDir, qFlat);
      pos.set(t.x, OVERLAY_Y, t.z);
      matrix.compose(pos, quat, scale);
      im.setMatrixAt(i, matrix);
      // Hue from the grain angle, folded to [0, π) — the tensor has a π
      // ambiguity, so ±dir share a hue. Vivid + bright to read on the dark scene.
      const hue = (((t.angle % Math.PI) + Math.PI) % Math.PI) / Math.PI;
      im.setColorAt(i, color.setHSL(hue, 0.85, 0.6));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }, [masterSeed, citySize]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };
  }, [mesh]);

  if (!show) return null;
  return <primitive object={mesh} />;
}
