"use client";

import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { generateStreetlights } from "@/lib/seed/cityGen";
import { kelvinToColor } from "@/lib/color/kelvin";
import { SCENE_WB_GAIN } from "@/lib/color/whiteBalance";
import { sharedStreetlightIntroProgress } from "@/lib/shaders/sharedIntro";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { useSceneStore } from "@/lib/state/sceneStore";
import {
  partitionByTile,
  reorderToTiles,
  visibleTiles,
  compactVisible,
  type CompactChannel,
} from "@/lib/scene/tileCull";
import { reportTileCull } from "@/lib/scene/tileCullDebug";

function applyWb(c: THREE.Color): THREE.Color {
  return new THREE.Color(
    Math.min(1, c.r * SCENE_WB_GAIN.x),
    Math.min(1, c.g * SCENE_WB_GAIN.y),
    Math.min(1, c.b * SCENE_WB_GAIN.z),
  );
}

const vertexShader = /* glsl */ `
uniform float uPixelRatio;
uniform float uBaseSize;
uniform float uIntroProgress;
uniform vec3 uIntroCityCenter;
uniform float uIntroMaxRadius;
uniform float uLodEnabled;
uniform float uLodNear;
uniform float uLodFar;
uniform float uLodCull;
uniform float uLodSizeFloor;
uniform float uLodBrightFloor;
attribute vec3 aColor;
attribute float aFailing;
attribute float aSeed;
varying float vDist;
varying vec3 vColor;
varying float vWake;
varying float vFailing;
varying float vSeed;
varying float vLodBright;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  vColor = aColor;
  vFailing = aFailing;
  vSeed = aSeed;

  // Center-out wake: closer to city centre = lights first.
  vec2 d = position.xz - uIntroCityCenter.xz;
  float r = clamp(length(d) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
  float threshold = r * 0.7;
  vWake = smoothstep(threshold, threshold + 0.08, uIntroProgress);

  gl_Position = projectionMatrix * mv;

  // Distance LOD (#52). Attenuate by CAMERA distance in world space (not view-z)
  // so it's projection-agnostic — correct under the default orthographic camera,
  // where a perspective size falloff would be wrong. Far lights shrink + dim to
  // the floors; past uLodCull the point is dropped (size 0 → never rasterised),
  // cutting the additive overdraw that dominates cost at Metro scale.
  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  float camDist = distance(worldPos, cameraPosition);
  float lodT = uLodEnabled > 0.5 ? smoothstep(uLodNear, uLodFar, camDist) : 0.0;
  float sizeAtten = mix(1.0, uLodSizeFloor, lodT);
  vLodBright = mix(1.0, uLodBrightFloor, lodT);
  float keep = (uLodEnabled > 0.5 && camDist > uLodCull) ? 0.0 : 1.0;

  // Fixed apparent base size (the old 180/vDist term collapsed every light to the
  // floor at city distances, making them vanish under ortho); LOD scales it.
  gl_PointSize = keep * clamp(uBaseSize * uPixelRatio * sizeAtten, 2.0, 10.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uBrightness;
varying float vDist;
varying vec3 vColor;
varying float vWake;
varying float vFailing;
varying float vSeed;
varying float vLodBright;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);

  // Failing lamps flicker at ~3 Hz — the same step-and-hash pattern the window
  // TV cells use, so a dying streetlight reads like the rest of the scene.
  float bright = 1.0;
  if (vFailing > 0.5) {
    float tick = floor(uTime * 3.0);
    float n = hash11(tick + vSeed * 100.0);
    bright = 0.18 + n * 0.82;
  }

  float intensity = pow(core, 1.4) * 1.8 * uBrightness * vWake * bright * vLodBright;
  gl_FragColor = vec4(vColor * intensity, core * vWake * bright * vLodBright);
}
`;

