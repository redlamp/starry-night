"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { generateStreetlights } from "@/lib/seed/cityGen";

const STREETLIGHT_COLOR = new THREE.Color("#ffc060");

const vertexShader = /* glsl */ `
uniform float uPixelRatio;
uniform float uBaseSize;
varying float vDist;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  // Attenuated size with floor so distant lights don't disappear
  gl_PointSize = max(2.0, uBaseSize * uPixelRatio * (180.0 / vDist));
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vDist;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  // Soft disc with glow falloff
  float core = smoothstep(0.5, 0.0, d);
  float intensity = pow(core, 1.4) * 2.2;
  gl_FragColor = vec4(uColor * intensity, core);
}
`;

export function Streetlights({ masterSeed }: { masterSeed: string }) {
  const { geometry, material } = useMemo(() => {
    const lights = generateStreetlights(masterSeed);
    const positions = new Float32Array(lights.length * 3);
    for (let i = 0; i < lights.length; i++) {
      positions[i * 3 + 0] = lights[i].x;
      positions[i * 3 + 1] = lights[i].y;
      positions[i * 3 + 2] = lights[i].z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: STREETLIGHT_COLOR },
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
