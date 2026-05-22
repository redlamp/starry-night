"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";

// Moon orbits the same ground point the camera orbits (city centre).
// Position is driven by the store's `moon` spherical params:
//   - horizontalRadius — distance from city axis in xz plane
//   - height           — y above ground
//   - angleDeg         — yaw around city axis, 0 = +z, 90 = +x
//
// When `moonOppositeCamera` is on, the angle is overridden with
// (cameraAngle + π); radius + height stay locked to the store values.
const MOON_RADIUS_RATIO = 0.0355;

export function Moon() {
  const meshRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const oppositeCamera = useSceneStore((s) => s.moonOppositeCamera);
  const starsRadius = useSceneStore((s) => s.stars.radius);
  const orbit = useSceneStore((s) => s.orbit);
  const moon = useSceneStore((s) => s.moon);
  const setMoonLive = useSceneStore((s) => s.setMoonLive);
  const lastWrite = useRef(0);

  useFrame(() => {
    if (!meshRef.current) return;

    let angle = (moon.angleDeg * Math.PI) / 180;
    if (oppositeCamera) {
      const camAngle = Math.atan2(
        camera.position.x - orbit.centerX,
        camera.position.z - orbit.centerZ,
      );
      angle = camAngle + Math.PI;
    }

    meshRef.current.position.set(
      orbit.centerX + moon.horizontalRadius * Math.sin(angle),
      moon.height,
      orbit.centerZ + moon.horizontalRadius * Math.cos(angle),
    );

    const now = performance.now();
    if (now - lastWrite.current >= 100) {
      lastWrite.current = now;
      const p = meshRef.current.position;
      setMoonLive({
        position: [p.x, p.y, p.z],
        horizontalRadius: moon.horizontalRadius,
        height: moon.height,
        angleDeg: ((angle * 180) / Math.PI + 360) % 360,
      });
    }
  });

  const moonRadius = starsRadius * MOON_RADIUS_RATIO;

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[moonRadius, 32, 32]} />
      <meshBasicMaterial color="#f7f1d8" toneMapped={false} fog={false} />
    </mesh>
  );
}
