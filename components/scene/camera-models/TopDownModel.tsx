"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_SCALE, CITY_TIERS } from "@/lib/seed/topology";
import { GROUND_APRON_M } from "../Ground";

// "Top-down" — a fixed, north-up overhead plan view (per spec: north up, no rotation,
// looking straight down at the city centre). NOT an orbit: the camera sits directly
// above the centre looking down, fit to the whole city (+ margin) for the current
// aspect. Driven directly (no camera-controls, so no gimbal ambiguity at straight-down);
// ProjectionBlender still supplies the ortho/persp matrix from orthoSize, which we size
// to fit. Snapshots + restores orthoSize and camera.up so leaving top-down doesn't
// disturb the orbit models.

const TOP_DOWN_MARGIN = 1.15;
// North-up: compass 0 = +Z (azimuth = atan2(x, z)), so making -Z read as "up" on screen
// points north up. (Flip to +Z if it reads upside down on a given device.)
const NORTH_UP = new THREE.Vector3(0, 0, -1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Ortho half-height that fits the city (+ margin); the limiting screen axis sets it.
function fitOrthoSize(tier: number, aspect: number): number {
  return (tier * TOP_DOWN_MARGIN) / Math.min(1, aspect);
}

export function TopDownModel() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const citySize = useSceneStore((s) => s.citySize);
  const prevOrtho = useRef<number | null>(null);
  const lastWrite = useRef(0);

  // Snapshot orthoSize on mount; restore it (and camera.up) on exit so the orbit models
  // resume with the user's zoom and a normal up vector.
  useEffect(() => {
    prevOrtho.current = useSceneStore.getState().orthoSize;
    return () => {
      if (prevOrtho.current != null) useSceneStore.getState().setOrthoSize(prevOrtho.current);
      camera.up.copy(WORLD_UP);
    };
  }, [camera]);

  // Fit orthoSize to the city for the current aspect/tier (ProjectionBlender frames the
  // ortho view from it). Written on change only — never per-frame — so it can't thrash
  // the store.
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const tier = CITY_TIERS[citySize] + GROUND_APRON_M;
    useSceneStore.getState().setOrthoSize(fitOrthoSize(tier, aspect));
  }, [citySize, size.width, size.height]);

  useFrame((state) => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const tier = CITY_TIERS[citySize] + GROUND_APRON_M;
    const orthoSize = fitOrthoSize(tier, aspect);
    // Perspective fit + clip-safe height (the fov spans the same framed extent).
    const tan = Math.tan((cam.fov * Math.PI) / 360) || 0.4663;
    const height = Math.min(10000 * CITY_SCALE, Math.max(50 * CITY_SCALE, orthoSize / tan));
    cam.position.set(CITY_CENTER.x, height, CITY_CENTER.z);
    cam.up.copy(NORTH_UP);
    cam.lookAt(CITY_CENTER.x, 0, CITY_CENTER.z);
    cam.updateMatrixWorld();
    // Keep cameraLive current (camera-anchored fog, moon-follow, panel readout, side-view diagram) —
    // this model drives the camera directly, so nothing else writes it. ~10/s, like the other models.
    const tt = state.clock.elapsedTime;
    if (tt - lastWrite.current >= 0.1) {
      lastWrite.current = tt;
      useSceneStore.getState().setCameraLive({
        position: [cam.position.x, cam.position.y, cam.position.z],
        rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
        fov: cam.fov,
      });
    }
  });

  return null;
}
