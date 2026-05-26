"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { deriveSeed } from "@/lib/seed/rng";
import { sharedTime } from "@/lib/shaders/sharedTime";
import {
  starFieldVertexShader,
  starFieldFragmentShader,
} from "@/lib/shaders/starField";

type Props = {
  masterSeed: string;
  count: number;
  radius: number;
  depth: number;
  /** Mean base size, in pixels at d=1. Real on-screen size scales with depth. */
  size?: number;
  /** Fraction of stars that twinkle visibly (rest stay steady). */
  twinkleRatio?: number;
};

/**
 * Single THREE.Points cloud with per-star twinkle phase + frequency. Replaces
 * drei's `<Stars>` so we can drive twinkle from `sharedTime` (deterministic per
 * seed, frame-independent of any individual material).
 *
 * Star positions live on a thick spherical shell of `radius` ± `depth`, biased
 * upward so the sky reads as densely populated above the horizon and sparse
 * below.
 */
export function StarField({
  masterSeed,
  count,
  radius,
  depth,
  size = 1.5,
  twinkleRatio = 0.55,
}: Props) {
  const { geometry, material } = useMemo(() => {
    const rng = deriveSeed(masterSeed, "stars");

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const freqs = new Float32Array(count);
    const twinkles = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Spherical sample with upper-hemisphere bias (sqrt(u) makes y skew up).
      const u = rng();
      const theta = rng() * Math.PI * 2;
      // Lift the cos(phi) distribution toward the upper half: most stars sit at
      // y >= -0.1*r so the city horizon stays mostly clear.
      const phi = Math.acos(1 - 1.7 * u);
      const r = radius + (rng() - 0.5) * depth;

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Size distribution: long-tail. Most stars are small, a few are big.
      const s = Math.pow(rng(), 3.0);
      sizes[i] = size * (0.55 + 1.6 * s);

      phases[i] = rng();
      freqs[i] = 0.4 + rng() * 1.0;
      twinkles[i] = rng() < twinkleRatio ? 0.6 + rng() * 0.4 : 0.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aFreq", new THREE.BufferAttribute(freqs, 1));
    geo.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: starFieldVertexShader,
      fragmentShader: starFieldFragmentShader,
      uniforms: {
        uTime: sharedTime,
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
  }, [masterSeed, count, radius, depth, size, twinkleRatio]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
