"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { moonHaloVertexShader, moonHaloFragmentShader } from "@/lib/shaders/moonHalo";
import { moonVertexShader, moonFragmentShader } from "@/lib/shaders/moon";
import { moonPhase, cyclePositionFromDate } from "@/lib/moon/phase";

// Moon as a celestial body on the sky dome, LOCKED to the star field.
// Sliders express where it sits in the sky, not its world coords:
//   - azimuthDeg   — compass yaw around the dome axis (0 = +z, 90 = +x)
//   - elevationDeg — angle above the horizon (0 = horizon, 90 = zenith)
//   - distance     — radial distance from the dome centre; defaults to the star
//                    shell radius so the moon sits ON the celestial sphere
//
// Anchored to the sky dome centred at WORLD ORIGIN (where StarField scatters), so it
// is rigidly locked to the stars (it used to anchor to the camera's orbit pivot, so a
// pan slid it across the field — the reported bug).
//
// STYLIZED phase: a flat-toned lit sphere with a sharp/graphic terminator (crisp /
// dither / cel, picked by moon.terminatorStyle). The "sun" is a view-space uSunDir
// uniform from the phase angle (full = lit toward camera, new = away), so the phase is
// correct from any camera angle with no light-spill onto the city. The halo glow is
// biased to the lit limb by the same uSunDir. See wiki/research/moon-rendering.md §3.
//
// "Follow camera" debug toggle: azimuth = (camera azimuth + 180°) so the moon stays
// opposite the camera. Elevation and distance are untouched.
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TERM_STYLE_IDX: Record<string, number> = { crisp: 0, dither: 1, cel: 2 };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function Moon() {
  const meshRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const followCamera = useSceneStore((s) => s.moonFollowCamera);
  const starsRadius = useSceneStore((s) => s.stars.radius);
  const moon = useSceneStore((s) => s.moon);
  const moonMode = useSceneStore((s) => s.debug.renderModes.moon);
  const setMoonLive = useSceneStore((s) => s.setMoonLive);
  const lastWrite = useRef(0);

  // Phase: real date (sampled ONCE at mount — never in the render loop) unless scrubbed.
  const autoCycle = useMemo(() => cyclePositionFromDate(new Date()), []);
  const cyclePos = moon.phaseAuto ? autoCycle : moon.phaseManual;
  const phase = useMemo(() => moonPhase(cyclePos), [cyclePos]);
  const termIdx = TERM_STYLE_IDX[moon.terminatorStyle] ?? 0;

  const haloMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: moonHaloVertexShader,
        fragmentShader: moonHaloFragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color("#f7f1d8") },
          uInnerRadius: { value: 0.08 },
          uIntensity: { value: 1.3 },
          uSunDir: { value: new THREE.Vector3(0, 0, 1) },
          uDarkFade: { value: 0.03 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  );

  // Lit moon body — flat tone, display space (raw output, so uColor is a plain vec3
  // of sRGB components, like the halo / cityInstanced shaders).
  const bodyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: moonVertexShader,
        fragmentShader: moonFragmentShader,
        uniforms: {
          uSunDir: { value: new THREE.Vector3(0, 0, 1) },
          uColor: { value: new THREE.Vector3(0.96, 0.95, 0.88) }, // warm cream, display space
          uBrightness: { value: 1.0 },
          uTermStyle: { value: 0 },
          uSharpness: { value: 0.7 },
        },
        fog: false,
      }),
    [],
  );

  // Phase → sun direction (body + halo), opposition brightness, earthshine.
  // θ = elongation (0 new, π full). uSunDir in VIEW space: full → +Z (toward camera),
  // new → −Z (away), quarter → +X (lit on screen-right).
  useEffect(() => {
    const theta = phase.elongation;
    const sx = Math.sin(theta);
    const sz = -Math.cos(theta);
    (bodyMaterial.uniforms.uSunDir.value as THREE.Vector3).set(sx, 0, sz);
    (haloMaterial.uniforms.uSunDir.value as THREE.Vector3).set(sx, 0, sz);
    bodyMaterial.uniforms.uBrightness.value = 1.0 * (1 + 0.4 * smoothstep(0.8, 1.0, phase.fraction));
  }, [phase, bodyMaterial, haloMaterial]);

  // Terminator style + edge sharpness.
  useEffect(() => {
    bodyMaterial.uniforms.uTermStyle.value = termIdx;
    bodyMaterial.uniforms.uSharpness.value = moon.edgeSharpness;
  }, [termIdx, moon.edgeSharpness, bodyMaterial]);

  // Debug render mode: wireframe toggles on the body material.
  useEffect(() => {
    bodyMaterial.wireframe = moonMode === "wireframe";
  }, [moonMode, bodyMaterial]);

  const moonRadius = starsRadius * moon.radiusRatio;

  useFrame(() => {
    if (!meshRef.current) return;
    const s = useSceneStore.getState();
    const haloCfg = s.moonHalo;

    let azimuth = moon.azimuthDeg * DEG2RAD;
    if (followCamera) {
      // Debug: keep the moon opposite the camera. Azimuth measured around the dome
      // centre (world origin), matching the locked placement below.
      const camAzimuth = Math.atan2(camera.position.x, camera.position.z);
      azimuth = camAzimuth + Math.PI;
    }
    const elevation = moon.elevationDeg * DEG2RAD;
    const horizontalRadius = moon.distance * Math.cos(elevation);

    // Locked to the star field: anchored to the sky dome centred at WORLD ORIGIN, NOT
    // the camera's orbit pivot — so a pan no longer drifts the moon across the stars.
    meshRef.current.position.set(
      horizontalRadius * Math.sin(azimuth),
      moon.distance * Math.sin(elevation),
      horizontalRadius * Math.cos(azimuth),
    );

    // Halo billboard: face camera + size/uniforms from store each frame. Intensity
    // scales with the illuminated fraction (thin crescent barely glows, full blooms);
    // the lit-side bias lives in the halo shader (uSunDir).
    if (haloRef.current) {
      haloRef.current.lookAt(camera.position);
      const haloSize = moonRadius * haloCfg.radiusMul * 2;
      haloRef.current.scale.set(haloSize, haloSize, 1);
      haloMaterial.uniforms.uInnerRadius.value = haloCfg.innerRadius;
      haloMaterial.uniforms.uIntensity.value = haloCfg.intensity * (0.15 + 0.85 * phase.fraction);
    }

    const now = performance.now();
    if (now - lastWrite.current >= 100) {
      lastWrite.current = now;
      const p = meshRef.current.position;
      setMoonLive({
        position: [p.x, p.y, p.z],
        azimuthDeg: (((azimuth * RAD2DEG) % 360) + 360) % 360,
        elevationDeg: moon.elevationDeg,
        distance: moon.distance,
      });
    }
  });

  // Debug "moon" group (Slice B): Hidden drops the moon + halo; Wireframe
  // renders the lunar sphere as edges (halo billboard left as-is).
  return (
    <mesh ref={meshRef} material={bodyMaterial} visible={moonMode !== "hidden"}>
      <sphereGeometry args={[moonRadius, 48, 48]} />
      <mesh ref={haloRef} material={haloMaterial} renderOrder={-1}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </mesh>
  );
}
