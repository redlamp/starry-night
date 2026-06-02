"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  generateCity,
  ARCHETYPE_ORDER,
  tensorDistrictField,
  type Archetype,
  type Building,
} from "@/lib/seed/cityGen";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import { FACADE_BY_LAYER, GLOW_BY_LAYER, generateWindowTexture } from "@/lib/seed/lightingGen";
import { packWindowAtlas, type PackInput } from "@/lib/scene/atlasPacker";
import { cityVertexShader, cityFragmentShader } from "@/lib/shaders/cityInstanced";
import { sharedTime } from "@/lib/shaders/sharedTime";
import {
  sharedIntroMode,
  sharedIntroStartTime,
  sharedIntroDuration,
  sharedOffCycle,
  sharedRetrigger,
  sharedCycleJitter,
} from "@/lib/shaders/sharedIntro";
import { useSceneStore, DEFAULT_WINDOW_PROFILES, DEBUG_WIRE_COLOR } from "@/lib/state/sceneStore";

const DISTRICT_TO_IDX: Record<string, number> = {
  downtown: 0,
  residential: 1,
  industrial: 2,
  oldtown: 3,
};

const LAYER_TO_IDX: Record<string, number> = { front: 0, mid: 1, back: 2 };

// Debug tint mode → shader uDebugMode float (see cityInstanced fragment).
const TINT_MODE_IDX: Record<string, number> = {
  off: 0,
  district: 1,
  landuse: 2,
  archetype: 3,
  depth: 4,
  height: 5,
};

