"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { deriveSeed } from "@/lib/seed/rng";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { sharedStarIntroProgress, sharedStarIntroMode } from "@/lib/shaders/sharedIntro";
import { starFieldVertexShader, starFieldFragmentShader } from "@/lib/shaders/starField";

type Props = {
  masterSeed: string;
  count: number;
  radius: number;
  depth: number;
  /** Mean base size, in pixels at d=1. Real on-screen size scales with depth. */
  size?: number;
};

// Spectral-class palette, weights matching the naked-eye sky:
//   ~5% blue-white (B), ~60% white (A/F), ~20% yellow-white (F/G),
//   ~10% orange (K), ~5% red (M giants). Colours sit slightly above 1.0 on
//   the warm channels so ACES preserves a hint of hue at HDR.
const STAR_PALETTE: Array<{ weight: number; rgb: [number, number, number] }> = [
  { weight: 0.05, rgb: [0.72, 0.84, 1.0] }, // blue-white  ~10000K
  { weight: 0.6, rgb: [1.0, 1.0, 1.0] }, // white       ~7000K
  { weight: 0.2, rgb: [1.0, 0.95, 0.82] }, // yellow-white ~6000K
  { weight: 0.1, rgb: [1.0, 0.78, 0.45] }, // orange      ~4000K
  { weight: 0.05, rgb: [1.0, 0.55, 0.3] }, // red         ~3000K
];

function pickStarColor(r: number, brightnessRank: number): [number, number, number] {
  let acc = 0;
  let picked = STAR_PALETTE[0].rgb;
  for (const p of STAR_PALETTE) {
    acc += p.weight;
    if (r < acc) {
      picked = p.rgb;
      break;
    }
  }
  // Desaturate dim stars toward white — perceptually accurate (rods are
  // colour-blind, so faint stars look neutral while bright stars show hue).
  const sat = 0.25 + 0.75 * brightnessRank;
  return [1 + (picked[0] - 1) * sat, 1 + (picked[1] - 1) * sat, 1 + (picked[2] - 1) * sat];
}

/**
 * Single THREE.Points cloud with per-star twinkle phase + frequency. Replaces
 * drei's `<Stars>` so we can drive twinkle from `sharedTime` (deterministic per
 * seed, frame-independent of any individual material).
 *
 * Star positions live on a thick spherical shell of `radius` ± `depth`, biased
 * upward so the sky reads as densely populated above the horizon and sparse
 * below.
 */
export function StarField({ masterSeed, count, radius, depth, size = 1.5 }: Props) {
  const { geometry, material } = useMemo(() => {
    const rng = deriveSeed(masterSeed, "stars");

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const freqs = new Float32Array(count);
    const twinkles = new Float32Array(count);
    const sparkleSeeds = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    // Intro-mode baselines packed per-star:
    //   .x = random       (aPhase already, kept here for shader convenience)
    //   .y = 1 - sizeRank (brightness: big stars = low baseline = wake early)
    //   .z = heightNorm   (y on sphere normalised to 0..1; 0=south pole, 1=zenith)
    // The shader picks one component (and inverts .z for zenith-first) per mode.
    const introBaselines = new Float32Array(count * 3);

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

      const phase = rng();
      phases[i] = phase;
      freqs[i] = 0.4 + rng() * 1.0;
      // Twinkle amplitude tied to brightness rank — brightest stars twinkle
      // most (matches IRL atmospheric scintillation).
      twinkles[i] = 0.15 + s * 0.85;
      sparkleSeeds[i] = rng();

      const [cr, cg, cb] = pickStarColor(rng(), s);
      colors[i * 3 + 0] = cr;
      colors[i * 3 + 1] = cg;
      colors[i * 3 + 2] = cb;

      introBaselines[i * 3 + 0] = phase;
      introBaselines[i * 3 + 1] = 1 - s; // brightness: big stars (s near 1) first
      introBaselines[i * 3 + 2] = Math.max(0, Math.min(1, (y / r + 1) * 0.5));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aFreq", new THREE.BufferAttribute(freqs, 1));
    geo.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));
    geo.setAttribute("aSparkleSeed", new THREE.BufferAttribute(sparkleSeeds, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aIntroBaselines", new THREE.BufferAttribute(introBaselines, 3));

    const mat = new THREE.ShaderMaterial({
      vertexShader: starFieldVertexShader,
      fragmentShader: starFieldFragmentShader,
      uniforms: {
        uTime: sharedTime,
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
        uStarIntroProgress: sharedStarIntroProgress,
        uStarIntroMode: sharedStarIntroMode,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });

    return { geometry: geo, material: mat };
  }, [masterSeed, count, radius, depth, size]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Debug "sky" group (Slice B): Hidden removes the stars (wireframe is a no-op
  // for a point cloud).
  const skyHidden = useSceneStore((s) => s.debug.renderModes.sky === "hidden");

  return (
    <points geometry={geometry} material={material} frustumCulled={false} visible={!skyHidden} />
  );
}
