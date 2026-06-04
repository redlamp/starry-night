"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { deriveSeed } from "@/lib/seed/rng";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { shootingStarVertexShader, shootingStarFragmentShader } from "@/lib/shaders/shootingStar";
import { STAR_FOV } from "./StarPass";

// Rare shooting star (#26 slice 2) — one tapering streak at a time, animated
// in the shader off the shared clock (see lib/shaders/shootingStar.ts).
// Scheduling is CPU-side: each fired streak rolls the NEXT gap uniformly in
// [shootingMin, shootingMax] off a seeded rng chain — deterministic per
// masterSeed, no Math.random at runtime.

const TRAIL = 14; // sprites along the streak
const DURATION = 1.1; // streak lifetime (s) — mirrors the shader constant

function seedToFloat(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function ShootingStars({ masterSeed, radius }: { masterSeed: string; radius: number }) {
  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(TRAIL * 3); // real positions live in the shader
    const trail = new Float32Array(TRAIL);
    for (let i = 0; i < TRAIL; i++) trail[i] = i / (TRAIL - 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aTrail", new THREE.BufferAttribute(trail, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: shootingStarVertexShader,
      fragmentShader: shootingStarFragmentShader,
      uniforms: {
        uTime: sharedTime,
        uSeed: { value: seedToFloat(masterSeed) * 100 },
        uRadius: { value: radius },
        uFireTime: { value: -10 }, // nothing alive until the scheduler fires
        uFireSeed: { value: 0 },
        uEnabled: { value: 1 },
        uBaseSize: { value: 144 },
        uCamAz: { value: 0 },
        uAzHalf: { value: 0.6 },
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
        },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    mat.name = "shootingStars"; // so a shader error names its material
    return { geometry: geo, material: mat };
  }, [masterSeed, radius]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Master toggle + size (#26). Gap range is consumed by the scheduler below.
  const minGap = useSceneStore((s) => s.stars.shootingMin);
  const maxGap = useSceneStore((s) => s.stars.shootingMax);
  const enabled = useSceneStore((s) => s.stars.meteorsEnabled);
  const starFactor = useSceneStore((s) => s.stars.factor);
  useEffect(() => {
    material.uniforms.uEnabled.value = enabled ? 1 : 0;
    // Planet-scale head (~10px on screen after the 300/d dome attenuation) —
    // a star-sized streak is imperceptible among 24k twinkling stars. Riding
    // the stars' size factor keeps it proportional at any dome size.
    material.uniforms.uBaseSize.value = Math.max(60, starFactor * 4);
  }, [material, enabled, starFactor]);

  const skyHidden = useSceneStore((s) => s.debug.renderModes.sky === "hidden");

  // Scheduler + spawn wedge. Each fire: push start time + streak index to the
  // shader, sample the camera's view azimuth (so the streak spawns INSIDE the
  // frame yet stays world-fixed for its ~1s life — no dragging with the
  // orbit), then roll the next gap uniformly in [min, max] off the seeded rng
  // chain. Projection-agnostic — the star pass copies only the main camera's
  // quaternion. Determinism: gap sequence + shape are seeded; azimuth anchors
  // to framing, the same presentation tier as camera state.
  const rng = useMemo(() => deriveSeed(masterSeed, "meteors"), [masterSeed]);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const sched = useRef<{ next: number; idx: number } | null>(null);
  useEffect(() => {
    sched.current = null; // new seed → restart the gap chain
  }, [rng]);
  useFrame(({ camera, size }) => {
    const u = material.uniforms;
    const time = u.uTime.value as number;
    // Star-camera horizontal half-fov minus a margin, so the whole travel arc
    // tends to stay on screen.
    const hHalf = Math.atan(
      Math.tan((STAR_FOV / 2) * (Math.PI / 180)) * (size.width / Math.max(1, size.height)),
    );
    u.uAzHalf.value = Math.max(0.25, hHalf - 0.3);

    const lo = Math.max(0.01, Math.min(minGap, maxGap));
    const hi = Math.max(lo, maxGap);
    const roll = () => lo + rng() * (hi - lo);
    if (!sched.current) sched.current = { next: time + roll(), idx: 0 };
    const s = sched.current;
    if (time >= s.next) {
      s.next = Math.max(s.next, time - DURATION); // resync after a long stall
      u.uFireTime.value = s.next;
      u.uFireSeed.value = ++s.idx;
      camera.getWorldDirection(camDir);
      u.uCamAz.value = Math.atan2(camDir.z, camDir.x);
      // Next start = this start + rolled gap, floored at one lifetime so
      // consecutive streaks never overlap (single-streak design).
      s.next += Math.max(DURATION + 0.05, roll());
    }
  });

  return (
    <points geometry={geometry} material={material} frustumCulled={false} visible={!skyHidden} />
  );
}
