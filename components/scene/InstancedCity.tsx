"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { generateCity, type Archetype, type Building } from "@/lib/seed/cityGen";
import { FACADE_BY_LAYER, GLOW_BY_LAYER, generateWindowTexture } from "@/lib/seed/lightingGen";
import { packWindowAtlas, type PackInput } from "@/lib/scene/atlasPacker";
import { cityVertexShader, cityFragmentShader } from "@/lib/shaders/cityInstanced";
import { sharedTime } from "@/lib/shaders/sharedTime";
import {
  sharedIntroProgress,
  sharedIntroMode,
  sharedIntroCompleteAt,
  sharedBreathingPeriod,
} from "@/lib/shaders/sharedIntro";
import { useSceneStore } from "@/lib/state/sceneStore";

const DISTRICT_TO_IDX: Record<string, number> = {
  downtown: 0,
  residential: 1,
  industrial: 2,
  oldtown: 3,
};

// Archetypes that may use office-style correlated lighting (per-block or
// whole-floor). For these, we pick a per-building cohort: most stay per-window,
// some break floors into blocks, some snap entire floors. Others are always
// per-window.
const OFFICE_ARCHETYPES = new Set<Archetype>(["office-block", "spire"]);

// Returns the breathing correlation mode for one building:
//   0 = per-window, 1 = per-block, 2 = whole-floor.
// Office archetypes split 40 / 35 / 25 across the three modes so the city has
// visible variety. Non-office archetypes are always per-window.
function pickCorrelationMode(b: Building): number {
  if (!OFFICE_ARCHETYPES.has(b.archetype)) return 0;
  // Cheap deterministic float from windowSeed.
  const r = (Math.sin(b.windowSeed * 91.3) * 43758.5453) % 1;
  const u = r < 0 ? r + 1 : r;
  if (u < 0.4) return 0;
  if (u < 0.75) return 1;
  return 2;
}

