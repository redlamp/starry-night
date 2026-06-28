"use client";

import { useCallback, useEffect, useRef, type ComponentRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { GROUND_APRON_M } from "../Ground";
import { writeOrbitPose } from "./orbitWriteback";
import { useDoubleClickReset } from "./cameraReset";

// "Drei - MapControls" — drei's stock MapControls, exposed unmodified. MapControls is
// three.js OrbitControls rebound for maps, so its native bindings are LMB = pan across the
// ground, RMB = orbit, wheel = zoom (a DIFFERENT library from the app's camera-controls
// orbit). We only frame the city on mount and clamp distance / polar so you can't orbit
// under the ground; the library owns everything else.
//
// Perspective only (see DreiCameraControlsModel for why). Self-gates to orbit.

const DEG = Math.PI / 180;
const _target = new THREE.Vector3();

export function DreiMapControlsModel() {
  const ref = useRef<ComponentRef<typeof MapControls>>(null);
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

  // Frame the city: aim the target at the centre and place the camera on the current bearing. Used on
  // mount and by the double-click reset. OrbitControls has no tween, so the reset snaps — a no-op when
  // the view is already framed.
  const frame = useCallback(() => {
    const m = ref.current;
    if (!m) return;
    const s = useSceneStore.getState();
    const tier = CITY_TIERS[s.citySize] + GROUND_APRON_M;
    const R = tier * 2.0;
    const elev = 28 * DEG;
    const az = s.orbit.azimuthDeg * DEG;
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    m.target.set(cx, 0, cz); // aim at the ground centre (CITY_CENTER is x/z only)
    m.object.position.set(
      cx + R * Math.cos(elev) * Math.sin(az),
      R * Math.sin(elev),
      cz + R * Math.cos(elev) * Math.cos(az),
    );
    m.minDistance = tier * 0.2;
    m.maxDistance = tier * 8;
    m.maxPolarAngle = Math.PI / 2 - 0.01;
    m.update();
  }, []);

  useEffect(() => {
    frame();
  }, [frame]);

  useDoubleClickReset(() => frame());

  useFrame((state) => {
    const m = ref.current;
    if (!m || mode !== "orbit") return;
    const tt = state.clock.elapsedTime;
    if (tt - lastWrite.current >= 0.1) {
      lastWrite.current = tt;
      _target.copy(m.target);
      writeOrbitPose(state.camera as THREE.PerspectiveCamera, _target);
    }
  });

  if (mode !== "orbit") return null;
  return <MapControls ref={ref} makeDefault />;
}
