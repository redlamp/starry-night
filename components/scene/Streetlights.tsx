"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import seedrandom from "seedrandom";
import { generateStreetlights } from "@/lib/seed/cityGen";
import { kelvinToColor } from "@/lib/color/kelvin";
import { SCENE_WB_GAIN } from "@/lib/color/whiteBalance";
import { sharedIntroProgress } from "@/lib/shaders/sharedIntro";
import { useSceneStore } from "@/lib/state/sceneStore";

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
uniform float uIntroProgress;
uniform vec3 uIntroCityCenter;
uniform float uIntroMaxRadius;
attribute vec3 aColor;
varying float vDist;
varying vec3 vColor;
varying float vWake;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  vColor = aColor;

  // Center-out wake: closer to city centre = lights first.
  vec2 d = position.xz - uIntroCityCenter.xz;
  float r = clamp(length(d) / max(1.0, uIntroMaxRadius), 0.0, 1.0);
  float threshold = r * 0.7;
  vWake = smoothstep(threshold, threshold + 0.08, uIntroProgress);

  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(2.0, uBaseSize * uPixelRatio * (180.0 / vDist));
}
`;

const fragmentShader = /* glsl */ `
varying float vDist;
varying vec3 vColor;
varying float vWake;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  float intensity = pow(core, 1.4) * 2.2 * vWake;
  gl_FragColor = vec4(vColor * intensity, core * vWake);
}
`;

export function Streetlights({ masterSeed }: { masterSeed: string }) {
  const { geometry, material, maxRadius } = useMemo(() => {
    const lights = generateStreetlights(masterSeed);
    const positions = new Float32Array(lights.length * 3);
    const colors = new Float32Array(lights.length * 3);
    const sodiumColor = applyWb(kelvinToColor(SODIUM_K));
    const ledColor = applyWb(kelvinToColor(LED_K));
    const rng = seedrandom(`${masterSeed}::streetlights::mix`);
    let maxR = 1;
    for (let i = 0; i < lights.length; i++) {
      positions[i * 3 + 0] = lights[i].x;
      positions[i * 3 + 1] = lights[i].y;
      positions[i * 3 + 2] = lights[i].z;
      const r = Math.hypot(lights[i].x, lights[i].z + 120);
      if (r > maxR) maxR = r;
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
        uIntroProgress: sharedIntroProgress,
        uIntroCityCenter: { value: new THREE.Vector3() },
        uIntroMaxRadius: { value: maxR },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    return { geometry: geo, material: mat, maxRadius: maxR };
  }, [masterSeed]);

  useFrame(() => {
    const s = useSceneStore.getState();
    material.uniforms.uIntroCityCenter.value.set(s.orbit.centerX, 0, s.orbit.centerZ);
    material.uniforms.uIntroMaxRadius.value = maxRadius;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
