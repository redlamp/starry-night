"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  skyGradientVertexShader,
  skyGradientFragmentShader,
} from "@/lib/shaders/skyGradient";

// Inside-out sphere painted by skyGradient shader. Drawn first in the star
// scene (renderOrder=-1) so stars composite on top.
export function SkyGradient({
  horizonColor,
  zenithColor,
  horizonBlend = 0.4,
}: {
  horizonColor: string;
  zenithColor: string;
  horizonBlend?: number;
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyGradientVertexShader,
        fragmentShader: skyGradientFragmentShader,
        uniforms: {
          uHorizonColor: { value: new THREE.Color(horizonColor) },
          uZenithColor: { value: new THREE.Color(zenithColor) },
          uHorizonBlend: { value: horizonBlend },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
      }),
    // Material is created once; uniforms are pushed via the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    material.uniforms.uHorizonColor.value.set(horizonColor);
  }, [material, horizonColor]);
  useEffect(() => {
    material.uniforms.uZenithColor.value.set(zenithColor);
  }, [material, zenithColor]);
  useEffect(() => {
    material.uniforms.uHorizonBlend.value = horizonBlend;
  }, [material, horizonBlend]);

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[9000, 32, 16]} />
    </mesh>
  );
}
