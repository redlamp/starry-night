"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  partitionByTile,
  visibleTiles,
  compactVisible,
  type CompactChannel,
  type TilePartition,
} from "@/lib/scene/tileCull";
import { reportTileCull } from "@/lib/scene/tileCullDebug";
import {
  generateCity,
  ARCHETYPE_ORDER,
  tensorDistrictField,
  type Archetype,
  type Building,
} from "@/lib/seed/cityGen";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import {
  correlationModeFor,
  facadeColorFor,
  facadeGlowFor,
  generateWindowTexture,
} from "@/lib/seed/lightingGen";
import { packWindowAtlas, type PackInput } from "@/lib/scene/atlasPacker";
import { buildingPopulation } from "@/lib/seed/population";
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
import {
  useSceneStore,
  DEFAULT_WINDOW_AA,
  DEFAULT_WINDOW_PROFILES,
  DEFAULT_WINDOW_SIMPLE,
  DEBUG_WIRE_COLOR,
} from "@/lib/state/sceneStore";

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
  population: 6,
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

type TiledMesh = {
  mesh: THREE.InstancedMesh;
  partition: TilePartition;
  channels: CompactChannel[];
  // Facade recolor (live sliders): tile-major building list + the facade
  // channel whose src array is the stable copy compaction reads from.
  list: Building[];
  facadeChannel: CompactChannel;
};

