"use client";

import { useMemo } from "react";
import * as THREE from "three";
import seedrandom from "seedrandom";
import { generateStreetlights } from "@/lib/seed/cityGen";
import { kelvinToColor } from "@/lib/color/kelvin";
import { SCENE_WB_GAIN } from "@/lib/color/whiteBalance";

// Real-city mix: 80% sodium HPS (older retrofits), 20% modern LED.
// Per wiki/research/color-usage-night-skyline.md item 11.
const SODIUM_K = 2000;
const LED_K = 4000;
const LED_RATIO = 0.2;

function applyWb(c: THREE.Color): THREE.Color {
  return new THREE.Color(
    Math.min(1, c.r * SCENE_WB_GAIN.x),
    Math.min(1, c.g * SCENE_WB_GAIN.y),
    Math.min(1, c.b * SCENE_WB_GAIN.z),
  );
}

const vertexShader = /* glsl */ `
uniform float uPixelRatio;
uniform float uBaseSize;
attribute vec3 aColor;
varying float vDist;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(2.0, uBaseSize * uPixelRatio * (180.0 / vDist));
}
`;

const fragmentShader = /* glsl */ `
varying float vDist;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  float intensity = pow(core, 1.4) * 2.2;
  gl_FragColor = vec4(vColor * intensity, core);
}
`;

export function Streetlights({ masterSeed }: { masterSeed: string }) {
  const { geometry, material } = useMemo(() => {
    const lights = generateStreetlights(masterSeed);
    const positions = new Float32Array(lights.length * 3);
    const colors = new Float32Array(lights.length * 3);
    const sodiumColor = applyWb(kelvinToColor(SODIUM_K));
    const ledColor = applyWb(kelvinToColor(LED_K));
    const rng = seedrandom(`${masterSeed}::streetlights::mix`);
    for (let i = 0; i < lights.length; i++) {
      positions[i * 3 + 0] = lights[i].x;
      positions[i * 3 + 1] = lights[i].y;
      positions[i * 3 + 2] = lights[i].z;
      const isLed = rng() < LED_RATIO;
      const c = isLed ? ledColor : sodiumColor;
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uBaseSize: { value: 6 },
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    return { geometry: geo, material: mat };
  }, [masterSeed]);

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
