"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  partitionByTile,
  visibleTiles,
  compactVisible,
  tileCropCount,
  TILE_SIZE,
  type CompactChannel,
  type TilePartition,
} from "@/lib/scene/tileCull";
import { reportTileCull } from "@/lib/scene/tileCullDebug";
import { focusBuilding } from "@/lib/scene/focusBuilding";
import {
  generateCity,
  ARCHETYPE_ORDER,
  tensorDistrictField,
  type Archetype,
  type Building,
} from "@/lib/seed/cityGen";
import {
  type CityShapeSetting,
  resolveCityShape,
  cropRadiusThreshold,
} from "@/lib/seed/cityShape";
import { CITY_CENTER, maxHalfExtent } from "@/lib/seed/topology";
import {
  correlationModeFor,
  facadeColorFor,
  facadeGlowFor,
  generateWindowTexture,
} from "@/lib/seed/lightingGen";
import { packWindowAtlas, type PackInput } from "@/lib/scene/atlasPacker";
import { meanLitStats } from "@/lib/scene/windowStats";
import { buildingPopulation } from "@/lib/seed/population";
import { kelvinToColor } from "@/lib/color/kelvin";
import { cityVertexShader, cityFragmentShader } from "@/lib/shaders/cityInstanced";
import { cityOutlineVertexShader, cityOutlineFragmentShader } from "@/lib/shaders/cityOutline";
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
  HIGHLIGHT_OUTLINE_COLOR,
  SELECT_OUTLINE_COLOR,
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

