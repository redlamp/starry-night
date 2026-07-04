"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, SELECT_OUTLINE_COLOR } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";

// #87 follow-up: a marker pin floating 5 m above the SELECTED building's roof.
// A teardrop (bulb on top, tapering to a point at the bottom) whose tip sits at
// (x, height + 5, z) — pointing down at the roof. Distance-scaled each frame so
// it stays a readable size across the whole zoom range (a fixed-size pin would
// vanish city-wide, or dwarf a low-rise up close). Emissive select-blue to
// match the selection outline. Mounted only once the city is ready, so its
// generateCity() lookup always hits the warm cache (never stalls first paint).
const CONE_H = 6;
const CONE_R = 2.5;
const SPHERE_R = 2.5;
const ROOF_GAP_M = 5;
const PIN_COLOR_BASE = "#04121f"; // near-black; the emissive is what reads

export function BuildingPin() {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const idToBuilding = useMemo(() => {
    void citySize; // tier/sketch switch is a different city — rebuild the map
    void citySketch;
    const { buildings } = generateCity(masterSeed, cityShape, cityShapeScale);
    return new Map(buildings.map((b) => [b.id, b]));
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const b = selectedBuildingId !== null ? idToBuilding.get(selectedBuildingId) : undefined;
    if (!b) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(b.x, b.height + ROOF_GAP_M, b.z);
    // Constant-ish screen size: scale ~ camera distance, clamped so it neither
    // vanishes zoomed way out nor dwarfs a small building up close. The tip is
    // at the group origin, so scaling grows the pin UPWARD and keeps the 5 m
    // roof gap fixed.
    const d = state.camera.position.distanceTo(g.position);
    g.scale.setScalar(THREE.MathUtils.clamp(d / 250, 1, 40));
  });

  return (
    <group ref={group} visible={false}>
      <mesh rotation-x={Math.PI} position-y={CONE_H / 2}>
        <coneGeometry args={[CONE_R, CONE_H, 6]} />
        <meshStandardMaterial
          color={PIN_COLOR_BASE}
          emissive={SELECT_OUTLINE_COLOR}
          emissiveIntensity={2.6}
          roughness={0.5}
        />
      </mesh>
      <mesh position-y={CONE_H}>
        <sphereGeometry args={[SPHERE_R, 14, 10]} />
        <meshStandardMaterial
          color={PIN_COLOR_BASE}
          emissive={SELECT_OUTLINE_COLOR}
          emissiveIntensity={2.6}
          roughness={0.5}
        />
      </mesh>
    </group>
  );
}
