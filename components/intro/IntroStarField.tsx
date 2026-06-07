"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { deriveSeed } from "@/lib/seed/rng";
import { sharedTime } from "@/lib/shaders/sharedTime";

/**
 * Star field purpose-built for the Mac screen's orthographic pencil frustum.
 *
 * The main StarField scatters on a ~9 km dome; the intro's ortho box
 * (±160×±120 m cross-section) samples ~0.01% of it — two stars on a good
 * night. This layer scatters seeded stars on a CYLINDRICAL band just beyond
 * the city instead: every snow-globe azimuth looks through the band, so the
 * sky stays populated for the full 360° orbit and rerolls with the seed
 * (Apple badge), like the original module's fresh-random sky each run.
 *
 * Sizes are constant raster pixels (no distance attenuation — ortho + 1-bit
 * wants crisp dots); dimmer stars land in the levels knee and pick up dither
 * texture. The wake is owned LOCALLY here (its own short ramp, re-triggered
 * on seed change) rather than the shared 360s star intro — fast enough to
 * read on a demo screen, and each star fades in across a soft window so they
 * stagger on rather than pop all at once.
 */
// All stars sit on ONE cylinder shell (depth 0) — a radial spread parallaxes
// during orbit, breaking the painted-on-the-sky read. Single radius = the
// shell rotates rigidly with no near/far drift.
const CYL_RADIUS = 2600; // m — beyond the 3 km city's skyline silhouette
const CYL_Y_MIN = 20;
const CYL_Y_MAX = 700;
const WAKE_SEC = 12; // full sky in ~12s (load + every badge reroll)
const WAKE_FADE = 0.15; // per-star fade width, in wake-progress units

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aLum;
  attribute float aWake;
  attribute float aFreq;   // per-star twinkle rate
  attribute float aPhase;  // per-star phase offset (0..1)
  attribute float aAmp;    // per-star twinkle depth (0..~0.85)
  uniform float uWake;     // 0..1 local wake progress
  uniform float uTime;     // shared elapsed seconds
  varying float vLum;
  void main() {
    // each star ramps softly as uWake crosses its aWake threshold — staggered
    // appearance order + a gentle fade-in, not a hard pop
    float wake = smoothstep(aWake, aWake + ${WAKE_FADE.toFixed(2)}, uWake);
    // twinkle: a per-star sine dipping the luminance. Depth reaches far enough
    // that high-amp stars dip below the 1-bit white point and blink via the
    // threshold/dither — the authentic Mac starfield shimmer, not a smooth fade.
    float tw = 1.0 - aAmp * (0.5 + 0.5 * sin(uTime * aFreq + aPhase * 6.2831853));
    vLum = aLum * wake * tw;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
  }
`;

const FRAG = /* glsl */ `
  varying float vLum;
  void main() {
    if (vLum <= 0.001) discard;
    gl_FragColor = vec4(vec3(vLum), 1.0);
  }
`;

export function IntroStarField({
  masterSeed,
  count = 24000,
}: {
  masterSeed: string;
  count?: number;
}) {
  const geometry = useMemo(() => {
    const rng = deriveSeed(masterSeed, "intro-stars");
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const lum = new Float32Array(count);
    const wake = new Float32Array(count);
    const freq = new Float32Array(count);
    const phase = new Float32Array(count);
    const amp = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const az = rng() * Math.PI * 2;
      pos[i * 3] = Math.cos(az) * CYL_RADIUS;
      pos[i * 3 + 1] = CYL_Y_MIN + rng() * (CYL_Y_MAX - CYL_Y_MIN);
      pos[i * 3 + 2] = Math.sin(az) * CYL_RADIUS;
      const s = rng();
      size[i] = 1 + 2.5 * s * s; // mostly single-pixel, a few heroes
      lum[i] = 0.35 + 0.65 * rng(); // dim tail dithers in the 1-bit knee
      // wake order, capped so the +WAKE_FADE ramp still completes by uWake=1
      wake[i] = rng() * (1 - WAKE_FADE);
      freq[i] = 0.6 + rng() * 2.2; // slow shimmer .. brisk sparkle
      phase[i] = rng();
      amp[i] = 0.25 + rng() * 0.6; // some barely flicker, some blink hard
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aLum", new THREE.BufferAttribute(lum, 1));
    geo.setAttribute("aWake", new THREE.BufferAttribute(wake, 1));
    geo.setAttribute("aFreq", new THREE.BufferAttribute(freq, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aAmp", new THREE.BufferAttribute(amp, 1));
    return geo;
  }, [masterSeed, count]);

  // local wake uniform: ramps 0→1 over WAKE_SEC, reset on every seed change
  // (load + Apple-badge reroll) so the sky fades in fresh each time
  const uWake = useMemo(() => ({ value: 0 }), []);
  useEffect(() => {
    uWake.value = 0;
  }, [uWake, masterSeed]);
  useFrame((_, delta) => {
    if (uWake.value < 1) uWake.value = Math.min(1, uWake.value + delta / WAKE_SEC);
  });

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        // uTime is the shared singleton the intro's TimeTicker advances
        uniforms: { uWake, uTime: sharedTime },
        depthWrite: false,
      }),
    [uWake],
  );

  return <points geometry={geometry} material={material} />;
}
