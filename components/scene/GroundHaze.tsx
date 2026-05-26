"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import {
  groundHazeVertexShader,
  groundHazeFragmentShader,
} from "@/lib/shaders/groundHaze";

/**
 * Low atmospheric band near the city horizon. Sits as the inner surface of a
 * sphere centred on the orbit centre, so it's visible from any camera angle.
 * Vertical alpha gradient confines it to a band between bottomY and topY.
 */
export function GroundHaze() {
  const meshRef = useRef<THREE.Mesh>(null);
  const haze = useSceneStore((s) => s.haze);
  const orbit = useSceneStore((s) => s.orbit);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: groundHazeVertexShader,
        fragmentShader: groundHazeFragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color(haze.color) },
          uTopY: { value: haze.topY },
          uBottomY: { value: haze.bottomY },
          uIntensity: { value: haze.intensity },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        fog: false,
      }),
    // Material is created once; uniforms are pushed each frame from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    return () => material.dispose();
  }, [material]);

  useFrame(() => {
    if (!meshRef.current) return;
    const s = useSceneStore.getState();
    const h = s.haze;
    meshRef.current.position.set(s.orbit.centerX, 0, s.orbit.centerZ);
    meshRef.current.visible = h.enabled;
    if (!h.enabled) return;
    material.uniforms.uColor.value.set(h.color);
    material.uniforms.uTopY.value = h.topY;
    material.uniforms.uBottomY.value = h.bottomY;
    material.uniforms.uIntensity.value = h.intensity;
  });

  return (
    <mesh
      ref={meshRef}
      material={material}
      position={[orbit.centerX, 0, orbit.centerZ]}
      visible={haze.enabled}
    >
      <sphereGeometry args={[haze.radius, 32, 16]} />
    </mesh>
  );
}
