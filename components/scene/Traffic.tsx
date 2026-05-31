"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { buildTraffic } from "@/lib/seed/traffic";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { trafficVertexShader, trafficFragmentShader } from "@/lib/shaders/traffic";

// Ambient car head/tail-lights flowing along the road network (research D).
// Deterministic per seed; GPU-animated off the shared clock (no per-frame CPU).
// Off by default — an opt-in effect, toggled from the Traffic panel section.
const SIZE_SCALE = 1.0; // global point-size multiplier (visual-tuning knob)
const INTENSITY = 2.2; // emissive boost for ACES bloom

export function Traffic({ masterSeed }: { masterSeed: string }) {
  const enabled = useSceneStore((s) => s.traffic.enabled);
  const density = useSceneStore((s) => s.traffic.density);
  const highway = useSceneStore((s) => s.traffic.highway);
  const arterial = useSceneStore((s) => s.traffic.arterial);
  const minor = useSceneStore((s) => s.traffic.minor);

  const points = useMemo(() => {
    const t = buildTraffic(masterSeed, density, { highway, arterial, minor });
    const geo = new THREE.BufferGeometry();
    // `position` only defines the draw count; the real location is computed in
    // the vertex shader from aA/aB. Use aA so any bounds query is sane.
    geo.setAttribute("position", new THREE.BufferAttribute(t.aA.slice(), 3));
    geo.setAttribute("aA", new THREE.BufferAttribute(t.aA, 3));
    geo.setAttribute("aB", new THREE.BufferAttribute(t.aB, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(t.aPhase, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(t.aSpeed, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(t.aColor, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(t.aSize, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: trafficVertexShader,
      fragmentShader: trafficFragmentShader,
      uniforms: {
        uTime: sharedTime,
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
        uSizeScale: { value: SIZE_SCALE },
        uIntensity: { value: INTENSITY },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; // positions live in the shader; bounds are unknown
    return pts;
  }, [masterSeed, density, highway, arterial, minor]);

  useEffect(() => {
    return () => {
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    };
  }, [points]);

  if (!enabled) return null;
  return <primitive object={points} />;
}
