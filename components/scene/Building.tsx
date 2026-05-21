"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Building as BuildingData } from "@/lib/seed/cityGen";
import { FACADE_BY_LAYER, GLOW_BY_LAYER, generateWindowTexture } from "@/lib/seed/lightingGen";
import { windowVertexShader, windowFragmentShader } from "@/lib/shaders/window";

export function Building({ data, masterSeed }: { data: BuildingData; masterSeed: string }) {
  const { material, geometry } = useMemo(() => {
    const { texture, cols, rows } = generateWindowTexture(masterSeed, data);

    const mat = new THREE.ShaderMaterial({
      vertexShader: windowVertexShader,
      fragmentShader: windowFragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uWindowData: { value: texture },
          uGrid: { value: new THREE.Vector2(cols, rows) },
          uFacadeColor: { value: new THREE.Color(FACADE_BY_LAYER[data.layer]) },
          uFacadeGlow: { value: GLOW_BY_LAYER[data.layer] },
          uWindowWidth: { value: 0.3 },
          uWindowHeight: { value: 0.5 },
          uEmissiveBoost: { value: 1.1 },
        },
      ]),
      fog: true,
    });
    // UniformsUtils.merge clones data textures — restore real ref so updates work.
    mat.uniforms.uWindowData.value = texture;
    mat.uniforms.uFacadeColor.value = new THREE.Color(FACADE_BY_LAYER[data.layer]);

    const geo = new THREE.BoxGeometry(data.width, data.height, data.depth);
    return { material: mat, geometry: geo };
  }, [data, masterSeed]);

  return (
    <mesh
      position={[data.x, data.height / 2, data.z]}
      rotation={[0, data.rotationY, 0]}
      geometry={geometry}
      material={material}
      frustumCulled
    />
  );
}
