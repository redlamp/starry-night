"use client";

import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER } from "@/lib/seed/topology";

// City-anchored fog (2026-06-06). Three's fog is eye-distance — with absolute
// near/far the camera's own movement decided how much of the city drowned
// (orbit out past `far` and the whole skyline vanished). This ticker re-derives
// the brackets every frame around d = |camera → CITY_CENTER| so the gradient is
// pinned to the city: the near side stays clear, the far side fades, and no
// camera path can consume the silhouettes.
//
// Ortho note: "ortho" here is a projection-matrix morph — the camera never
// physically moves and fog depth is still measured from the real camera. So an
// ortho zoom-out (orthoSize ↑) shrinks the city on screen WITHOUT changing d,
// and these brackets keep the fog identical — which is the correct reading of
// a scale change that isn't a distance change. Perspective zoom (radius ↑)
// changes d and the brackets track it 1:1.
const _centre = new THREE.Vector3();

export function FogTicker() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const fog = scene.fog;
    if (!fog) return;
    const s = useSceneStore.getState();
    _centre.set(CITY_CENTER.x, 0, CITY_CENTER.z);
    const d = Math.max(1, camera.position.distanceTo(_centre));

    if ((fog as THREE.Fog).isFog) {
      // near/far are positions on the camera→centre axis: 0 = camera,
      // 1 = city centre, >1 = beyond. Scaled by the live distance so the
      // gradient rides with the camera.
      const f = fog as THREE.Fog;
      f.near = Math.max(1, d * s.fog.near);
      f.far = Math.max(f.near + 1, d * s.fog.far);
    } else if ((fog as THREE.FogExp2).isFogExp2) {
      // exp² has no near/far brackets, so anchor it by SOLVING for density:
      // the slider is the fog AMOUNT at the city centre (0..0.9), and
      // factor = 1 − e^(−(ρd)²) inverts to ρ = √(−ln(1−amount)) / d. The far
      // half fades harder, the near half clears — and the amount at the city
      // stays put for any camera distance. (A naive ρ ∝ 1/d keeps ρ·d at the
      // tuned constant ~2.9 → e^(−8.3) → permanently white-out.)
      const amount = Math.min(0.9, Math.max(0, s.fog.density));
      (fog as THREE.FogExp2).density =
        amount <= 0 ? 0 : Math.sqrt(-Math.log(1 - amount)) / d;
    }
  });

  return null;
}
