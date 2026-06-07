"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, DEFAULT_HAZE } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { GROUND_APRON_M } from "@/components/scene/Ground";
import { groundHazeVertexShader, groundHazeFragmentShader } from "@/lib/shaders/groundHaze";

/**
 * Low atmospheric band near the city horizon. Sits as the inner surface of a
 * sphere with the same centre + radius as the ground disc (tier half-extent +
 * 200 m apron, on CITY_CENTER) so their edges align. User-tuned (2026-06-07):
 * a sphere much wider than the city read as planet curvature. The persisted
 * `haze.radius` setting SCALES that base (its default = 1×), so the slider and
 * saved configs keep working relative to whatever tier is active. Vertical
 * alpha gradient confines it to a band between bottomY and topY.
 */
export function GroundHaze() {
  const meshRef = useRef<THREE.Mesh>(null);
  const haze = useSceneStore((s) => s.haze);
  const citySize = useSceneStore((s) => s.citySize);
  const radius = ((CITY_TIERS[citySize] + GROUND_APRON_M) * haze.radius) / DEFAULT_HAZE.radius;

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
    const h = useSceneStore.getState().haze;
    if (meshRef.current) meshRef.current.visible = h.enabled;
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
      position={[CITY_CENTER.x, 0, CITY_CENTER.z]}
      visible={haze.enabled}
    >
      {/* FULL sphere, deliberately: the underside hangs below the ground disc
          and silhouettes as a dark hemisphere against the stars (the band
          shader clamps to full alpha below bottomY) — the city resting on
          half a globe. User-confirmed look (2026-06-07); only the RADIUS was
          the problem, and that now hugs the city above. */}
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  );
}
