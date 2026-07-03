"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import seedrandom from "seedrandom";
import type { Building } from "@/lib/seed/cityGen";
import { correlationModeFor, facadeColorFor, generateWindowTexture } from "@/lib/seed/lightingGen";
import { DEFAULT_FACADE } from "@/lib/state/sceneDefaults";
import type { RackProps } from "./index";

// Experiment 1: bake the whole facade — window mask AND lit colour — into an
// ordinary texture per building, then let the GPU's own minification pipeline
// (trilinear mipmaps + anisotropic filtering) do the anti-aliasing. This is the
// opposite bet from the current shader, which reconstructs windows procedurally
// per fragment and must hand-fight every footprint regime. Prefiltering makes
// all three #82 artifact classes structurally impossible: a mip level IS the
// correctly averaged lit fraction.
//
// Known costs, on purpose (this rack exists to price them):
//   - static bake: no flicker / TV shimmer / wake cascade (would need re-bakes
//     or a small state texture modulating the baked mask)
//   - one bake per building: ~cols×floors×16² canvas pixels + mip memory
//   - all four side faces share one texture (depth faces stretch the grid)
//   - linear mag filter reads slightly soft at point-blank range

const CELL_PX = 16;

export function BakedFacadeRack({ specimens, seed }: RackProps) {
  const gl = useThree((s) => s.gl);
  const built = useMemo(
    () => buildRack(specimens, seed, gl.capabilities.getMaxAnisotropy()),
    [specimens, seed, gl],
  );

  useEffect(() => {
    return () => {
      built.geometry.dispose();
      for (const e of built.entries) {
        e.sideMat.map?.dispose();
        e.sideMat.dispose();
        e.capMat.dispose();
      }
    };
  }, [built]);

  return (
    <>
      {built.entries.map((e) => (
        <mesh
          key={e.b.id}
          geometry={built.geometry}
          material={e.materials}
          position={[e.b.x, e.b.height / 2, e.b.z]}
          rotation={[0, e.b.rotationY, 0]}
          scale={[e.b.width, e.b.height, e.b.depth]}
        />
      ))}
    </>
  );
}

type RackEntry = {
  b: Building;
  sideMat: THREE.MeshBasicMaterial;
  capMat: THREE.MeshBasicMaterial;
  materials: THREE.Material[];
};

function buildRack(specimens: Building[], seed: string, maxAniso: number) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const color = new THREE.Color();
  const entries: RackEntry[] = specimens.map((b) => {
    const tex = bakeFacadeTexture(b, seed, maxAniso);
    facadeColorFor(b, color, DEFAULT_FACADE);
    const sideMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const capMat = new THREE.MeshBasicMaterial({ color: color.clone(), toneMapped: false });
    // BoxGeometry group order: +x, -x, +y, -y, +z, -z
    const materials = [sideMat, sideMat, capMat, capMat, sideMat, sideMat];
    return { b, sideMat, capMat, materials };
  });
  return { geometry, entries };
}

function bakeFacadeTexture(b: Building, seed: string, maxAniso: number): THREE.CanvasTexture {
  // Reuse the production per-cell state (lit / band / TV, colour, intensity) so
  // the bake differs from the current shader only in HOW cells become pixels.
  const winTex = generateWindowTexture(seed, b);
  const data = winTex.texture.image.data as Uint8Array;
  const { cols, rows } = winTex;
  winTex.texture.dispose();

  const rng = seedrandom(`${seed}::bake::${b.id}`);
  const fracW = 0.5 + rng() * 0.25;
  const fracH = 0.4 + rng() * 0.25;

  const canvas = document.createElement("canvas");
  canvas.width = cols * CELL_PX;
  canvas.height = rows * CELL_PX;
  const ctx = canvas.getContext("2d")!;

  const facade = new THREE.Color();
  facadeColorFor(b, facade, DEFAULT_FACADE);
  ctx.fillStyle = `#${facade.getHexString()}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Fairness: the shader doesn't paint band rows (alpha 200) wall-to-wall — on
  // fractional-band buildings (correlation mode 2) it cuts each row down to an
  // uneven seeded segment. Baking full slabs overstated lit area badly (the
  // first capture read pale/white next to the real thing). Approximate the cut
  // with one seeded run per band row. TVs (alpha 128) shimmer dim most of the
  // time in the shader, so bake them at a time-averaged brightness.
  const fractionalBands = correlationModeFor(b) === 2;
  for (let r = 0; r < rows; r++) {
    let bandC0 = 0;
    let bandLen = cols;
    if (fractionalBands) {
      bandC0 = Math.floor(rng() * cols * 0.5);
      bandLen = Math.max(1, Math.floor(cols * (0.25 + rng() * 0.6)));
    }
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c) * 4;
      const a = data[idx + 3];
      if (a === 0) continue;
      if (a === 200 && fractionalBands && (c < bandC0 || c >= bandC0 + bandLen)) continue;
      const boost = a === 128 ? 0.55 : 1.4; // TVs time-averaged; else uEmissiveBoost
      const cr = Math.min(255, Math.round(data[idx + 0] * boost));
      const cg = Math.min(255, Math.round(data[idx + 1] * boost));
      const cb = Math.min(255, Math.round(data[idx + 2] * boost));
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      // Bands read as continuous slabs; windows/TVs as centred panes.
      const w = (a === 200 ? 0.96 : fracW) * CELL_PX;
      const h = (a === 200 ? fracH * 1.2 : fracH) * CELL_PX;
      const x = c * CELL_PX + (CELL_PX - w) / 2;
      // Canvas rows run top-down; texture V runs bottom-up. Flip so floor 0 is
      // at the building's base like the shader's grid.
      const y = (rows - 1 - r) * CELL_PX + (CELL_PX - h) / 2;
      ctx.fillRect(x, y, w, h);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  return tex;
}
