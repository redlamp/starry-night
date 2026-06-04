"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { shootingStarVertexShader, shootingStarFragmentShader } from "@/lib/shaders/shootingStar";

// Rare shooting star (#26 slice 2) — one tapering streak at a time, fully
// shader-animated off the shared clock (see lib/shaders/shootingStar.ts).
// Deterministic per seed: the bucket hashes derive from uSeed; no Math.random
// at runtime, no per-frame CPU.

const TRAIL = 14; // sprites along the streak

function seedToFloat(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function ShootingStars({ masterSeed, radius }: { masterSeed: string; radius: number }) {
  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(TRAIL * 3); // real positions live in the shader
    const trail = new Float32Array(TRAIL);
    for (let i = 0; i < TRAIL; i++) trail[i] = i / (TRAIL - 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aTrail", new THREE.BufferAttribute(trail, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: shootingStarVertexShader,
      fragmentShader: shootingStarFragmentShader,
      uniforms: {
        uTime: sharedTime,
        uSeed: { value: seedToFloat(masterSeed) * 100 },
        uRadius: { value: radius },
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    return { geometry: geo, material: mat };
  }, [masterSeed, radius]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const skyHidden = useSceneStore((s) => s.debug.renderModes.sky === "hidden");

  return (
    <points geometry={geometry} material={material} frustumCulled={false} visible={!skyHidden} />
  );
}