// #69 outline colour, parsed straight to 0..1 components via setRGB (no
// colorSpace argument, so no sRGB->linear conversion) — DISPLAY space, like
// facadeColorFor's setHSL calls. new THREE.Color(hex)/.set(hex) default to
// SRGBColorSpace and would darken it before it ever reaches the raw-output
// outline shader (see wiki/notes/decision-facade-display-space-color.md).
function displayColor(hex: string): THREE.Color {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Color().setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const OUTLINE_COLOR = displayColor(HIGHLIGHT_OUTLINE_COLOR);
// #87 click-to-select outline colour — same display-space parsing, kept
// visually distinct from OUTLINE_COLOR (the #69 hover cream) so a selection
// never reads as "just another hover".
const SELECT_COLOR = displayColor(SELECT_OUTLINE_COLOR);
// #86 ground-floor storefront window colour — a bright, distinct warm-white
// display-space colour (kelvinToColor, NOT new THREE.Color(hex)/SRGB convert;
// see the CLAUDE.md note on cityInstanced's raw gl_FragColor write). Module-
// level singleton: UniformsUtils.merge clones Color VALUES per material (see
// uOutlineColor/uSelectColor above), so sharing one source instance across
// all 7 archetype meshes is safe.
const STOREFRONT_COLOR = kelvinToColor(5500);

// #87 single-instance pick: "no pick" sentinel fed as uPickPosition, far
// outside any city tier's extent (max half-extent ~4000 m — see CITY_TIERS)
// so it can never coincide with a real building centre. Reused as-is for
// uSelectPosition's "nothing selected" sentinel below.
const PICK_SENTINEL = 1e8;

type TiledMesh = {
  mesh: THREE.InstancedMesh;
  // #69 hover-highlight stroke: companion InstancedMesh, SAME geometry and
  // SAME instanceMatrix object as `mesh` (assigned by reference below) so #55
  // tile compaction — which writes into mesh.instanceMatrix — updates both
  // for free. Only `count` and the material's uOutlineWidth/visible are
  // mesh-local and need their own per-frame sync (see the useFrame loop).
  outlineMesh: THREE.InstancedMesh;
  archetype: Archetype;
  partition: TilePartition;
  channels: CompactChannel[];
  // Facade recolor (live sliders): tile-major building list + the facade
  // channel whose src array is the stable copy compaction reads from.
  list: Building[];
  facadeChannel: CompactChannel;
  // #87 click-to-select: a ride-along compaction channel mapping DRAW slot ->
  // tile-major index into `list` — never geo.setAttribute'd (CPU-only, no GPU
  // binding), but #55's compactVisible copies it for free alongside the real
  // GPU channels above. entry.stableIndex.array[ev.instanceId] gives the
  // tile-major index; entry.list[idx] is the Building. See buildMeshes.
  stableIndex: THREE.InstancedBufferAttribute;
};

export function InstancedCity({ masterSeed }: { masterSeed: string }) {
  const cityShape = useSceneStore((s) => s.cityShape);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  // #70: cityShapeScale (the crop) is intentionally NOT a dependency here —
  // buildMeshes always partitions the FULL (scale=1) MAX-extent building set;
  // the live crop is folded into the per-frame tile cull below (a radius
  // prefix within each tile, same recompaction path as frustum re-entry) so a
  // crop notch never rebuilds a mesh, atlas, or window texture. See
  // wiki/notes/plan-overnight-agents-2026-07-05.md #70.
  const { entries, maxRadius, idToBuilding, districtColorById } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    void citySketch; // a registered sketch is a different city (#40) — likewise
    return buildMeshes(masterSeed, cityShape);
  }, [masterSeed, cityShape, citySize, citySketch]);
  const meshes = useMemo(() => entries.map((e) => e.mesh), [entries]);
  // #70: resolved shape ("auto" is a seeded coin flip per masterSeed) —
  // memoised so the per-frame crop-threshold read below doesn't re-run
  // seedrandom() every frame for a value that only changes on an actual
  // seed/shape-setting change.
  const resolvedShape = useMemo(
    () => resolveCityShape(cityShape, masterSeed),
    [cityShape, masterSeed],
  );
  const hidden = useSceneStore((s) => s.debug.renderModes.buildings === "hidden");
  // Inspect mode (the Info button) is the user-facing driver; the "Pick
  // Hovered" debug switch is a hover-only aid. Either one attaches the pointer
  // handlers below — raycasting the (potentially thousands of visible) building
  // instances only costs anything while one of them is on.
  const inspectMode = useSceneStore((s) => s.inspectMode);
  const pickHoverDebug = useSceneStore((s) => s.debug.hoverHighlight.pick);
  // While a building is focused, the FocusedBuildingHover owns hover; suppress
  // the general building pick so background buildings/roads don't light up
  // behind the focused one (user §5.13).
  const focusedBuildingId = useSceneStore((s) => s.focusedBuildingId);
  const pickEnabled = (inspectMode || pickHoverDebug) && focusedBuildingId === null;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);

  // #55 per-frame tile cull state — one signature per archetype mesh, reset on
  // regen so the first frame always materialises.
  const frustum = useRef(new THREE.Frustum());
  const visible = useRef<number[]>([]);
  const lastSigs = useRef<string[]>([]);

  // Uniform write cache: skip per-frame GPU uniform writes when settings-driven
  // values haven't changed. Scalar cache keyed by uniform name; object caches
  // hold the last-seen store object reference (setters always spread → new ref).
  // All refs allocated once; no per-frame allocations.
  const uCache = useRef<Record<string, number>>({});
  // windowAA / windowSimple / windowProfiles / debug: store setters always
  // produce a NEW top-level object via spread (sceneStore.ts lines 1304, 1312,
  // 1316), so a reference comparison is sufficient to detect any change.
  const lastWindowAA = useRef<object | null>(null);
  const lastWindowSimple = useRef<object | null>(null);
  const lastWindowProfiles = useRef<object | null>(null);
  const lastDebug = useRef<object | null>(null);
  // #69 hover highlight: per-mesh eased uHighlight value. Per-MESH values
  // differ (self vs rest), so this sits outside the shared scalar cache.
  const hlEase = useRef<number[]>([]);
  // #87 single-instance pick: reused scratch vector for the resolved world
  // position fed to every mesh's uPickPosition each frame (see useFrame) —
  // avoids a per-frame allocation.
  const pickScratch = useRef(new THREE.Vector3());
  // #87 click-to-select: same idea as pickScratch, for the PERSISTENT
  // selection's world position (uSelectPosition) — resolved from the stable
  // idToBuilding map rather than a draw-slot read, so it needs no per-frame
  // re-read from a (possibly recompacted) draw buffer.
  const selectScratch = useRef(new THREE.Vector3());
  // Click-vs-drag guard for building selection: record where each press starts,
  // so a click that ends far from its press (an orbit drag that begins and ends
  // over the same building) does NOT select. R3F's onClick only checks that
  // press+release hit the SAME object, not how far the pointer travelled.
  const downPos = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      downPos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);
  useEffect(() => {
    lastSigs.current = entries.map(() => "");
    // Rebuilt meshes carry creation-DEFAULT uniforms (not store values), so a
    // stale cache would skip the writes that sync them to live settings.
    // Clearing forces one full write pass on the next frame.
    uCache.current = {};
    lastWindowAA.current = null;
    lastWindowSimple.current = null;
    lastWindowProfiles.current = null;
    lastDebug.current = null;
    // Matches the rebuilt materials' creation-default uHighlight of 0; if a
    // hover is live the ease below walks them back up next frame.
    hlEase.current = entries.map(() => 0);
    // #87: a regen is a DIFFERENT city — Building ids are re-rolled, so a
    // stale selection could silently resolve to an unrelated building (or
    // none). Clear instantly, no fade (decision: regen always drops selection).
    useSceneStore.getState().setSelectedBuildingId(null);
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

  // #69 hairline floor: keep every outline material's viewport-size uniforms
  // current on mount, on resize, and after a regen (fresh materials carry
  // creation-default placeholders). Not per-frame — resize/DPR changes are
  // rare, unlike the hover/pick uniforms below.
  useEffect(() => {
    const dpr = gl.getPixelRatio();
    for (const e of entries) {
      const ou = (e.outlineMesh.material as THREE.ShaderMaterial).uniforms;
      ou.uViewportHeight.value = size.height;
      ou.uDpr.value = dpr;
    }
  }, [entries, size, gl]);

  // Dispose old GPU resources when seed changes / unmounts. Geometry is
  // disposed once here even though outlineMesh shares the same object (three
  // no-ops a repeat dispose) — only the outline's own material needs its own
  // cleanup call.
  useEffect(() => {
    return () => {
      for (const e of entries) {
        const m = e.mesh;
        m.geometry.dispose();
        const mat = m.material as THREE.ShaderMaterial;
        const tex = mat.uniforms.uWindowAtlas?.value as THREE.Texture | undefined;
        tex?.dispose();
        const farTex = mat.uniforms.uWindowAtlasFar?.value as THREE.Texture | undefined;
        farTex?.dispose();
        mat.dispose();
        (e.outlineMesh.material as THREE.ShaderMaterial).dispose();
      }
    };
  }, [entries]);

  // Per-frame: refresh the intro-related uniforms that depend on live state
  // (camera pose for far-to-near mode, orbit centre, mode int). progress/mode
  // values themselves point at sharedIntro singletons so no per-frame work.
  useFrame((state, delta) => {
    const s = useSceneStore.getState();

    // #69 hover highlight: per-mesh target — 1 self / 0.5 other / 0 idle —
    // eased linearly over ~150ms (transient UI presentation, not seed-derived
    // scene state). Writes stop once a mesh settles on its target.
    const hl = s.highlightArchetype;
    const hh = s.debug.hoverHighlight; // #69 live-tunable lift / dim / outline width; #87 .pick

    // #87 single-instance pick: resolve {pickArchetype, pickInstance} (a JS-
    // facing archetype + CURRENT draw-slot pair, set by the pointer handlers
    // below) to a world position ONCE per frame, then broadcast that SAME
    // position to every archetype's shaders — see uPickPosition's comment in
    // cityInstanced.ts for why position rather than a slot-index attribute.
    // Reading straight from the mesh's instanceMatrix array means this always
    // reflects whatever building #55 tile-cull compaction currently has in
    // that slot: if a recompaction since the last pointer move swapped a
    // DIFFERENT building in, the highlight silently follows THAT building —
    // the same "valid for the current frame" caveat the raycasted instanceId
    // already carries, not a new one.
    let hasPick = false;
    if ((s.inspectMode || hh.pick) && s.pickArchetype !== null && s.pickInstance >= 0) {
      const target = entries.find((e) => e.archetype === s.pickArchetype);
      if (target && s.pickInstance < target.mesh.count) {
        const arr = target.mesh.instanceMatrix.array as Float32Array;
        const o = s.pickInstance * 16;
        pickScratch.current.set(arr[o + 12], arr[o + 13], arr[o + 14]);
        hasPick = true;
      }
    }
    if (!hasPick) pickScratch.current.set(PICK_SENTINEL, PICK_SENTINEL, PICK_SENTINEL);

    // #87 click-select: resolve selectedBuildingId (a STABLE Building.id) to
    // a world position via the idToBuilding map built once at regen — NOT a
    // draw-slot read like the hover-pick block above. Building position is
    // immutable post-generation, so this needs no per-frame re-read from a
    // draw buffer: the selection outline survives #55 tile eviction/
    // re-admission for free, where the hover pick's pickInstance would go
    // stale (by design — that one's a transient hover cue, not a persistent
    // selection).
    let hasSelect = false;
    let selectedBuilding: Building | undefined;
    if (s.selectedBuildingId !== null) {
      selectedBuilding = idToBuilding.get(s.selectedBuildingId);
      if (selectedBuilding) {
        selectScratch.current.set(
          selectedBuilding.x,
          selectedBuilding.height / 2,
          selectedBuilding.z,
        );
        hasSelect = true;
      }
    }
    if (!hasSelect) selectScratch.current.set(PICK_SENTINEL, PICK_SENTINEL, PICK_SENTINEL);
    // #87: tint the SELECT outline to the building's district colour (matches the
    // roof pin + wireframe + info panel). Display-space, for the raw-output shader.
    const selColor =
      hasSelect && selectedBuilding
        ? (districtColorById.get(selectedBuilding.districtId) ?? SELECT_COLOR)
        : SELECT_COLOR;

    // #70: live crop threshold — a building must sit within this distance of
    // the city centre to stay visible. Infinity when the resolved shape is
    // "square" (never crops, see cropRadiusThreshold) or the slider sits at 1
    // (no active crop) — both the "everything passes" fast path tileCropCount
    // takes below. Recomputed every frame (cheap: maxHalfExtent() is a plain
    // variable read) but only forces a recompaction when it actually differs
    // from last frame's value, via the signature strings below — same
    // "cheap test every frame, rare copy" shape as the frustum cull.
    const cropThreshold = cropRadiusThreshold(resolvedShape, s.cityShapeScale, maxHalfExtent());
    // #55 per-tile culling: lower each archetype mesh's instance count to the
    // frustum-visible tiles. Instance copies fire only when a mesh's visible
    // tile set changes; a still camera costs only the AABB tests.
    let tilesVis = 0;
    let tilesTot = 0;
    let drawn = 0;
    for (let e = 0; e < entries.length; e++) {
      const { mesh, outlineMesh, partition, channels, archetype } = entries[e];
      const hlTarget = hl === null ? 0 : archetype === hl ? 1 : 0.5;
      const hlCur = hlEase.current[e] ?? 0;
      if (hlCur !== hlTarget) {
        const step = delta / 0.15;
        const next =
          hlCur < hlTarget ? Math.min(hlTarget, hlCur + step) : Math.max(hlTarget, hlCur - step);
        hlEase.current[e] = next;
        (mesh.material as THREE.ShaderMaterial).uniforms.uHighlight.value = next;
      }
      // #69 hover-highlight strength (global, live-tunable): the matched lift +
      // non-matched dim that the shader's highlightMul reads. Cheap scalars —
      // only bite when uHighlight > 0, i.e. while an archetype is hovered.
      const cu = (mesh.material as THREE.ShaderMaterial).uniforms;
      cu.uHiLift.value = hh.lift;
      cu.uHiDim.value = hh.dim;
      // #87: broadcast the SAME resolved pick position to every archetype's
      // city material — only the mesh actually containing that instance (if
      // any) will light up, via cityInstanced's highlightMul().
      cu.uPickPosition.value.copy(pickScratch.current);
      // #87 click-select: same broadcast-to-every-mesh treatment as the pick
      // position above.
      cu.uSelectPosition.value.copy(selectScratch.current);
      // #69 outline shell: draw only THIS archetype's mesh while it's the
      // hovered one (skips 6 idle draw calls) and grow the border in from the
      // SAME eased value the facade lift uses, so the two read as one motion.
      // No fade-out on un-hover (visible flips off immediately) — the facade
      // dim/lift still eases, only the stroke pops; acceptable for a transient
      // hover cue, revisit if it reads as a glitch in practice.
      const isSelf = archetype === hl;
      // #87: this mesh ALSO needs to draw (whole mesh stays hidden, just the
      // one picked instance shows) when the pick lives in this archetype,
      // independent of the archetype-icon hover above.
      const isPickMesh = hasPick && archetype === s.pickArchetype;
      // #87 click-select: same idea, for whichever mesh holds the SELECTED
      // building — reuses the selectedBuilding this frame's select-position
      // block above already resolved.
      const isSelectMesh = hasSelect && archetype === selectedBuilding?.archetype;
      const ou = (outlineMesh.material as THREE.ShaderMaterial).uniforms;
      outlineMesh.visible = isSelf || isPickMesh || isSelectMesh;
      ou.uPickPosition.value.copy(pickScratch.current);
      ou.uSelectPosition.value.copy(selectScratch.current);
      if (isSelf) {
        // Whole-mesh archetype hover wins if both are somehow live at once —
        // it already outlines every instance, including any picked/selected one.
        ou.uOutlineWidth.value = hh.outline * hlEase.current[e];
        ou.uOutlineWhole.value = 1;
      } else if (isPickMesh || isSelectMesh) {
        // Pick/select are both instantaneous (no ease) — cityOutline picks
        // the outline COLOUR per-instance (uSelectColor wins ties), so a
        // hover-pick and a selection can coexist on the same mesh here.
        ou.uOutlineWidth.value = hh.outline;
        ou.uOutlineWhole.value = 0;
        if (isSelectMesh) ou.uSelectColor.value.copy(selColor); // district-tinted selection
      }
      tilesTot += partition.tiles.length;
      if (s.lod.tiles && partition.tiles.length > 1) {
        const frustumSig = visibleTiles(partition, state.camera, frustum.current, visible.current);
        // #70: fold the crop into the SAME signature the frustum cull already
        // uses — a crop-only change (frustum-visible tile SET unchanged) still
        // triggers exactly one recompaction, same path as frustum re-entry.
        const sig = `${frustumSig}|${cropThreshold}`;
        if (sig !== lastSigs.current[e]) {
          lastSigs.current[e] = sig;
          // Per-tile radius prefix (#70): most visible tiles are either fully
          // inside the crop (count === tile.count, a no-op clamp) or fully
          // outside it (count === 0); only boundary tiles actually shrink.
          const counts = visible.current.map((t) =>
            tileCropCount(partition, partition.tiles[t], cropThreshold),
          );
          mesh.count = compactVisible(partition, visible.current, channels, counts);
        }
        tilesVis += visible.current.length;
      } else {
        // Tile-culling disabled (debug) or a single-tile city: still respect
        // the live crop (#70) — it is a user-facing feature, not a debug aid.
        const sig = `ALL|${cropThreshold}`;
        if (lastSigs.current[e] !== sig) {
          lastSigs.current[e] = sig;
          const counts = partition.tiles.map((t) => tileCropCount(partition, t, cropThreshold));
          mesh.count = compactVisible(partition, null, channels, counts);
        }
        tilesVis += partition.tiles.length;
      }
      // #55 tile compaction shares mesh.instanceMatrix with outlineMesh (same
      // object, written above via compactVisible), but `count` is a per-mesh
      // property — sync it every frame so the shell's draw call matches the
      // main mesh's visible instance set exactly.
      outlineMesh.count = mesh.count;
      drawn += mesh.count;
    }
    // #55 debug readout (Debug View → Tile culling) — cheap counter writes.
    const total = entries.reduce((n, e) => n + e.partition.total, 0);
    reportTileCull("buildings", tilesVis, tilesTot, hidden ? 0 : drawn, total, s.lod.tiles);
    // --- Settings-driven uniforms: compute gated values once, then write to
    // all 7 archetype materials only when a value has changed. All meshes receive
    // identical values, so a single shared cache suffices (no per-mesh cache needed).
    const uc = uCache.current;

    // windowAA: spread-setter → new object reference on any change (line 1304).
    const wa = s.windowAA;
    const waChanged = wa !== lastWindowAA.current;
    if (waChanged) lastWindowAA.current = wa;

    // windowSimple: spread-setter → new object reference on any change (line 1312).
    const ws = s.windowSimple;
    const wsChanged = ws !== lastWindowSimple.current;
    if (wsChanged) lastWindowSimple.current = ws;

    // windowProfiles: spread-setter → new top-level object on any change (line 1316).
    const profiles = s.windowProfiles;
    const profChanged = profiles !== lastWindowProfiles.current;
    if (profChanged) lastWindowProfiles.current = profiles;

    // debug: spread-setter → new object on any change (standard Zustand pattern).
    const dbg = s.debug;
    const dbgChanged = dbg !== lastDebug.current;
    if (dbgChanged) lastDebug.current = dbg;

    // Derived scalars from settings objects (computed once per frame, written only on change).
    const aaEdge = wa.edge;
    const lodNear = wa.lodEnabled ? wa.lodNear : 1e9;
    const lodRange = wa.lodRange;
    const stagger = wa.stagger;
    const curtainShare = wa.curtain;
    const curtainWidth = wa.curtainW;
    const storefrontShare = wa.storefront;
    const storefrontHeightMult = wa.storefrontHeight;
    const lightsOn = s.windowLights ? 1 : 0;
    const windowMode = s.windowMode === "advanced" ? 1 : 0;
    const renderMode = s.windowRenderMode === "hybrid" ? 1 : 0;
    const tint = dbg.buildingTint;
    const debugMode = tint.enabled ? (TINT_MODE_IDX[tint.mode] ?? 0) : 0;
    const debugTint = tint.enabled ? tint.intensity : 0;
    const wire = dbg.renderModes.buildings === "wireframe";
    const wireframe = wire ? 1 : 0;
    const orthoBlend = s.projectionBlend;
    const orthoChanged = orthoBlend !== uc.orthoBlend;
    const lightsChanged = lightsOn !== uc.lightsOn;
    const modeChanged = windowMode !== uc.windowMode;
    const renderModeChanged = renderMode !== uc.renderMode;

    for (const m of meshes) {
      const mat = m.material as THREE.ShaderMaterial;

      // Always write: camera position changes every frame during any camera motion.
      // City centre is the WORLD constant, not the orbit target — writeOrbitPose
      // tracks orbit.center* to the live camera aim, which made the radial intro
      // modes (outside-in / inside-out) follow the camera (user 2026-07-03).
      mat.uniforms.uIntroCityCenter.value.set(CITY_CENTER.x, 0, CITY_CENTER.z);
      mat.uniforms.uIntroMaxRadius.value = maxRadius;
      const camPos = s.cameraLive.position;
      mat.uniforms.uIntroCamPos.value.set(camPos[0], camPos[1], camPos[2]);

      // Gated scalars: skip GPU uniform write when value is unchanged. The
      // *Changed flags are computed BEFORE the mesh loop and the caches update
      // AFTER it — updating a cache mid-loop would starve meshes 2..7.
      if (orthoChanged) mat.uniforms.uOrthoBlend.value = orthoBlend;
      if (waChanged) {
        // LOD off → push the distance-wash threshold to infinity so `lod` stays 0
        // everywhere (full per-cell window detail to the horizon).
        mat.uniforms.uAaEdge.value = aaEdge;
        mat.uniforms.uLodNear.value = lodNear;
        mat.uniforms.uLodRange.value = lodRange;
        mat.uniforms.uStagger.value = stagger;
        mat.uniforms.uCurtainShare.value = curtainShare;
        mat.uniforms.uCurtainWidth.value = curtainWidth;
        mat.uniforms.uStorefrontShare.value = storefrontShare;
        mat.uniforms.uStorefrontHeightMult.value = storefrontHeightMult;
      }
      if (lightsChanged) mat.uniforms.uLightsOn.value = lightsOn;
      if (modeChanged) mat.uniforms.uWindowMode.value = windowMode;
      if (renderModeChanged) mat.uniforms.uRenderMode.value = renderMode;
      if (wsChanged) {
        mat.uniforms.uWinSimpleWMin.value = ws.wMin;
        mat.uniforms.uWinSimpleWMax.value = ws.wMax;
        mat.uniforms.uWinSimpleHMin.value = ws.hMin;
        mat.uniforms.uWinSimpleHMax.value = ws.hMax;
      }
      if (profChanged) {
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
      }
      // Debug view (Slice A tint + Slice B wireframe) — uniform / flag only.
      // enabled gates the wash (the retired "off" mode, 2026-06-08); a disabled
      // tint forces mode 0 so the shader takes its plain branch.
      if (dbgChanged) {
        mat.uniforms.uDebugMode.value = debugMode;
        mat.uniforms.uDebugTint.value = debugTint;
        mat.wireframe = wire;
        mat.uniforms.uWireframe.value = wireframe;
        mat.uniforms.uWinDebugView.value =
          dbg.windowView === "field" ? 2 : dbg.windowView === "atlas" ? 1 : 0;
      }
    }
    uc.orthoBlend = orthoBlend;
    uc.lightsOn = lightsOn;
    uc.windowMode = windowMode;
    uc.renderMode = renderMode;
  });

  return (
    <group
      visible={!hidden}
      // #87 empty-space click clears the selection. onPointerMissed fires
      // only on a true miss (nothing hit anywhere, gated by R3F itself on
      // <=2px of pointer movement since pointerdown) — a camera-orbit drag
      // that happens to end over open sky/ground does not trip this.
      onPointerMissed={() => useSceneStore.getState().setSelectedBuildingId(null)}
    >
      {entries.map((e, i) => (
        <primitive
          key={i}
          object={e.mesh}
          // #87 click-to-select: UNCONDITIONAL (unlike the hover handlers
          // below, which stay opt-in debug aids) — this is the real feature,
          // gated inside the handler to inspect mode + a near-stationary
          // press+release. R3F's onClick fires on same-object press+release
          // regardless of travel, so the drag guard below is what rejects orbits.
          onClick={(ev: ThreeEvent<MouseEvent>) => {
            // Only select in inspect mode. Guard BEFORE stopPropagation so a
            // proud unit box (FocusedBuildingHover) that's the nearer hit fires
            // its own onClick instead, and a click never reaches a building
            // behind the front-most hit — topmost-only selection (user request).
            if (!inspectMode || hidden || ev.instanceId == null) return;
            ev.stopPropagation();
            // Reject drags: R3F's onClick only checks that press+release hit the
            // SAME object, not how far the pointer travelled — so an orbit drag
            // that begins and ends over one building would select it. Require a
            // near-stationary press+release (a real click) instead.
            const d = downPos.current;
            if (d) {
              const dx = ev.nativeEvent.clientX - d.x;
              const dy = ev.nativeEvent.clientY - d.y;
              if (dx * dx + dy * dy > 36) return; // > ~6 px of travel = a drag
            }
            // ev.instanceId is the volatile DRAW slot #55 compaction just
            // rewrote; stableIndex (the ride-along compaction channel, never
            // GPU-bound) maps it back to the tile-major index into e.list —
            // the STABLE identity that survives the next recompaction.
            const stableIdx = Math.round(e.stableIndex.array[ev.instanceId]);
            const b = e.list[stableIdx];
            if (!b) return; // defensive: a bad slot -> index should never happen, but never crash on a click
            useSceneStore.getState().setSelectedBuildingId(b.id);
          }}
          // #87 focus: double-click a building (inspect mode) to select AND
          // glide the camera to orbit its ground centre. A double-click already
          // implies two co-located clicks, so no extra drag guard is needed.
          onDoubleClick={(ev: ThreeEvent<MouseEvent>) => {
            ev.stopPropagation();
            if (!inspectMode || hidden || ev.instanceId == null) return;
            const b = e.list[Math.round(e.stableIndex.array[ev.instanceId])];
            if (!b) return;
            useSceneStore.getState().setSelectedBuildingId(b.id);
            focusBuilding(b);
          }}
          // #87 "Pick Hovered": handlers are only ATTACHED while the switch is
          // on, so raycasting the visible-tile-compacted instances (up to
          // thousands across 7 meshes) costs nothing while the feature is off
          // (the common case). onPointerMove stopPropagation()s so only the
          // FRONT-MOST building (nearest hit across all 7 archetype meshes)
          // claims the pick; R3F still fires onPointerOut on whichever mesh
          // was PREVIOUSLY hovered before the new hit's handler runs, so
          // switching between two overlapping buildings can't leave both (or
          // neither) lit.
          onPointerMove={
            pickEnabled
              ? (ev: ThreeEvent<PointerEvent>) => {
                  ev.stopPropagation();
                  useSceneStore
                    .getState()
                    .setPickHover(ev.instanceId != null ? e.archetype : null, ev.instanceId ?? -1);
                }
              : undefined
          }
          onPointerOut={
            pickEnabled ? () => useSceneStore.getState().setPickHover(null, -1) : undefined
          }
        />
      ))}
      {entries.map((e, i) => (
        <primitive key={`outline-${i}`} object={e.outlineMesh} />
      ))}
    </group>
  );
}

function buildMeshes(
  masterSeed: string,
  shape: CityShapeSetting,
): {
  entries: TiledMesh[];
  maxRadius: number;
  idToBuilding: Map<number, Building>;
  districtColorById: Map<string, THREE.Color>;
} {
  // #70: always the FULL (scale=1) MAX-extent set for this shape/tier — the
  // live crop is a render-only cull (see the useFrame loop above), never a
  // regen input. This is a superset for every scale <= 1: cropRadiusThreshold
  // only shrinks as scale drops, so scale=1's buildings are exactly the union
  // of everything any crop notch could ever reveal.
  const { buildings } = generateCity(masterSeed, shape, 1);
  // #87: every building by id, for the click-select useFrame block to resolve
  // a world position + archetype from a bare selectedBuildingId. Built once
  // over the FULL list (before the per-archetype grouping below) since ids
  // are unique city-wide, not per-archetype.
  const idToBuilding = new Map(buildings.map((b) => [b.id, b]));
  if (buildings.length === 0)
    return { entries: [], maxRadius: 1, idToBuilding, districtColorById: new Map() };

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
  // #87: display-space THREE.Colors of the same palette, for the select outline's
  // uSelectColor (the raw-output outline shader needs display space — see displayColor).
  const districtColorById = new Map<string, THREE.Color>();
  for (const d of tensorDistrictField(masterSeed).districts) {
    parcelColor.set(d.id, d.color);
    districtColorById.set(d.id, displayColor(d.color));
  }

  // 1. Generate per-building window pixels. While the data is in hand, fold
  // each building's cells into the hybrid far-field statistics (#82) — see
  // lib/scene/windowStats for the weighting.
  const meanLitById = new Map<number, [number, number, number, number]>();
  const windowItems: PackInput[] = buildings.map((b) => {
    const tex = generateWindowTexture(masterSeed, b);
    const data = tex.texture.image.data as Uint8Array;
    meanLitById.set(b.id, meanLitStats(data, tex.cols * tex.rows));
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
  // 2b. Trilinear-mipped twin for the hybrid far field (lab approach-4's far
  // construction): minification returns the box-filtered average of exactly
  // the cells a pixel covers — the real lit pattern, softening with distance,
  // stable under motion. Same buffer, its own GPU copy + mip chain (+33%).
  const atlasFarTex = new THREE.DataTexture(pack.atlas, pack.width, pack.height, THREE.RGBAFormat);
  atlasFarTex.generateMipmaps = true;
  atlasFarTex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasFarTex.magFilter = THREE.LinearFilter;
  atlasFarTex.wrapS = THREE.ClampToEdgeWrapping;
  atlasFarTex.wrapT = THREE.ClampToEdgeWrapping;
  atlasFarTex.colorSpace = THREE.SRGBColorSpace;
  atlasFarTex.needsUpdate = true;

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

  for (const [archetype, rawList] of byArchetype) {
    // #55: store instances TILE-MAJOR (each world tile's buildings contiguous)
    // so the frame loop can materialise visible tiles with plain slice copies.
    // The atlas above is packed once over ALL buildings — per-building windows
    // are untouched by the ordering; only GPU buffer layout changes.
    const partition = partitionByTile(
      rawList.length,
      (i) => rawList[i].x,
      (i) => rawList[i].z,
      (i) => rawList[i].height + 10,
      TILE_SIZE,
      80,
      // #70: sort each tile's buildings ascending by distance from the city
      // centre so the live crop can prefix-cull a tile (tileCropCount)
      // instead of testing every building's membership every frame.
      (i) => Math.hypot(rawList[i].x - CITY_CENTER.x, rawList[i].z - CITY_CENTER.z),
    );
    const list = Array.from(partition.order, (idx) => rawList[idx]);
    const N = list.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);

    // #87 click-to-select: identity ride-along channel — tile-major position
    // IS the stable index into `list` (list is already in partition.order /
    // tile-major order, from the line above). aStableIndex is the untouched
    // SOURCE #55 compaction reads from; `stableIndex` is its CPU-only
    // destination buffer — never geo.setAttribute'd, so it rides along
    // compaction for free without costing a real GPU attribute slot (the city
    // material already sits at the GL_MAX_VERTEX_ATTRIBS floor — see aMeanLit
    // below). Seeded with the SAME identity values so the initial draw order
    // (already tile-major, matching mesh.setMatrixAt below) resolves
    // correctly even before the first useFrame tick runs compactVisible.
    const aStableIndex = new Float32Array(N);
    for (let i = 0; i < N; i++) aStableIndex[i] = i;
    const stableIndex = new THREE.InstancedBufferAttribute(aStableIndex.slice(), 1);

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
    // Hybrid far field (#82): xyz = mean lit colour, w = expected on-fraction.
    // 16th and FINAL attribute slot (GL_MAX_VERTEX_ATTRIBS floor is 16).
    const aMeanLit = new Float32Array(N * 4);

    const material = new THREE.ShaderMaterial({
      vertexShader: cityVertexShader,
      fragmentShader: cityFragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uWindowAtlas: { value: null },
          uWindowAtlasFar: { value: null },
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
          uStorefrontShare: { value: DEFAULT_WINDOW_AA.storefront },
          uStorefrontHeightMult: { value: DEFAULT_WINDOW_AA.storefrontHeight },
          uStorefrontColor: { value: STOREFRONT_COLOR },
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
          uRenderMode: { value: 1 },
          uWinDebugView: { value: 0 },
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
          uHighlight: { value: 0 },
          uHiLift: { value: 1.8 }, // #69 idle default; overwritten per-frame from debug.hoverHighlight
          uHiDim: { value: 0.7 },
          // #87 single-instance pick: world-space centre of the picked building,
          // or PICK_SENTINEL when nothing is picked. Fed per-frame (see useFrame).
          uPickPosition: { value: new THREE.Vector3(PICK_SENTINEL, PICK_SENTINEL, PICK_SENTINEL) },
          // #87 click-to-select: world-space centre of the SELECTED building,
          // or PICK_SENTINEL when nothing is selected. Fed per-frame (see useFrame).
          uSelectPosition: { value: new THREE.Vector3(PICK_SENTINEL, PICK_SENTINEL, PICK_SENTINEL) },
        },
      ]),
      fog: true,
    });
    // UniformsUtils.merge breaks the texture / shared singletons + clones the
    // debug palette arrays; restore all by reference.
    material.uniforms.uWindowAtlas.value = atlasTex;
    material.uniforms.uWindowAtlasFar.value = atlasFarTex;
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

    // #69 hover-highlight outline shell: same geometry (unit box — the vertex
    // shader offsets by a per-axis WORLD-space constant, see cityOutline.ts),
    // BackSide inverted-hull so only the silhouette fringe shows past the real
    // facade. instanceMatrix is reassigned to the MAIN mesh's own attribute
    // object right below (not copied) so #55 tile compaction — which writes
    // into mesh.instanceMatrix — updates this mesh for free; `count` stays
    // per-mesh and is synced every frame in the useFrame loop.
    const outlineMaterial = new THREE.ShaderMaterial({
      vertexShader: cityOutlineVertexShader,
      fragmentShader: cityOutlineFragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uOutlineWidth: { value: 0 },
          uOutlineColor: { value: OUTLINE_COLOR },
          // #87 single-instance pick — see the matching uPickPosition comment
          // on the city material above.
          uPickPosition: { value: new THREE.Vector3(PICK_SENTINEL, PICK_SENTINEL, PICK_SENTINEL) },
          // #87 click-to-select — see the matching uSelectPosition comment on
          // the city material above; uSelectColor is the distinct cool-blue
          // stroke colour (vs uOutlineColor's #69 hover cream).
          uSelectPosition: { value: new THREE.Vector3(PICK_SENTINEL, PICK_SENTINEL, PICK_SENTINEL) },
          uSelectColor: { value: SELECT_COLOR },
          uOutlineWhole: { value: 0 }, // #87: 1 = whole-mesh (archetype hover), 0 = pick-only
          // #69 hairline floor — uHairlinePx is a fixed constant (device px);
          // uViewportHeight/uDpr are placeholders synced from useThree below
          // (on mount and on resize) so they're never stale.
          uHairlinePx: { value: 1.5 },
          uViewportHeight: { value: 1000 },
          uDpr: { value: 1 },
        },
      ]),
      side: THREE.BackSide,
      fog: true,
    });
    const outlineMesh = new THREE.InstancedMesh(geo, outlineMaterial, N);
    outlineMesh.instanceMatrix = mesh.instanceMatrix;
    outlineMesh.frustumCulled = false;
    outlineMesh.visible = false;
    // #87 per-instance highlight ("Pick Hovered", Buildings > Debug Highlight
    // > Hover Highlight): reuses this exact outline shell. The archetype-level
    // `visible` gate above widens to "isSelf OR this mesh holds the pick";
    // which SINGLE instance gets the border is decided in cityOutline's vertex
    // shader by comparing each instance's world centre against uPickPosition
    // (see the frame loop below) rather than a new instance attribute — the
    // city material already sits at the GL_MAX_VERTEX_ATTRIBS floor of 16
    // (aMeanLit below is the 16th and final slot), so there was no free slot
    // for an identity channel. The shared-instanceMatrix wiring above needs no
    // change — it already tracks whatever subset #55 compaction has
    // materialised.

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
      const ml = meanLitById.get(b.id);
      if (ml) {
        aMeanLit[i * 4 + 0] = ml[0];
        aMeanLit[i * 4 + 1] = ml[1];
        aMeanLit[i * 4 + 2] = ml[2];
        aMeanLit[i * 4 + 3] = ml[3];
      }
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
    geo.setAttribute("aMeanLit", new THREE.InstancedBufferAttribute(aMeanLit, 4));

    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // we cull per TILE (#55), finer than a whole-mesh test.
    // Pin the raycast bounding sphere NOW, over the full instance set (count === N
    // here, before the frame loop shrinks it). InstancedMesh.raycast early-outs on
    // a cached boundingSphere it computes lazily over the CURRENT `count`; with #55
    // per-frame compaction that first-computed sphere would cover only whatever was
    // visible at the first pointer-move and then go stale — silently dropping picks
    // for buildings outside it. Buildings never move, so a full-set sphere always
    // encloses any visible subset and keeps every drawn building hoverable.
    mesh.computeBoundingSphere();

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
      {
        src: aMeanLit.slice(),
        dst: geo.getAttribute("aMeanLit") as THREE.InstancedBufferAttribute,
        itemSize: 4,
      },
      // #87: CPU-only — compactVisible's dst.needsUpdate = true is a no-op
      // here since this attribute is never bound to the geometry/GPU.
      { src: aStableIndex, dst: stableIndex, itemSize: 1 },
    ];
    entries.push({
      mesh,
      outlineMesh,
      archetype,
      partition,
      channels,
      list,
      facadeChannel,
      stableIndex,
    });
  }

  return { entries, maxRadius, idToBuilding, districtColorById };
}
