"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { ARCHETYPE_ORDER } from "@/lib/seed/cityGen";
import {
  correlationModeFor,
  facadeColorFor,
  facadeGlowFor,
  generateWindowTexture,
} from "@/lib/seed/lightingGen";
import { packWindowAtlas, type PackInput } from "@/lib/scene/atlasPacker";
import { cityVertexShader, cityFragmentShader } from "@/lib/shaders/cityInstanced";
import {
  DEFAULT_FACADE,
  DEFAULT_WINDOW_AA,
  DEFAULT_WINDOW_PROFILES,
  DEFAULT_WINDOW_SIMPLE,
} from "@/lib/state/sceneDefaults";
import type { RackProps } from "./index";

// Baseline: the production pipeline, miniaturised. Same generateWindowTexture →
// packWindowAtlas → cityInstanced shader chain as InstancedCity, minus tile
// culling, live settings, and debug plumbing — uniforms are pinned to the scene
// defaults so the rack shows exactly what the shipped city shows. One
// InstancedMesh over all specimens (archetype index rides the aGrid attribute,
// so mixed archetypes don't need per-archetype meshes here).

// Debug tint palettes are never read while uDebugMode stays 0, but the shader
// declares fixed-size uniform arrays — feed correctly-sized dummies.
const BLACK4 = [0, 0, 0, 0].map(() => new THREE.Color(0));
const BLACK7 = [0, 0, 0, 0, 0, 0, 0].map(() => new THREE.Color(0));
const BLACK3 = [0, 0, 0].map(() => new THREE.Color(0));

export function CurrentShaderRack({ specimens, seed }: RackProps) {
  const mesh = useMemo(() => buildRackMesh(specimens, seed), [specimens, seed]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.ShaderMaterial;
      (mat.uniforms.uWindowAtlas.value as THREE.Texture | null)?.dispose();
      mat.dispose();
    };
  }, [mesh]);

  // Window flicker / TV / cycle animation is pure shader math on uTime.
  useFrame((state) => {
    const mat = mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uIntroCamPos.value.copy(state.camera.position);
  });

  return <primitive object={mesh} />;
}