export function Streetlights({ masterSeed }: { masterSeed: string }) {
  const enabled = useSceneStore((s) => s.streetlights.enabled);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const { geometry, material, maxRadius, partition, channels } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const lights = generateStreetlights(masterSeed, cityShape, cityShapeScale);
    const positions = new Float32Array(lights.length * 3);
    const colors = new Float32Array(lights.length * 3);
    const failing = new Float32Array(lights.length);
    const seeds = new Float32Array(lights.length);
    let maxR = 1;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      positions[i * 3 + 0] = l.x;
      positions[i * 3 + 1] = l.y;
      positions[i * 3 + 2] = l.z;
      const r = Math.hypot(l.x, l.z + 120);
      if (r > maxR) maxR = r;
      const c = applyWb(kelvinToColor(l.kelvin));
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      failing[i] = l.isFailing ? 1 : 0;
      seeds[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    }

    // #55 tile partition: source records tile-major; the draw buffers start as
    // a full copy (everything materialised) and the frame loop compacts them to
    // the visible tiles. aSeed stays keyed to the original index via reorder, so
    // per-lamp flicker identity is independent of tile layout.
    const part = partitionByTile(
      lights.length,
      (i) => lights[i].x,
      (i) => lights[i].z,
      (i) => lights[i].y,
    );
    const srcPositions = reorderToTiles(part, positions, 3);
    const srcColors = reorderToTiles(part, colors, 3);
    const srcFailing = reorderToTiles(part, failing, 1);
    const srcSeeds = reorderToTiles(part, seeds, 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(srcPositions.slice(), 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(srcColors.slice(), 3));
    geo.setAttribute("aFailing", new THREE.BufferAttribute(srcFailing.slice(), 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(srcSeeds.slice(), 1));
    const chans: CompactChannel[] = [
      {
        src: srcPositions,
        dst: geo.getAttribute("position") as THREE.BufferAttribute,
        itemSize: 3,
      },
      { src: srcColors, dst: geo.getAttribute("aColor") as THREE.BufferAttribute, itemSize: 3 },
      { src: srcFailing, dst: geo.getAttribute("aFailing") as THREE.BufferAttribute, itemSize: 1 },
      { src: srcSeeds, dst: geo.getAttribute("aSeed") as THREE.BufferAttribute, itemSize: 1 },
    ];

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uBaseSize: { value: 6 },
        uBrightness: { value: 1 },
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
        uIntroProgress: sharedStreetlightIntroProgress,
        uIntroCityCenter: { value: new THREE.Vector3() },
        uIntroMaxRadius: { value: maxR },
        uTime: sharedTime,
        uLodEnabled: { value: 1 },
        uLodNear: { value: 3200 },
        uLodFar: { value: 7500 },
        uLodCull: { value: 16000 },
        uLodSizeFloor: { value: 0.5 },
        uLodBrightFloor: { value: 0.4 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    return { geometry: geo, material: mat, maxRadius: maxR, partition: part, channels: chans };
  }, [masterSeed, cityShape, cityShapeScale, citySize]);

  // #55 per-frame tile cull state. Signature resets when the geometry swaps so
  // the first frame after a regen always materialises.
  const frustum = useRef(new THREE.Frustum());
  const visible = useRef<number[]>([]);
  const lastSig = useRef("");
  useEffect(() => {
    lastSig.current = "";
  }, [geometry]);

  useFrame((state) => {
    const s = useSceneStore.getState();
    material.uniforms.uIntroCityCenter.value.set(s.orbit.centerX, 0, s.orbit.centerZ);
    material.uniforms.uIntroMaxRadius.value = maxRadius;
    // size + brightness are live multipliers (no regen) — base sprite is 6px.
    material.uniforms.uBaseSize.value = 6 * s.streetlights.size;
    material.uniforms.uBrightness.value = s.streetlights.brightness;
    // Distance LOD (#52) — live, render-only.
    const lod = s.lod;
    material.uniforms.uLodEnabled.value = lod.enabled ? 1 : 0;
    material.uniforms.uLodNear.value = lod.near;
    material.uniforms.uLodFar.value = lod.far;
    material.uniforms.uLodCull.value = lod.cull;
    material.uniforms.uLodSizeFloor.value = lod.sizeFloor;
    material.uniforms.uLodBrightFloor.value = lod.brightnessFloor;

    // #55 per-tile culling: materialise only frustum-visible tiles. Copies fire
    // only when the visible tile SET changes (camera crossing tile boundaries);
    // a still camera costs ~tile-count AABB tests and nothing else.
    const culling = lod.tiles && partition.tiles.length > 1;
    if (culling) {
      const sig = visibleTiles(partition, state.camera, frustum.current, visible.current);
      if (sig !== lastSig.current) {
        lastSig.current = sig;
        geometry.setDrawRange(0, compactVisible(partition, visible.current, channels));
      }
    } else if (lastSig.current !== "ALL") {
      lastSig.current = "ALL";
      geometry.setDrawRange(0, compactVisible(partition, null, channels));
    }
    // #55 debug readout (Debug View → Tile culling) — cheap counter writes.
    const drawnCount = Math.min(geometry.drawRange.count, partition.total);
    reportTileCull(
      "streetlights",
      culling ? visible.current.length : partition.tiles.length,
      partition.tiles.length,
      s.streetlights.enabled ? drawnCount : 0,
      partition.total,
      lod.tiles,
    );
  });

  if (!enabled) return null;
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
