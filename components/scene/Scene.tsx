"use client";

import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { InstancedCity } from "./InstancedCity";
import { Moon } from "./Moon";
import { Ground } from "./Ground";
import { Streetlights } from "./Streetlights";
import { CameraControls } from "./CameraControls";
import { PerfMonitor } from "./PerfMonitor";
import { TimeTicker } from "./TimeTicker";
import { ProjectionBlender } from "./ProjectionBlender";
import { FocalIndicator } from "./FocalIndicator";
import { IntroTicker } from "./IntroTicker";
import { GroundHaze } from "./GroundHaze";

export function Scene() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const intent = useSceneStore((s) => s.cameraIntent);
  const stars = useSceneStore((s) => s.stars);
  const fog = useSceneStore((s) => s.fog);

  return (
    <Canvas
      camera={{ position: intent.position, fov: intent.fov, near: 0.5, far: 12000 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      dpr={[1, 2]}
      style={{ touchAction: "none" }}
    >
      <CameraControls />
      <ProjectionBlender />
      <PerfMonitor />
      <TimeTicker />
      <IntroTicker />

      <color attach="background" args={[fog.color]} />
      {fog.enabled ? (
        fog.mode === "exp2" ? (
          <fogExp2 attach="fog" args={[fog.color, fog.density]} />
        ) : (
          <fog attach="fog" args={[fog.color, fog.near, fog.far]} />
        )
      ) : null}
      <ambientLight intensity={0.04} />

      <Stars
        radius={stars.radius}
        depth={stars.depth}
        count={stars.count}
        factor={stars.factor}
        saturation={0}
        fade
        speed={0}
      />

      <Moon />
      <Ground />
      <GroundHaze />
      <InstancedCity masterSeed={masterSeed} />
      <Streetlights masterSeed={masterSeed} />
      <FocalIndicator />
    </Canvas>
  );
}
