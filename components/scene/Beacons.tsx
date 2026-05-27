"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { generateAviationBeacons } from "@/lib/seed/cityGen";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { sharedIntroProgress } from "@/lib/shaders/sharedIntro";

// Blinking red aviation obstruction lights on skyscraper tops. One additive
// Points cloud, deterministic flash from (uTime, aPhase) per the no-wall-clock
// rule. Sits at city scale (inside the ortho frame), so unlike the star field
// it needs no separate projection pass.

const vertexShader = /* glsl */ `
uniform float uPixelRatio;
uniform float uBaseSize;
attribute float aPhase;
varying float vDist;
varying float vPhase;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  vPhase = aPhase;
  gl_Position = projectionMatrix * mv;
  // Floor of 3px so a distant beacon still reads from orbit range; cap so a
  // close fly-by doesn't balloon into a blob.
  gl_PointSize = clamp(uBaseSize * uPixelRatio * (180.0 / vDist), 10.0, 28.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uPeriod;
uniform float uIntroProgress;
varying float vDist;
varying float vPhase;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);

  // Sharp flash for the first slice of each period, then dark — with a faint
  // always-on ember so the beacon never fully vanishes between flashes.
  float ph = fract(uTime / uPeriod + vPhase);
  float flash = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.18, 0.5, ph));
  float level = 0.55 + 0.45 * flash;

  // Fade in early with the city wake-up (low threshold so the gate never hides
  // a beacon once the lights are on).
  float wake = smoothstep(0.1, 0.4, uIntroProgress);

  // Emissive > 1 so the red blooms under ACES.
  float intensity = pow(core, 1.3) * 4.5 * level * wake;
  vec3 red = vec3(1.0, 0.1, 0.06);
  gl_FragColor = vec4(red * intensity, core * level * wake);
}
`;

export function Beacons({ masterSeed }: { masterSeed: string }) {
  const { geometry, material } = useMemo(() => {
    const beacons = generateAviationBeacons(masterSeed);
    const positions = new Float32Array(beacons.length * 3);
    const phases = new Float32Array(beacons.length);
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i];
      positions[i * 3 + 0] = b.x;
      positions[i * 3 + 1] = b.y;
      positions[i * 3 + 2] = b.z;
      phases[i] = b.phase;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uBaseSize: { value: 8 },
        uPeriod: { value: 1.6 },
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
        uTime: sharedTime,
        uIntroProgress: sharedIntroProgress,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    return { geometry: geo, material: mat };
  }, [masterSeed]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
