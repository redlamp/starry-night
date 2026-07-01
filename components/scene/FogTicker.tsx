"use client";

import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";

// World-absolute fog (2026-07-01): near/far are ABSOLUTE world metres measured from the
// camera (THREE.Fog's native model), so the haze is a fixed property of the world and does
// NOT rescale as the camera moves — a building at a given world distance reads the same haze
// wherever the camera is. This replaces the 2026-06-06 camera→target RELATIVE model (near/far
// as multiples of the camera→focal distance), which "breathed" with camera distance and, in
// free-roam modes (Google Earth pan / free-look), lagged and pulsed as the target roamed.
//
// "Centered on distance from the camera" is THREE.Fog's native behaviour — near/far ARE camera
// distances; we just feed them fixed world values instead of d-scaled ones. exp² has no near/far
// brackets, so its "amount" (0..0.9) is anchored to a FIXED world reference distance below —
// same world-locked, camera-independent feel.
const FOG_EXP2_REF = 5000; // metres — exp² "amount" is the fog amount at this world distance

export function FogTicker() {
  const scene = useThree((s) => s.scene);

  useFrame(() => {
    const fog = scene.fog;
    if (!fog) return;
    const s = useSceneStore.getState();
    if ((fog as THREE.Fog).isFog) {
      // Absolute metres from the camera — FogTicker just mirrors the sliders so live edits
      // (and the FogBoundsMarkers walls) stay in sync with the real fog.
      const f = fog as THREE.Fog;
      f.near = Math.max(0, s.fog.near);
      f.far = Math.max(f.near + 1, s.fog.far);
    } else if ((fog as THREE.FogExp2).isFogExp2) {
      // amount at FOG_EXP2_REF → density: 1 − e^(−(ρ·REF)²) = amount ⇒ ρ = √(−ln(1−amount)) / REF.
      const amount = Math.min(0.9, Math.max(0, s.fog.density));
      (fog as THREE.FogExp2).density =
        amount <= 0 ? 0 : Math.sqrt(-Math.log(1 - amount)) / FOG_EXP2_REF;
    }
  });

  return null;
}
