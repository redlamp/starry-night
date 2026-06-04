"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { skyGradientVertexShader, skyGradientFragmentShader } from "@/lib/shaders/skyGradient";

// Inside-out sphere painted by skyGradient shader. Drawn first in the star
// scene (renderOrder=-1) so stars composite on top. #26: three-stop ramp
// (horizon → mid → indigo zenith), warm city-skyglow band at the horizon,
// IGN-dithered — see wiki/research/night-sky-reference-{real,stylized}.
export function SkyGradient({
  horizonColor,
  zenithColor,
  midColor = "#0b1028",
  horizonBlend = 0.4,
  glowColor = "#231507",
  glowHeight = 0.16,
  glowStrength = 0.45,
}: {
  horizonColor: string;
  zenithColor: string;
  midColor?: string;
  horizonBlend?: number;
  glowColor?: string;
  glowHeight?: number;
  glowStrength?: number;
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyGradientVertexShader,
        fragmentShader: skyGradientFragmentShader,
        uniforms: {
          uHorizonColor: { value: new THREE.Color(horizonColor) },
          uMidColor: { value: new THREE.Color(midColor) },
          uZenithColor: { value: new THREE.Color(zenithColor) },
          uHorizonBlend: { value: horizonBlend },
          uGlowColor: { value: new THREE.Color(glowColor) },
          uGlowHeight: { value: glowHeight },
          uGlowStrength: { value: glowStrength },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
        name: "skyGradient", // so a shader error names its material
      }),
    // Material is created once; uniforms are pushed via the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    material.uniforms.uHorizonColor.value.set(horizonColor);
  }, [material, horizonColor]);
  useEffect(() => {
    material.uniforms.uMidColor.value.set(midColor);
  }, [material, midColor]);
  useEffect(() => {
    material.uniforms.uZenithColor.value.set(zenithColor);
  }, [material, zenithColor]);
  useEffect(() => {
    material.uniforms.uHorizonBlend.value = horizonBlend;
  }, [material, horizonBlend]);
  useEffect(() => {
    material.uniforms.uGlowColor.value.set(glowColor);
  }, [material, glowColor]);
  useEffect(() => {
    material.uniforms.uGlowHeight.value = glowHeight;
    material.uniforms.uGlowStrength.value = glowStrength;
  }, [material, glowHeight, glowStrength]);

  useEffect(() => () => material.dispose(), [material]);

  // Debug "sky" group (Slice B): Hidden drops the gradient so the flat star-pass
  // background shows. Wireframe is a no-op for the sky dome.
  const skyHidden = useSceneStore((s) => s.debug.renderModes.sky === "hidden");

  return (
    <mesh material={material} renderOrder={-1} frustumCulled={false} visible={!skyHidden}>
      <sphereGeometry args={[9000, 32, 16]} />
    </mesh>
  );
}
