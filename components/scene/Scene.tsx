"use client";

import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, QUALITY_TIERS } from "@/lib/state/sceneStore";
import { InstancedCity } from "./InstancedCity";
import { Moon } from "./Moon";
import { StarField } from "./StarField";
import { StarPass } from "./StarPass";
import { SkyGradient } from "./SkyGradient";
import { Ground } from "./Ground";
import { Streetlights } from "./Streetlights";
import { Beacons } from "./Beacons";
import { CameraControls } from "./CameraControls";
import { PerfMonitor } from "./PerfMonitor";
import { TimeTicker } from "./TimeTicker";
import { ProjectionBlender } from "./ProjectionBlender";
import { FocalIndicator } from "./FocalIndicator";
import { IntroTicker } from "./IntroTicker";
import { GroundHaze } from "./GroundHaze";
import { Roads } from "./Roads";
import { DistrictShells } from "./DistrictShells";
import { TensorFieldOverlay } from "./TensorFieldOverlay";
import { Traffic } from "./Traffic";

export function Scene() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const intent = useSceneStore((s) => s.cameraIntent);
  const stars = useSceneStore((s) => s.stars);
  const fog = useSceneStore((s) => s.fog);
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const dprMax = QUALITY_TIERS[qualityTier].dprMax;

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

      {fog.enabled ? (
        fog.mode === "exp2" ? (
          <fogExp2 attach="fog" args={[fog.color, fog.density]} />
        ) : (
          <fog attach="fog" args={[fog.color, fog.near, fog.far]} />
        )
      ) : null}
      <ambientLight intensity={0.04} />

      <StarPass backgroundColor={fog.color} haze={<GroundHaze />}>
        <SkyGradient horizonColor={fog.color} zenithColor="#050a18" />
        <StarField
          masterSeed={masterSeed}
          radius={stars.radius}
          depth={stars.depth}
          count={stars.count}
          size={stars.factor}
        />
      </StarPass>

      <Moon />
      <Ground />
      <Roads masterSeed={masterSeed} />
      <InstancedCity masterSeed={masterSeed} />
      <Streetlights masterSeed={masterSeed} />
      <Beacons masterSeed={masterSeed} />
      <Traffic masterSeed={masterSeed} />
      {/* Planning overlays — each respects its own visibility flag (default off).
          Highway/arterial/street tier tinting now lives in <Roads/>. */}
      <DistrictShells masterSeed={masterSeed} />
      <TensorFieldOverlay masterSeed={masterSeed} />
      <FocalIndicator />
    </Canvas>
  );
}