export function InstancedCity({ masterSeed }: { masterSeed: string }) {
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const { entries, maxRadius } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    void citySketch; // a registered sketch is a different city (#40) — likewise
    return buildMeshes(masterSeed, cityShape, cityShapeScale);
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch]);
  const meshes = useMemo(() => entries.map((e) => e.mesh), [entries]);
  const hidden = useSceneStore((s) => s.debug.renderModes.buildings === "hidden");

  // #55 per-frame tile cull state — one signature per archetype mesh, reset on
  // regen so the first frame always materialises.
  const frustum = useRef(new THREE.Frustum());
  const visible = useRef<number[]>([]);
  const lastSigs = useRef<string[]>([]);
  useEffect(() => {
    lastSigs.current = entries.map(() => "");
  }, [entries]);

  // Facade recolor: sliders rewrite the per-instance colour SOURCE arrays
  // (the tile-major copies compaction reads from), then blank the cull
  // signatures so the next frame recompacts src → draw buffer. No atlas or
  // geometry rebuild — ~N setHSL calls per change.
  const facade = useSceneStore((s) => s.facade);
  useEffect(() => {
    const c = new THREE.Color();
    for (let e = 0; e < entries.length; e++) {
      const { list, facadeChannel } = entries[e];
      const src = facadeChannel.src;
      for (let i = 0; i < list.length; i++) {
        facadeColorFor(list[i], c, facade);
        src[i * 3 + 0] = c.r;
        src[i * 3 + 1] = c.g;
        src[i * 3 + 2] = c.b;
      }
      lastSigs.current[e] = "";
    }
  }, [entries, facade]);

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
  useFrame((state) => {
    const s = useSceneStore.getState();

    // #55 per-tile culling: lower each archetype mesh's instance count to the
    // frustum-visible tiles. Instance copies fire only when a mesh's visible
    // tile set changes; a still camera costs only the AABB tests.
    let tilesVis = 0;
    let tilesTot = 0;
    let drawn = 0;
    for (let e = 0; e < entries.length; e++) {
      const { mesh, partition, channels } = entries[e];
      tilesTot += partition.tiles.length;
      if (s.lod.tiles && partition.tiles.length > 1) {
        const sig = visibleTiles(partition, state.camera, frustum.current, visible.current);
        if (sig !== lastSigs.current[e]) {
          lastSigs.current[e] = sig;
          mesh.count = compactVisible(partition, visible.current, channels);
        }
        tilesVis += visible.current.length;
      } else {
        if (lastSigs.current[e] !== "ALL") {
          lastSigs.current[e] = "ALL";
          mesh.count = compactVisible(partition, null, channels);
        }
        tilesVis += partition.tiles.length;
      }
      drawn += mesh.count;
    }
    // #55 debug readout (Debug View → Tile culling) — cheap counter writes.
    const total = entries.reduce((n, e) => n + e.partition.total, 0);
    reportTileCull("buildings", tilesVis, tilesTot, hidden ? 0 : drawn, total, s.lod.tiles);
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
      mat.uniforms.uStagger.value = wa.stagger;
      mat.uniforms.uCurtainShare.value = wa.curtain;
      mat.uniforms.uCurtainWidth.value = wa.curtainW;
      mat.uniforms.uLightsOn.value = s.windowLights ? 1 : 0;
      mat.uniforms.uWindowMode.value = s.windowMode === "advanced" ? 1 : 0;
      mat.uniforms.uWinSimpleWMin.value = s.windowSimple.wMin;
      mat.uniforms.uWinSimpleWMax.value = s.windowSimple.wMax;
      mat.uniforms.uWinSimpleHMin.value = s.windowSimple.hMin;
      mat.uniforms.uWinSimpleHMax.value = s.windowSimple.hMax;
      const profiles = s.windowProfiles;
      const fwMin = mat.uniforms.uWinFracWMin.value as number[];
      const fwMax = mat.uniforms.uWinFracWMax.value as number[];
      const fhMin = mat.uniforms.uWinFracHMin.value as number[];
      const fhMax = mat.uniforms.uWinFracHMax.value as number[];
      for (let k = 0; k < ARCHETYPE_ORDER.length; k++) {
        const p = profiles[ARCHETYPE_ORDER[k]];
        fwMin[k] = p.wMin;
        fwMax[k] = p.wMax;
        fhMin[k] = p.hMin;
        fhMax[k] = p.hMax;
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
): { entries: TiledMesh[]; maxRadius: number } {
  const { buildings } = generateCity(masterSeed, shape, shapeScale);
  if (buildings.length === 0) return { entries: [], maxRadius: 1 };

  // Build-time snapshot; the recolor effect re-applies live slider changes.
  const facadeRanges = useSceneStore.getState().facade;

  let maxRadius = 1;
  let maxHeight = 1;
  for (const b of buildings) {
    const r = Math.hypot(b.x, b.z + 120); // approximate centre offset
    if (r > maxRadius) maxRadius = r;
    if (b.height > maxHeight) maxHeight = b.height;
  }

  // Population tint (Debug View): per-building people-equivalent, normalised
  // against the WHOLE city's p95 (not per-archetype mesh, and not the max — one
  // supertall would crush the ramp). Same estimator as the population field.
  const pops = buildings.map((b) => buildingPopulation(b)).sort((a, b) => a - b);
  const popP95 = pops[Math.min(pops.length - 1, Math.floor(pops.length * 0.95))] || 1;

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
  const entries: TiledMesh[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();

  for (const rawList of byArchetype.values()) {
    // #55: store instances TILE-MAJOR (each world tile's buildings contiguous)
    // so the frame loop can materialise visible tiles with plain slice copies.
    // The atlas above is packed once over ALL buildings — per-building windows
    // are untouched by the ordering; only GPU buffer layout changes.
    const partition = partitionByTile(
      rawList.length,
      (i) => rawList[i].x,
      (i) => rawList[i].z,
      (i) => rawList[i].height + 10,
    );
    const list = Array.from(partition.order, (idx) => rawList[idx]);
    const N = list.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);

    const aAtlasOffset = new Float32Array(N * 2);
    const aAtlasSize = new Float32Array(N * 2);
    const aGrid = new Float32Array(N * 3); // cols, rows, archetypeIdx
    const aFacadeColor = new Float32Array(N * 3);
    const aFacadeGlow = new Float32Array(N);
    const aBuildingHash = new Float32Array(N);
    // x=districtIdx, y=correlationMode, z=layerIdx, w=population (p95-norm 0..1)
    // — packed into one vec4 rather than a new attribute: instanceMatrix (4) +
    // built-ins (3) + the 8 customs already sit at 15 of the ~16-slot cap.
    const aMisc = new Float32Array(N * 4);
    const aDebugDistrictColor = new Float32Array(N * 3);

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

      facadeColorFor(b, color, facadeRanges);
      aFacadeColor[i * 3 + 0] = color.r;
      aFacadeColor[i * 3 + 1] = color.g;
      aFacadeColor[i * 3 + 2] = color.b;

      aFacadeGlow[i] = facadeGlowFor(b);
      aBuildingHash[i] = b.windowSeed * 1000;
      aMisc[i * 4 + 0] = DISTRICT_TO_IDX[b.district] ?? 0;
      aMisc[i * 4 + 1] = correlationModeFor(b);
      aMisc[i * 4 + 2] = LAYER_TO_IDX[b.layer] ?? 1;
      aMisc[i * 4 + 3] = Math.min(1, buildingPopulation(b) / popP95);

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
    geo.setAttribute("aMisc", new THREE.InstancedBufferAttribute(aMisc, 4));
    geo.setAttribute(
      "aDebugDistrictColor",
      new THREE.InstancedBufferAttribute(aDebugDistrictColor, 3),
    );

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // we cull per TILE (#55), finer than a whole-mesh test.

    // #55 source records: stable tile-major copies the frame loop compacts from.
    // The attribute arrays themselves are the (mutated) draw buffers.
    const facadeChannel: CompactChannel = {
      src: aFacadeColor.slice(),
      dst: geo.getAttribute("aFacadeColor") as THREE.InstancedBufferAttribute,
      itemSize: 3,
    };
    const channels: CompactChannel[] = [
      {
        src: (mesh.instanceMatrix.array as Float32Array).slice(),
        dst: mesh.instanceMatrix,
        itemSize: 16,
      },
      {
        src: aAtlasOffset.slice(),
        dst: geo.getAttribute("aAtlasOffset") as THREE.InstancedBufferAttribute,
        itemSize: 2,
      },
      {
        src: aAtlasSize.slice(),
        dst: geo.getAttribute("aAtlasSize") as THREE.InstancedBufferAttribute,
        itemSize: 2,
      },
      {
        src: aGrid.slice(),
        dst: geo.getAttribute("aGrid") as THREE.InstancedBufferAttribute,
        itemSize: 3,
      },
      facadeChannel,
      {
        src: aFacadeGlow.slice(),
        dst: geo.getAttribute("aFacadeGlow") as THREE.InstancedBufferAttribute,
        itemSize: 1,
      },
      {
        src: aBuildingHash.slice(),
        dst: geo.getAttribute("aBuildingHash") as THREE.InstancedBufferAttribute,
        itemSize: 1,
      },
      {
        src: aMisc.slice(),
        dst: geo.getAttribute("aMisc") as THREE.InstancedBufferAttribute,
        itemSize: 4,
      },
      {
        src: aDebugDistrictColor.slice(),
        dst: geo.getAttribute("aDebugDistrictColor") as THREE.InstancedBufferAttribute,
        itemSize: 3,
      },
    ];
    entries.push({ mesh, partition, channels, list, facadeChannel });
  }

  return { entries, maxRadius };
}
