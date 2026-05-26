"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { generateStreetlights } from "@/lib/seed/cityGen";
import { kelvinToColor } from "@/lib/color/kelvin";
import { SCENE_WB_GAIN } from "@/lib/color/whiteBalance";
import { sharedIntroProgress } from "@/lib/shaders/sharedIntro";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { useSceneStore } from "@/lib/state/sceneStore";

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
attribute float aFailing;
attribute float aSeed;
varying float vDist;
varying vec3 vColor;
varying float vWake;
varying float vFailing;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  vColor = aColor;
  vFailing = aFailing;
  vSeed = aSeed;

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
uniform float uTime;
varying float vDist;
varying vec3 vColor;
varying float vWake;
varying float vFailing;
varying float vSeed;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);

  // Failing lamps flicker at ~3 Hz — the same step-and-hash pattern the window
  // TV cells use, so a dying streetlight reads like the rest of the scene.
  float bright = 1.0;
  if (vFailing > 0.5) {
    float tick = floor(uTime * 3.0);
    float n = hash11(tick + vSeed * 100.0);
    bright = 0.18 + n * 0.82;
  }

  float intensity = pow(core, 1.4) * 2.2 * vWake * bright;
  gl_FragColor = vec4(vColor * intensity, core * vWake * bright);
}
`;

export function Streetlights({ masterSeed }: { masterSeed: string }) {
  const { geometry, material, maxRadius } = useMemo(() => {
    const lights = generateStreetlights(masterSeed);
    const positions = new Float32Array(lights.length * 3);
    const colors = new Float32Array(lights.length * 3);
    const failing = new Float32Array(lights.length);
    const seeds = new Float32Array(lights.length);
    let maxR = 1;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      positions[i * 3 + 0] = l.x;
      positions[i * 3 + 1] = l.y;
      positions[i * 3 + 2] = l.z;
      const r = Math.hypot(l.x, l.z + 120);
      if (r > maxR) maxR = r;
      const c = applyWb(kelvinToColor(l.kelvin));
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      failing[i] = l.isFailing ? 1 : 0;
      seeds[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aFailing", new THREE.BufferAttribute(failing, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

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
        uTime: sharedTime,
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
