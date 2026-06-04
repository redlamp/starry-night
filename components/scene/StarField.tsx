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
  // #26 research: saturated colour belongs to only the brightest handful, so
  // the curve is quadratic — mid-brightness stars stay near-white too.
  const sat = 0.15 + 0.85 * brightnessRank * brightnessRank;
  return [1 + (picked[0] - 1) * sat, 1 + (picked[1] - 1) * sat, 1 + (picked[2] - 1) * sat];
}

// #26: magnitude-law brightness. Real skies have ~3× more stars per magnitude
// band and a 2.512× flux ratio per band — invert that CDF so a uniform draw
// yields the long-tail: nearly everything faint, a handful of standouts.
const MAG_RANGE = 5; // bands covered (relative mag 0 = brightest spawned)
function sampleBrightness(u: number): number {
  const m = Math.log(1 + u * (Math.pow(3, MAG_RANGE) - 1)) / Math.log(3); // 0..5, 3×/band
  return Math.pow(2.512, -m); // 1 … ~0.01, the flux law
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

    // #26: a few PLANETS ride along — brightest points in the sky, steady
    // (no twinkle: a planet's disc averages out the turbulence), warm-white,
    // sitting on a low-to-mid arc like the real ecliptic.
    const planetCount = 1 + Math.floor(rng() * 3); // 1..3 per seed
    const total = count + planetCount;

    const positions = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const phases = new Float32Array(total);
    const freqs = new Float32Array(total);
    const twinkles = new Float32Array(total);
    const sparkleSeeds = new Float32Array(total);
    const colors = new Float32Array(total * 3);
    const bases = new Float32Array(total); // per-star base intensity (#26 flux law)
    const halos = new Float32Array(total); // 1 = hero star/planet (core + wide halo)
    // Intro-mode baselines packed per-star:
    //   .x = random       (aPhase already, kept here for shader convenience)
    //   .y = 1 - sizeRank (brightness: big stars = low baseline = wake early)
    //   .z = heightNorm   (y on sphere normalised to 0..1; 0=south pole, 1=zenith)
    // The shader picks one component (and inverts .z for zenith-first) per mode.
    const introBaselines = new Float32Array(total * 3);

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

      const heightNorm = Math.max(0, Math.min(1, (y / r + 1) * 0.5));

      // Magnitude-law brightness (#26): ~3× stars per fainter band, 2.512×
      // flux per band. Size follows the square root so bright stars grow but
      // the flux difference is carried by intensity (aBase), not just area.
      const s = sampleBrightness(rng());
      // Hero stars (#26 slice 2): the flux law makes s > 0.55 rare (~0.5% — a
      // handful per sky). They get the Van Gogh treatment: a much larger point
      // canvas the fragment shader paints as tight core + wide faint halo.
      const hero = s > 0.55;
      halos[i] = hero ? 1 : 0;
      sizes[i] = size * (0.5 + 1.7 * Math.sqrt(s)) * (hero ? 2.6 : 1);
      bases[i] = 0.5 + 1.0 * s;

      const phase = rng();
      phases[i] = phase;
      freqs[i] = 0.4 + rng() * 1.0;
      // Twinkle amplitude (#26): scintillation is ELEVATION-driven — strong
      // through the thick air near the horizon, near-steady at zenith —
      // scaled by brightness so it reads on the stars you can actually see.
      const elevation = 0.35 + 0.65 * Math.pow(1 - heightNorm, 1.3);
      twinkles[i] = (0.15 + s * 0.85) * elevation;
      sparkleSeeds[i] = rng();

      const [cr, cg, cb] = pickStarColor(rng(), s);
      colors[i * 3 + 0] = cr;
      colors[i * 3 + 1] = cg;
      colors[i * 3 + 2] = cb;

      introBaselines[i * 3 + 0] = phase;
      introBaselines[i * 3 + 1] = 1 - s; // brightness: big stars (s near 1) first
      introBaselines[i * 3 + 2] = heightNorm;
    }

    for (let p = 0; p < planetCount; p++) {
      const i = count + p;
      const theta = rng() * Math.PI * 2;
      // Low-to-mid arc: 8°–28° above the horizon.
      const alt = (8 + rng() * 20) * (Math.PI / 180);
      const r = radius + (rng() - 0.5) * depth * 0.3;
      positions[i * 3 + 0] = r * Math.cos(alt) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(alt);
      positions[i * 3 + 2] = r * Math.cos(alt) * Math.sin(theta);
      sizes[i] = size * 2.7 * 1.8; // halo canvas — fragment paints core + glow
      bases[i] = 1.7; // outshines every star
      halos[i] = 1; // planets glow (Venus read)
      const phase = rng();
      phases[i] = phase;
      freqs[i] = 0;
      twinkles[i] = 0; // steady — the giveaway that it's a planet
      sparkleSeeds[i] = 0;
      // Warm white, slightly golden (Venus/Jupiter read).
      colors[i * 3 + 0] = 1.0;
      colors[i * 3 + 1] = 0.96;
      colors[i * 3 + 2] = 0.88;
      introBaselines[i * 3 + 0] = phase;
      introBaselines[i * 3 + 1] = 0; // brightest: wakes first in brightness mode
      introBaselines[i * 3 + 2] = Math.max(0, Math.min(1, (positions[i * 3 + 1] / r + 1) * 0.5));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aFreq", new THREE.BufferAttribute(freqs, 1));
    geo.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));
    geo.setAttribute("aSparkleSeed", new THREE.BufferAttribute(sparkleSeeds, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aBase", new THREE.BufferAttribute(bases, 1));
    geo.setAttribute("aHalo", new THREE.BufferAttribute(halos, 1));
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
    mat.name = "starField"; // so a shader error names its material

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
