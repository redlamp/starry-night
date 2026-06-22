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
// Standard mode: the moon is anchored to the sky dome centred at WORLD ORIGIN —
// the same centre StarField scatters around — so it's rigidly locked to the stars
// and rotates with them. (It used to anchor to the camera's orbit PIVOT, so a pan
// slid the moon across the star field — the reported "not locked" bug.)
//
// PHASE: a lit Lommel-Seeliger sphere (no limb darkening). The "sun" is a uniform
// DIRECTION in VIEW space (uSunDir), derived from the phase angle so the lit
// fraction + terminator are correct and stay viewer-relative (full = lit toward the
// camera, new = away) regardless of where the moon sits. No scene light → no spill
// onto the city. See wiki/research/moon-rendering.md §3.
//
// "Follow camera" debug toggle: azimuth is replaced with (camera azimuth + 180°)
// so the moon stays opposite the camera. Elevation and distance are untouched.
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

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

  // Phase: real date (sampled ONCE at mount — never in the render loop) unless the
  // user scrubs it manually. Pure function of the cycle position.
  const autoCycle = useMemo(() => cyclePositionFromDate(new Date()), []);
  const cyclePos = moon.phaseAuto ? autoCycle : moon.phaseManual;
  const phase = useMemo(() => moonPhase(cyclePos), [cyclePos]);

  const haloMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: moonHaloVertexShader,
        fragmentShader: moonHaloFragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color("#f7f1d8") },
          uInnerRadius: { value: 0.08 },
          uIntensity: { value: 1.3 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  );

  // Lit moon body — Lommel-Seeliger, colours in DISPLAY space (raw output, like the
  // halo / cityInstanced shaders), so uColor is a plain vec3 of sRGB components.
  const bodyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: moonVertexShader,
        fragmentShader: moonFragmentShader,
        uniforms: {
          uSunDir: { value: new THREE.Vector3(0, 0, 1) },
          uColor: { value: new THREE.Vector3(0.93, 0.9, 0.84) }, // warm grey, display space
          uBrightness: { value: 1.7 },
          uEarthshine: { value: 0.06 },
        },
        fog: false,
      }),
    [],
  );

  // Drive the phase uniforms (sun direction + opposition brightness + earthshine).
  // θ = elongation (0 new, π full). uSunDir in VIEW space: full → +Z (toward camera),
  // new → −Z (away), quarter → +X (lit on screen-right). Bright-limb tilt χ stays 0
  // here; the latitude-driven χ−q orientation lands in Phase 2.
  useEffect(() => {
    const theta = phase.elongation;
    (bodyMaterial.uniforms.uSunDir.value as THREE.Vector3).set(
      Math.sin(theta),
      0,
      -Math.cos(theta),
    );
    // Opposition surge: the full moon is disproportionately bright (no limb darkening
    // + backscatter). A modest boost near full, dimming off it.
    bodyMaterial.uniforms.uBrightness.value = 1.7 * (1 + 0.4 * smoothstep(0.8, 1.0, phase.fraction));
    // Earthshine grows as the crescent thins ("old moon in the new moon's arms").
    bodyMaterial.uniforms.uEarthshine.value = 0.04 + 0.1 * (1 - phase.fraction);
  }, [phase, bodyMaterial]);

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

    // Locked to the star field: anchored to the sky dome centred at WORLD ORIGIN
    // (where StarField scatters), NOT the camera's orbit pivot — so a pan no longer
    // drifts the moon across the stars.
    meshRef.current.position.set(
      horizontalRadius * Math.sin(azimuth),
      moon.distance * Math.sin(elevation),
      horizontalRadius * Math.cos(azimuth),
    );

    // Halo billboard: face camera + size/uniforms from store each frame. Intensity
    // scales with the illuminated fraction — a thin crescent barely glows, a full
    // moon blooms.
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