// Flat, distinct debug palettes (THREE.Color → linear, matching the facade
// colour convention; uploaded as vec3 arrays to the shader).
const TINT_LANDUSE = ["#3fd0e0", "#5fcf7a", "#e0913f", "#b07fe0"].map((c) => new THREE.Color(c)); // downtown / residential / industrial / oldtown
const TINT_ARCHETYPE = [
  "#ff6b6b",
  "#ffd166",
  "#06d6a0",
  "#4ea8de",
  "#b388ff",
  "#f78fb3",
  "#90be6d",
].map((c) => new THREE.Color(c)); // ARCHETYPE_ORDER index
const TINT_DEPTH = ["#ff5a5a", "#ffd24a", "#5a9bff"].map((c) => new THREE.Color(c)); // front / mid / back

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
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const { meshes, maxRadius } = useMemo(
    () => buildMeshes(masterSeed, cityShape, cityShapeScale),
    [masterSeed, cityShape, cityShapeScale],
  );
  const hidden = useSceneStore((s) => s.debug.renderModes.buildings === "hidden");

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
      const wa = s.windowAA;
      mat.uniforms.uAaEdge.value = wa.edge;
      mat.uniforms.uLodNear.value = wa.lodNear;
      mat.uniforms.uLodRange.value = wa.lodRange;
      mat.uniforms.uWindowMode.value = s.windowMode === "advanced" ? 1 : 0;
      mat.uniforms.uWinSimpleW.value = s.windowSimple.w;
      mat.uniforms.uWinSimpleH.value = s.windowSimple.h;
      const profiles = s.windowProfiles;
      const fw = mat.uniforms.uWinFracW.value as number[];
      const fh = mat.uniforms.uWinFracH.value as number[];
      for (let k = 0; k < ARCHETYPE_ORDER.length; k++) {
        const p = profiles[ARCHETYPE_ORDER[k]];
        fw[k] = p.w;
        fh[k] = p.h;
      }
      // Debug view (Slice A tint + Slice B wireframe) — uniform / flag only.
      const tint = s.debug.buildingTint;
      mat.uniforms.uDebugMode.value = TINT_MODE_IDX[tint.mode] ?? 0;
      mat.uniforms.uDebugTint.value = tint.mode === "off" ? 0 : tint.intensity;
      const wire = s.debug.renderModes.buildings === "wireframe";
      mat.wireframe = wire;
      mat.uniforms.uWireframe.value = wire ? 1 : 0;
    }
  });

  return (
    <group visible={!hidden}>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

function buildMeshes(
  masterSeed: string,
  shape: CityShapeSetting,
  shapeScale: number,
): { meshes: THREE.InstancedMesh[]; maxRadius: number } {
  const { buildings } = generateCity(masterSeed, shape, shapeScale);
  if (buildings.length === 0) return { meshes: [], maxRadius: 1 };

  let maxRadius = 1;
  let maxHeight = 1;
  for (const b of buildings) {
    const r = Math.hypot(b.x, b.z + 120); // approximate centre offset
    if (r > maxRadius) maxRadius = r;
    if (b.height > maxHeight) maxHeight = b.height;
  }

  // Parcel id → plan colour (the DistrictShells palette) for the district tint
  // debug mode. tensorDistrictField is cached, so this is a cheap shared read.
  const parcelColor = new Map<string, string>();
  for (const d of tensorDistrictField(masterSeed).districts) parcelColor.set(d.id, d.color);

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
    const aGrid = new Float32Array(N * 3); // cols, rows, archetypeIdx
    const aFacadeColor = new Float32Array(N * 3);
    const aFacadeGlow = new Float32Array(N);
    const aBuildingHash = new Float32Array(N);
    const aMisc = new Float32Array(N * 3); // x=districtIdx, y=correlationMode, z=layerIdx
    const aDebugDistrictColor = new Float32Array(N * 3);

    const material = new THREE.ShaderMaterial({
      vertexShader: cityVertexShader,
      fragmentShader: cityFragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uWindowAtlas: { value: null },
          uWinFracW: { value: ARCHETYPE_ORDER.map((a) => DEFAULT_WINDOW_PROFILES[a].w) },
          uWinFracH: { value: ARCHETYPE_ORDER.map((a) => DEFAULT_WINDOW_PROFILES[a].h) },
          uWindowMode: { value: 1 },
          uWinSimpleW: { value: 0.3 },
          uWinSimpleH: { value: 0.5 },
          uEmissiveBoost: { value: 1.4 },
          uTime: { value: 0 },
          uIntroMode: { value: 0 },
          uIntroCamPos: { value: new THREE.Vector3() },
          uIntroCityCenter: { value: new THREE.Vector3() },
          uIntroMaxRadius: { value: 1 },
          uIntroStartTime: { value: 0 },
          uIntroDuration: { value: 60 },
          uOffCycle: { value: 60 },
          uRetrigger: { value: 30 },
          uCycleJitter: { value: 0.3 },
          uOrthoBlend: { value: 0 },
          uAaEdge: { value: 1.1 },
          uLodNear: { value: 0.2 },
          uLodRange: { value: 0.4 },
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
    // UniformsUtils.merge breaks the texture / shared singletons + clones the
    // debug palette arrays; restore all by reference.
    material.uniforms.uWindowAtlas.value = atlasTex;
    material.uniforms.uTime = sharedTime;
    material.uniforms.uIntroMode = sharedIntroMode;
    material.uniforms.uIntroStartTime = sharedIntroStartTime;
    material.uniforms.uIntroDuration = sharedIntroDuration;
    material.uniforms.uOffCycle = sharedOffCycle;
    material.uniforms.uRetrigger = sharedRetrigger;
    material.uniforms.uCycleJitter = sharedCycleJitter;
    material.uniforms.uMaxHeight.value = maxHeight;
    material.uniforms.uLandusePalette.value = TINT_LANDUSE;
    material.uniforms.uArchetypePalette.value = TINT_ARCHETYPE;
    material.uniforms.uDepthPalette.value = TINT_DEPTH;
    material.uniforms.uWireColor.value.set(DEBUG_WIRE_COLOR);

    const mesh = new THREE.InstancedMesh(geo, material, N);

    for (let i = 0; i < N; i++) {
      const b = list[i];
      const entry = pack.entries.get(b.id);
      if (!entry) continue;

      aAtlasOffset[i * 2 + 0] = entry.offsetX / pack.width;
      aAtlasOffset[i * 2 + 1] = entry.offsetY / pack.height;
      aAtlasSize[i * 2 + 0] = entry.cols / pack.width;
      aAtlasSize[i * 2 + 1] = entry.rows / pack.height;

      aGrid[i * 3 + 0] = b.colsPerFace;
      aGrid[i * 3 + 1] = b.floors;
      aGrid[i * 3 + 2] = ARCHETYPE_ORDER.indexOf(b.archetype);

      color.set(FACADE_BY_LAYER[b.layer]);
      aFacadeColor[i * 3 + 0] = color.r;
      aFacadeColor[i * 3 + 1] = color.g;
      aFacadeColor[i * 3 + 2] = color.b;

      aFacadeGlow[i] = GLOW_BY_LAYER[b.layer];
      aBuildingHash[i] = b.windowSeed * 1000;
      aMisc[i * 3 + 0] = DISTRICT_TO_IDX[b.district] ?? 0;
      aMisc[i * 3 + 1] = pickCorrelationMode(b);
      aMisc[i * 3 + 2] = LAYER_TO_IDX[b.layer] ?? 1;

      color.set(parcelColor.get(b.districtId) ?? "#888888");
      aDebugDistrictColor[i * 3 + 0] = color.r;
      aDebugDistrictColor[i * 3 + 1] = color.g;
      aDebugDistrictColor[i * 3 + 2] = color.b;

      position.set(b.x, b.height / 2, b.z);
      // rotationY = atan2(uz, ux) is the road-aligned bearing (matches the /plan
      // canvas, which is y-down). Three's Y-up right-handed frame rotates the
      // opposite way, so the sign is negated here to keep footprints square to
      // the roads instead of mirrored about Z (which made them clip curved roads).
      euler.set(0, -b.rotationY, 0);
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
    geo.setAttribute("aMisc", new THREE.InstancedBufferAttribute(aMisc, 3));
    geo.setAttribute(
      "aDebugDistrictColor",
      new THREE.InstancedBufferAttribute(aDebugDistrictColor, 3),
    );

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // bounds are union of all instances; cheaper to skip cull than compute.
    meshes.push(mesh);
  }

  return { meshes, maxRadius };
}
