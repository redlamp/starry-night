"use client";

import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, QUALITY_TIERS } from "@/lib/state/sceneStore";
import { InstancedCity } from "./InstancedCity";
import { Moon } from "./Moon";
import { StarField } from "./StarField";
import { Ground } from "./Ground";
import { Streetlights } from "./Streetlights";
import { CameraControls } from "./CameraControls";
import { PerfMonitor } from "./PerfMonitor";
import { TimeTicker } from "./TimeTicker";
import { ProjectionBlender } from "./ProjectionBlender";
import { FocalIndicator } from "./FocalIndicator";
import { IntroTicker } from "./IntroTicker";
import { GroundHaze } from "./GroundHaze";
import { Highways } from "./Highways";
import { Arterials } from "./Arterials";
import { DistrictShells } from "./DistrictShells";
import { useStage1Flag } from "@/lib/state/stageFlag";

export function Scene() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const intent = useSceneStore((s) => s.cameraIntent);
  const stars = useSceneStore((s) => s.stars);
  const fog = useSceneStore((s) => s.fog);
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const dprMax = QUALITY_TIERS[qualityTier].dprMax;
  const stage1 = useStage1Flag();

  return (
    <Canvas
      camera={{ position: intent.position, fov: intent.fov, near: 0.5, far: 12000 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      dpr={[1, dprMax]}
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

      <StarField
        masterSeed={masterSeed}
        radius={stars.radius}
        depth={stars.depth}
        count={stars.count}
        size={1.5}
      />

      <Moon />
      <Ground />
      <GroundHaze />
      <InstancedCity masterSeed={masterSeed} />
      <Streetlights masterSeed={masterSeed} />
      {stage1 ? (
        <>
          <DistrictShells masterSeed={masterSeed} />
          <Highways masterSeed={masterSeed} />
          <Arterials masterSeed={masterSeed} />
        </>
      ) : null}
      <FocalIndicator />
    </Canvas>
  );
}
