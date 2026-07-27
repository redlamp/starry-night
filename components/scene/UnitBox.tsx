"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { storefrontGroundFrac, floorFrac } from "@/lib/scene/storefront";
import type { Building } from "@/lib/seed/cityGen";
import type { TenantRegion } from "@/lib/seed/tenancyLayout";

// A brighter tone of a base colour (lerp toward white) — the unit highlight is a
// brighter tone of the building's selection/district colour (user 2026-07-12).
export function brighten(hex: string, t = 0.45): string {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r += (255 - r) * t;
  g += (255 - g) * t;
  b += (255 - b) * t;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Unit edge outline shader (user 2026-07-27): every box edge carries its two
// adjacent FACE NORMALS; an edge draws only when at least one face fronts the
// camera — hidden-line removal (back-facing edges culled) — and dashes in
// world metres. Selected units render solid with every edge; unselected render
// dashed, front edges only. The view direction is the perspective one (faked
// ortho shares the camera transform), so ortho's silhouette set is a close
// approximation — cosmetic only.
const EDGE_VERTEX = /* glsl */ `
attribute vec3 aN1;
attribute vec3 aN2;
attribute float aT; // cumulative WORLD metres along the edge (for dashing)
varying float vVis;
varying float vT;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 vdir = normalize(-mv.xyz);
  float f1 = dot(normalize(normalMatrix * aN1), vdir);
  float f2 = dot(normalize(normalMatrix * aN2), vdir);
  vVis = max(step(0.0, f1), step(0.0, f2));
  vT = aT;
}
`;
const EDGE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uDashM;    // dash length in world metres; 0 = solid
uniform float uHideBack; // 1 = cull back-facing edges
varying float vVis;
varying float vT;
void main() {
  if (uHideBack > 0.5 && vVis < 0.5) discard;
  if (uDashM > 0.0 && fract(vT / (2.0 * uDashM)) > 0.5) discard;
  gl_FragColor = vec4(uColor, uOpacity);
}
`;

// The 12 edges of a box of LOCAL size (sx, sy, sz) centred at origin, with per-edge
// adjacent-face normals and a world-metre dash coordinate (world = local x the
// building dimension the group scales by).
function buildEdgeGeometry(
  sx: number,
  sy: number,
  sz: number,
  wx: number,
  wy: number,
  wz: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const n1: number[] = [];
  const n2: number[] = [];
  const t: number[] = [];
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const edge = (
    a: [number, number, number],
    b: [number, number, number],
    na: [number, number, number],
    nb: [number, number, number],
    worldLen: number,
  ) => {
    pos.push(...a, ...b);
    n1.push(...na, ...na);
    n2.push(...nb, ...nb);
    t.push(0, worldLen);
  };
  for (const ys of [-1, 1] as const)
    for (const zs of [-1, 1] as const)
      edge([-hx, ys * hy, zs * hz], [hx, ys * hy, zs * hz], [0, ys, 0], [0, 0, zs], sx * wx);
  for (const xs of [-1, 1] as const)
    for (const zs of [-1, 1] as const)
      edge([xs * hx, -hy, zs * hz], [xs * hx, hy, zs * hz], [xs, 0, 0], [0, 0, zs], sy * wy);
  for (const xs of [-1, 1] as const)
    for (const ys of [-1, 1] as const)
      edge([xs * hx, ys * hy, -hz], [xs * hx, ys * hy, hz], [xs, 0, 0], [0, ys, 0], sz * wz);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aN1", new THREE.Float32BufferAttribute(n1, 3));
  geo.setAttribute("aN2", new THREE.Float32BufferAttribute(n2, 3));
  geo.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  return geo;
}

const EDGE_DASH_M = 1.4; // dash length (world metres) for unselected units

// Draws one tenant region as a volumetric cube glued to the building: the
// region's local footprint (bay-aligned) × floor span, in the building's centred
// unit box, stretched by (width, height, depth). Corner units wrap the corner; a
// whole-building region encloses with a bottom (lifted above the road). X-ray
// (depthTest off), additive glow in the passed highlight colour. Pass pointer
// handlers to make it selectable (the mesh raycasts by geometry regardless of
// its x-ray material, so a unit on any face can be clicked).
export function UnitBox({
  building,
  region,
  color,
  opacity = 0.55,
  onPointerOver,
  onPointerOut,
  onClick,
  proud = false,
  outline = "dashed",
}: {
  building: Building;
  region: TenantRegion;
  color: string;
  opacity?: number;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  proud?: boolean;
  // "solid" = full outline, every edge (selected/hovered units); "dashed" =
  // dashed lines, back-facing edges hidden (unselected units). User 2026-07-27.
  outline?: "solid" | "dashed";
}) {
  const floors = building.floors;
  // Storefront-aware floor mapping (user 2026-07-27): on eligible downtown
  // buildings the shader stretches floor 0, so uniform k/floors put every unit
  // off its visible floor lines — floorFrac applies the same warp.
  const storefrontShare = useSceneStore((s) => s.windowAA.storefront);
  const storefrontHeight = useSceneStore((s) => s.windowAA.storefrontHeight);
  const gf = storefrontGroundFrac(building, storefrontShare, storefrontHeight);
  const isWhole = region.floorStart === 0 && region.floorEnd >= floors;
  const lift = isWhole ? Math.min(0.12, 4 / Math.max(1, building.height)) : 0;
  const yBottom = floorFrac(region.floorStart, floors, gf) - 0.5 + lift;
  const yTop = floorFrac(region.floorEnd, floors, gf) - 0.5;
  const cx = (region.xMin + region.xMax) / 2;
  const cz = (region.zMin + region.zMax) / 2;
  const cy = (yBottom + yTop) / 2;
  const sx = Math.max(1e-3, region.xMax - region.xMin);
  const sz = Math.max(1e-3, region.zMax - region.zMin);
  const sy = Math.max(1e-3, yTop - yBottom);
  // Sit a hair proud of the facade so an interactive unit wins the raycast over
  // the building's own surface (clicking a unit selects the person, not the building).
  const p = proud ? 1.015 : 1;

  // Unit BORDER (user 2026-07-27): edge outline so adjacent units read as separate
  // volumes. Custom shader: dashed + back-facing edges hidden for unselected units,
  // solid full outline for selected (see EDGE_VERTEX/EDGE_FRAGMENT above).
  const edges = useMemo(
    () =>
      buildEdgeGeometry(
        sx,
        sy,
        sz,
        building.width * p,
        building.height * p,
        building.depth * p,
      ),
    [sx, sy, sz, building.width, building.height, building.depth, p],
  );
  useEffect(() => () => edges.dispose(), [edges]);
  const edgeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: EDGE_VERTEX,
        fragmentShader: EDGE_FRAGMENT,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uOpacity: { value: 0.9 },
          uDashM: { value: EDGE_DASH_M },
          uHideBack: { value: 1 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; uniforms sync below
    [],
  );
  useEffect(() => () => edgeMat.dispose(), [edgeMat]);
  useEffect(() => {
    edgeMat.uniforms.uColor.value.set(color);
    edgeMat.uniforms.uDashM.value = outline === "solid" ? 0 : EDGE_DASH_M;
    edgeMat.uniforms.uHideBack.value = outline === "solid" ? 0 : 1;
  }, [edgeMat, color, outline]);

  return (
    <group
      position={[building.x, building.height / 2, building.z]}
      rotation={[0, -building.rotationY, 0]}
      scale={[building.width * p, building.height * p, building.depth * p]}
    >
      <mesh
        position={[cx, cy, cz]}
        renderOrder={1002}
        frustumCulled={false}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
        onClick={onClick}
      >
        <boxGeometry args={[sx, sy, sz]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          blending={THREE.AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          fog={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments
        geometry={edges}
        material={edgeMat}
        position={[cx, cy, cz]}
        renderOrder={1003}
        frustumCulled={false}
      />
    </group>
  );
}
