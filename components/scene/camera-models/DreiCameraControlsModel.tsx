"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { GROUND_APRON_M } from "../Ground";
import { writeOrbitPose } from "./orbitWriteback";
import { useDoubleClickReset } from "./cameraReset";

// "Drei - CameraControls" — the camera-controls library (drei's <CameraControls>) with its
// NATIVE input left ON: LMB orbits, RMB trucks (screen-plane pan), wheel dollies. This is
// the unmodified baseline the app's custom orbit (DreiSceneControls / Drift / Turntable) is
// built on — exposed vanilla for comparison. Unlike those, the library owns the pose here;
// we only frame it on mount and read the pose back out for the rest of the scene.
//
// Forces PERSPECTIVE on mount and restores the prior projection on exit (cf. FlyModel): the
// faked-ortho morph is driven by the app's per-frame orbit.radius write-back, which the
// stock control doesn't do, so it runs perspective-only — matching /camera-lab. Self-gates
// to orbit.

const DEG = Math.PI / 180;
const _target = new THREE.Vector3();

export function DreiCameraControlsModel() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const mode = useSceneStore((s) => s.cameraMode);
  const lastWrite = useRef(0);

  // Force perspective while active; restore the prior projection on exit.
  useEffect(() => {
    const s = useSceneStore.getState();
    const prevProj = s.projection;
    const prevBlend = s.projectionBlend;
    s.setProjection("perspective");
    s.setProjectionBlend(0);
    return () => {
      const s2 = useSceneStore.getState();
      s2.setProjection(prevProj);
      s2.setProjectionBlend(prevBlend);
    };
  }, []);

  // Frame the city (bearing continued from the current orbit). Used on mount (snap) and by the
  // double-click reset (smooth) — camera-controls no-ops a setLookAt already satisfied, so an
  // unchanged view doesn't visibly jump.
  const frame = useCallback((transition: boolean) => {
    const c = controls.current;
    if (!c) return;
    const s = useSceneStore.getState();
    const tier = CITY_TIERS[s.citySize] + GROUND_APRON_M;
    const R = tier * 2.0;
    const elev = 28 * DEG;
    const az = s.orbit.azimuthDeg * DEG;
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    void c.setLookAt(
      cx + R * Math.cos(elev) * Math.sin(az),
      R * Math.sin(elev),
      cz + R * Math.cos(elev) * Math.cos(az),
      cx,
      0, // aim at the ground centre (CITY_CENTER is x/z only)
      cz,
      transition,
    );
    c.maxPolarAngle = Math.PI / 2 - 0.01; // stay above the ground plane
    c.minDistance = tier * 0.2;
    c.maxDistance = tier * 8;
  }, []);

  // Frame on mount; afterward the library owns the camera (native actions stay at stock defaults).
  useEffect(() => {
    frame(false);
  }, [frame]);

  useDoubleClickReset(() => frame(true));

  useFrame((state) => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const tt = state.clock.elapsedTime;
    if (tt - lastWrite.current >= 0.1) {
      lastWrite.current = tt;
      c.getTarget(_target);
      writeOrbitPose(state.camera as THREE.PerspectiveCamera, _target);
    }
  });

  if (mode !== "orbit") return null;
  return <CameraControls ref={controls} makeDefault />;
}