export function InstancedCity({ masterSeed }: { masterSeed: string }) {
  const { meshes, maxRadius } = useMemo(() => buildMeshes(masterSeed), [masterSeed]);

  // Dispose old GPU resources when seed changes / unmounts.
  useEffect(() => {
    return () => {
      for (const m of meshes) {
        m.geometry.dispose();
        const mat = m.material as THREE.ShaderMaterial;
        const tex = mat.uniforms.uWindowAtlas?.value as THREE.Texture | undefined;
        tex?.dispose();
        mat.dispose();
      }
    };
  }, [meshes]);

  // Per-frame: refresh the intro-related uniforms that depend on live state
  // (camera pose for far-to-near mode, orbit centre, mode int). progress/mode
  // values themselves point at sharedIntro singletons so no per-frame work.
  useFrame(() => {
    const s = useSceneStore.getState();
    for (const m of meshes) {
      const mat = m.material as THREE.ShaderMaterial;
      mat.uniforms.uIntroCityCenter.value.set(s.orbit.centerX, 0, s.orbit.centerZ);
      mat.uniforms.uIntroMaxRadius.value = maxRadius;
      const camPos = s.cameraLive.position;
      mat.uniforms.uIntroCamPos.value.set(camPos[0], camPos[1], camPos[2]);
      mat.uniforms.uOrthoBlend.value = s.projectionBlend;
    }
  });

  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

function buildMeshes(masterSeed: string): { meshes: THREE.InstancedMesh[]; maxRadius: number } {
  const { buildings } = generateCity(masterSeed);
  if (buildings.length === 0) return { meshes: [], maxRadius: 1 };

  let maxRadius = 1;
  for (const b of buildings) {
    const r = Math.hypot(b.x, b.z + 120); // approximate centre offset
    if (r > maxRadius) maxRadius = r;
  }

  // 1. Generate per-building window pixels.
  const windowItems: PackInput[] = buildings.map((b) => {
    const tex = generateWindowTexture(masterSeed, b);
    const data = tex.texture.image.data as Uint8Array;
    // We have what we need from the DataTexture wrapper; let the GPU upload happen
    // through the atlas instead.
    tex.texture.dispose();
    return { id: b.id, cols: tex.cols, rows: tex.rows, data };
  });

  // 2. Pack into shared atlas.
  const pack = packWindowAtlas(windowItems);
  const atlasTex = new THREE.DataTexture(pack.atlas, pack.width, pack.height, THREE.RGBAFormat);
  atlasTex.minFilter = THREE.NearestFilter;
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.wrapS = THREE.ClampToEdgeWrapping;
  atlasTex.wrapT = THREE.ClampToEdgeWrapping;
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.needsUpdate = true;

  // 3. Group buildings by archetype.
  const byArchetype = new Map<Archetype, Building[]>();
  for (const b of buildings) {
    const list = byArchetype.get(b.archetype) ?? [];
    list.push(b);
    byArchetype.set(b.archetype, list);
  }

  // 4. One InstancedMesh per archetype, sharing the atlas.
  const meshes: THREE.InstancedMesh[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();

  for (const list of byArchetype.values()) {
    const N = list.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);

    const aAtlasOffset = new Float32Array(N * 2);
    const aAtlasSize = new Float32Array(N * 2);
    const aGrid = new Float32Array(N * 2);
    const aFacadeColor = new Float32Array(N * 3);
    const aFacadeGlow = new Float32Array(N);
    const aBuildingHash = new Float32Array(N);
    const aDistrictIdx = new Float32Array(N);
    const aCorrelationMode = new Float32Array(N);

    const material = new THREE.ShaderMaterial({
      vertexShader: cityVertexShader,
      fragmentShader: cityFragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uWindowAtlas: { value: null },
          uWindowWidth: { value: 0.3 },
          uWindowHeight: { value: 0.5 },
          uEmissiveBoost: { value: 1.4 },
          uTime: { value: 0 },
          uIntroProgress: { value: 0 },
          uIntroMode: { value: 0 },
          uIntroCamPos: { value: new THREE.Vector3() },
          uIntroCityCenter: { value: new THREE.Vector3() },
          uIntroMaxRadius: { value: 1 },
          uIntroCompleteAt: { value: 1e9 },
          uBreathingPeriod: { value: 90 },
          uOrthoBlend: { value: 0 },
        },
      ]),
      fog: true,
    });
    // UniformsUtils.merge breaks the texture / shared singletons; restore.
    material.uniforms.uWindowAtlas.value = atlasTex;
    material.uniforms.uTime = sharedTime;
    material.uniforms.uIntroProgress = sharedIntroProgress;
    material.uniforms.uIntroMode = sharedIntroMode;
    material.uniforms.uIntroCompleteAt = sharedIntroCompleteAt;
    material.uniforms.uBreathingPeriod = sharedBreathingPeriod;

    const mesh = new THREE.InstancedMesh(geo, material, N);

    for (let i = 0; i < N; i++) {
      const b = list[i];
      const entry = pack.entries.get(b.id);
      if (!entry) continue;

      aAtlasOffset[i * 2 + 0] = entry.offsetX / pack.width;
      aAtlasOffset[i * 2 + 1] = entry.offsetY / pack.height;
      aAtlasSize[i * 2 + 0] = entry.cols / pack.width;
      aAtlasSize[i * 2 + 1] = entry.rows / pack.height;

      aGrid[i * 2 + 0] = b.colsPerFace;
      aGrid[i * 2 + 1] = b.floors;

      color.set(FACADE_BY_LAYER[b.layer]);
      aFacadeColor[i * 3 + 0] = color.r;
      aFacadeColor[i * 3 + 1] = color.g;
      aFacadeColor[i * 3 + 2] = color.b;

      aFacadeGlow[i] = GLOW_BY_LAYER[b.layer];
      aBuildingHash[i] = b.windowSeed * 1000;
      aDistrictIdx[i] = DISTRICT_TO_IDX[b.district] ?? 0;
      aCorrelationMode[i] = pickCorrelationMode(b);

      position.set(b.x, b.height / 2, b.z);
      euler.set(0, b.rotationY, 0);
      quaternion.setFromEuler(euler);
      scale.set(b.width, b.height, b.depth);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }

    geo.setAttribute("aAtlasOffset", new THREE.InstancedBufferAttribute(aAtlasOffset, 2));
    geo.setAttribute("aAtlasSize", new THREE.InstancedBufferAttribute(aAtlasSize, 2));
    geo.setAttribute("aGrid", new THREE.InstancedBufferAttribute(aGrid, 2));
    geo.setAttribute("aFacadeColor", new THREE.InstancedBufferAttribute(aFacadeColor, 3));
    geo.setAttribute("aFacadeGlow", new THREE.InstancedBufferAttribute(aFacadeGlow, 1));
    geo.setAttribute("aBuildingHash", new THREE.InstancedBufferAttribute(aBuildingHash, 1));
    geo.setAttribute("aDistrictIdx", new THREE.InstancedBufferAttribute(aDistrictIdx, 1));
    geo.setAttribute("aCorrelationMode", new THREE.InstancedBufferAttribute(aCorrelationMode, 1));

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // bounds are union of all instances; cheaper to skip cull than compute.
    meshes.push(mesh);
  }

  return { meshes, maxRadius };
}
