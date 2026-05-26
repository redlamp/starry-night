"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { moonHaloVertexShader, moonHaloFragmentShader } from "@/lib/shaders/moonHalo";

// Moon as a celestial body on a sky dome centred on the city.
// Sliders express where it sits in the sky, not its world coords:
//   - azimuthDeg   — compass yaw around the city axis (0 = +z, 90 = +x)
//   - elevationDeg — angle above the horizon (0 = horizon, 90 = zenith)
//   - distance     — radial distance from city centre; default sits on the
//                    star dome so the moon hugs the celestial sphere
//
// Standard mode: azimuth/elevation/distance taken straight from the store —
// moon is fixed in world space, like a real celestial body.
//
// "Follow camera" debug toggle: azimuth is replaced with (camera azimuth + 180°)
// so the moon stays opposite the camera around the city. Elevation and distance
// are untouched, so the moon orbits at the same sky height + radius.
const MOON_RADIUS_RATIO = 0.0355;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Halo billboard. Sized as a multiple of moon radius — bigger = softer glow.
const HALO_RADIUS_MUL = 3.5;

export function Moon() {
  const meshRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const followCamera = useSceneStore((s) => s.moonFollowCamera);
  const starsRadius = useSceneStore((s) => s.stars.radius);
  const orbit = useSceneStore((s) => s.orbit);
  const moon = useSceneStore((s) => s.moon);
  const setMoonLive = useSceneStore((s) => s.setMoonLive);
  const lastWrite = useRef(0);

  const haloMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: moonHaloVertexShader,
        fragmentShader: moonHaloFragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color("#f7f1d8") },
          uInnerRadius: { value: 0.08 },
          uIntensity: { value: 1.3 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  );

  useFrame(() => {
    if (!meshRef.current) return;

    let azimuth = moon.azimuthDeg * DEG2RAD;
    if (followCamera) {
      const camAzimuth = Math.atan2(
        camera.position.x - orbit.centerX,
        camera.position.z - orbit.centerZ,
      );
      azimuth = camAzimuth + Math.PI;
    }
    const elevation = moon.elevationDeg * DEG2RAD;
    const horizontalRadius = moon.distance * Math.cos(elevation);

    meshRef.current.position.set(
      orbit.centerX + horizontalRadius * Math.sin(azimuth),
      moon.distance * Math.sin(elevation),
      orbit.centerZ + horizontalRadius * Math.cos(azimuth),
    );

    // Halo billboard: face camera each frame.
    if (haloRef.current) {
      haloRef.current.lookAt(camera.position);
    }

    const now = performance.now();
    if (now - lastWrite.current >= 100) {
      lastWrite.current = now;
      const p = meshRef.current.position;
      setMoonLive({
        position: [p.x, p.y, p.z],
        azimuthDeg: ((azimuth * RAD2DEG) % 360 + 360) % 360,
        elevationDeg: moon.elevationDeg,
        distance: moon.distance,
      });
    }
  });

  const moonRadius = starsRadius * MOON_RADIUS_RATIO;
  const haloSize = moonRadius * HALO_RADIUS_MUL * 2;

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[moonRadius, 32, 32]} />
      <meshBasicMaterial color="#f7f1d8" toneMapped={false} fog={false} />
      <mesh ref={haloRef} material={haloMaterial} renderOrder={-1}>
        <planeGeometry args={[haloSize, haloSize]} />
      </mesh>
    </mesh>
  );
}
