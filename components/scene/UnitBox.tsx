"use client";

import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
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
}: {
  building: Building;
  region: TenantRegion;
  color: string;
  opacity?: number;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const floors = building.floors;
  const isWhole = region.floorStart === 0 && region.floorEnd >= floors;
  const lift = isWhole ? Math.min(0.12, 4 / Math.max(1, building.height)) : 0;
  const yBottom = region.floorStart / floors - 0.5 + lift;
  const yTop = region.floorEnd / floors - 0.5;
  const cx = (region.xMin + region.xMax) / 2;
  const cz = (region.zMin + region.zMax) / 2;
  const cy = (yBottom + yTop) / 2;
  const sx = Math.max(1e-3, region.xMax - region.xMin);
  const sz = Math.max(1e-3, region.zMax - region.zMin);
  const sy = Math.max(1e-3, yTop - yBottom);

  return (
    <group
      position={[building.x, building.height / 2, building.z]}
      rotation={[0, -building.rotationY, 0]}
      scale={[building.width, building.height, building.depth]}
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
    </group>
  );
}