function buildRackMesh(specimens: RackProps["specimens"], seed: string): THREE.InstancedMesh {
  // 1. Per-building window pixels → shared atlas (identical to InstancedCity).
  const windowItems: PackInput[] = specimens.map((b) => {
    const tex = generateWindowTexture(seed, b);
    const data = tex.texture.image.data as Uint8Array;
    tex.texture.dispose();
    return { id: b.id, cols: tex.cols, rows: tex.rows, data };
  });
  const pack = packWindowAtlas(windowItems);
  const atlasTex = new THREE.DataTexture(pack.atlas, pack.width, pack.height, THREE.RGBAFormat);
  atlasTex.minFilter = THREE.NearestFilter;
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.wrapS = THREE.ClampToEdgeWrapping;
  atlasTex.wrapT = THREE.ClampToEdgeWrapping;
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.needsUpdate = true;

  const N = specimens.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const aAtlasOffset = new Float32Array(N * 2);
  const aAtlasSize = new Float32Array(N * 2);
  const aGrid = new Float32Array(N * 3);
  const aFacadeColor = new Float32Array(N * 3);
  const aFacadeGlow = new Float32Array(N);
  const aBuildingHash = new Float32Array(N);
  const aMisc = new Float32Array(N * 4);
  const aDebugDistrictColor = new Float32Array(N * 3); // unused (uDebugMode 0), zeros

  const material = new THREE.ShaderMaterial({
    vertexShader: cityVertexShader,
    fragmentShader: cityFragmentShader,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uWindowAtlas: { value: null },
        uWinFracWMin: { value: ARCHETYPE_ORDER.map((a) => DEFAULT_WINDOW_PROFILES[a].wMin) },
        uWinFracWMax: { value: ARCHETYPE_ORDER.map((a) => DEFAULT_WINDOW_PROFILES[a].wMax) },
        uWinFracHMin: { value: ARCHETYPE_ORDER.map((a) => DEFAULT_WINDOW_PROFILES[a].hMin) },
        uWinFracHMax: { value: ARCHETYPE_ORDER.map((a) => DEFAULT_WINDOW_PROFILES[a].hMax) },
        uWindowMode: { value: 1 },
        uWinSimpleWMin: { value: DEFAULT_WINDOW_SIMPLE.wMin },
        uWinSimpleWMax: { value: DEFAULT_WINDOW_SIMPLE.wMax },
        uWinSimpleHMin: { value: DEFAULT_WINDOW_SIMPLE.hMin },
        uWinSimpleHMax: { value: DEFAULT_WINDOW_SIMPLE.hMax },
        uEmissiveBoost: { value: 1.4 },
        uStagger: { value: DEFAULT_WINDOW_AA.stagger },
        uCurtainShare: { value: DEFAULT_WINDOW_AA.curtain },
        uCurtainWidth: { value: DEFAULT_WINDOW_AA.curtainW },
        uLightsOn: { value: 1 },
        uTime: { value: 0 },
        // Intro long since finished: every window is deep into its steady
        // on/off cycle, matching the settled main scene.
        uIntroMode: { value: 0 },
        uIntroCamPos: { value: new THREE.Vector3() },
        uIntroCityCenter: { value: new THREE.Vector3() },
        uIntroMaxRadius: { value: 3000 },
        uIntroStartTime: { value: -10000 },
        uIntroDuration: { value: 60 },
        uOffCycle: { value: 60 },
        uRetrigger: { value: 30 },
        uCycleJitter: { value: 0.3 },
        uOrthoBlend: { value: 0 },
        uAaEdge: { value: DEFAULT_WINDOW_AA.edge },
        uLodNear: { value: DEFAULT_WINDOW_AA.lodEnabled ? DEFAULT_WINDOW_AA.lodNear : 1e9 },
        uLodRange: { value: DEFAULT_WINDOW_AA.lodRange },
        uDebugMode: { value: 0 },
        uDebugTint: { value: 0 },
        uMaxHeight: { value: 1 },
        uLandusePalette: { value: [] },
        uArchetypePalette: { value: [] },
        uDepthPalette: { value: [] },
        uWireframe: { value: 0 },
        uWireColor: { value: new THREE.Color() },
      },
    ]),
    fog: true,
  });
  // merge clones/breaks object values — restore by reference.
  material.uniforms.uWindowAtlas.value = atlasTex;
  material.uniforms.uLandusePalette.value = BLACK4;
  material.uniforms.uArchetypePalette.value = BLACK7;
  material.uniforms.uDepthPalette.value = BLACK3;

  let maxHeight = 1;
  for (const b of specimens) if (b.height > maxHeight) maxHeight = b.height;
  material.uniforms.uMaxHeight.value = maxHeight;

  const mesh = new THREE.InstancedMesh(geo, material, N);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();

  for (let i = 0; i < N; i++) {
    const b = specimens[i];
    const entry = pack.entries.get(b.id);
    if (!entry) continue;

    aAtlasOffset[i * 2 + 0] = entry.offsetX / pack.width;
    aAtlasOffset[i * 2 + 1] = entry.offsetY / pack.height;
    aAtlasSize[i * 2 + 0] = entry.cols / pack.width;
    aAtlasSize[i * 2 + 1] = entry.rows / pack.height;

    aGrid[i * 3 + 0] = b.colsPerFace;
    aGrid[i * 3 + 1] = b.floors;
    aGrid[i * 3 + 2] = ARCHETYPE_ORDER.indexOf(b.archetype);

    facadeColorFor(b, color, DEFAULT_FACADE);
    aFacadeColor[i * 3 + 0] = color.r;
    aFacadeColor[i * 3 + 1] = color.g;
    aFacadeColor[i * 3 + 2] = color.b;

    aFacadeGlow[i] = facadeGlowFor(b);
    aBuildingHash[i] = b.windowSeed * 1000;
    aMisc[i * 4 + 0] = 0;
    aMisc[i * 4 + 1] = correlationModeFor(b);
    aMisc[i * 4 + 2] = 1;
    aMisc[i * 4 + 3] = 0.5;

    position.set(b.x, b.height / 2, b.z);
    // Specimens are authored directly in three's frame — no plan-space sign flip.
    euler.set(0, b.rotationY, 0);
    quaternion.setFromEuler(euler);
    scale.set(b.width, b.height, b.depth);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }

  geo.setAttribute("aAtlasOffset", new THREE.InstancedBufferAttribute(aAtlasOffset, 2));
  geo.setAttribute("aAtlasSize", new THREE.InstancedBufferAttribute(aAtlasSize, 2));
  geo.setAttribute("aGrid", new THREE.InstancedBufferAttribute(aGrid, 3));
  geo.setAttribute("aFacadeColor", new THREE.InstancedBufferAttribute(aFacadeColor, 3));
  geo.setAttribute("aFacadeGlow", new THREE.InstancedBufferAttribute(aFacadeGlow, 1));
  geo.setAttribute("aBuildingHash", new THREE.InstancedBufferAttribute(aBuildingHash, 1));
  geo.setAttribute("aMisc", new THREE.InstancedBufferAttribute(aMisc, 4));
  geo.setAttribute(
    "aDebugDistrictColor",
    new THREE.InstancedBufferAttribute(aDebugDistrictColor, 3),
  );
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // instances extend far beyond the unit box's bounds

  return mesh;
}
