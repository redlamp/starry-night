"use client";

import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, QUALITY_TIERS } from "@/lib/state/sceneStore";
import { CITY_SCALE } from "@/lib/seed/topology";
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
import { RoadRevealTicker } from "./RoadRevealTicker";
import { GroundHaze } from "./GroundHaze";
import { Roads } from "./Roads";
import { DistrictShells } from "./DistrictShells";
import { TensorFieldOverlay } from "./TensorFieldOverlay";
import { Traffic } from "./Traffic";
import { GenTrace } from "./GenTrace";
import { ShootingStars } from "./ShootingStars";
import { useGeneratedCity } from "@/lib/hooks/useGeneratedCity";

export function Scene() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const intent = useSceneStore((s) => s.cameraIntent);
  const stars = useSceneStore((s) => s.stars);
  const fog = useSceneStore((s) => s.fog);
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const dprMax = QUALITY_TIERS[qualityTier].dprMax;

  // #44: warm the heavy city-generation cache off the mount-critical path. The
  // canvas + sky / stars / moon / ground mount immediately; the city-derived
  // layers stream in one idle tick later, once their shared seeded cache is warm
  // (so each renders synchronously). Determinism is unaffected — same seed in,
  // byte-identical city out, just scheduled after first paint.
  const { ready: cityReady } = useGeneratedCity(masterSeed, cityShape, cityShapeScale);

  return (
    <Canvas
      camera={{ position: intent.position, fov: intent.fov, near: 0.5, far: 12000 * CITY_SCALE }}
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
      {/* RoadRevealTicker MUST mount before IntroTicker: useFrame runs in mount
          order, and IntroTicker's reveal gate reads sharedRoadRevealProgress —
          if the gate ran first it would see the singleton's initial 1 on the
          first frame of a cold load and fire the intro ungated. */}
      <RoadRevealTicker cityReady={cityReady} />
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
        {/* #26: zenith lifted from near-black to a saturated indigo (research:
            night reads luminous via deep blue + warm contrast, never #000). */}
        <SkyGradient horizonColor={fog.color} zenithColor="#070b22" />
        <StarField
          masterSeed={masterSeed}
          radius={stars.radius}
          depth={stars.depth}
          count={stars.count}
          size={stars.factor}
        />
        {/* #26: rare tapering streak (~every 40s), homage to the original's
            shooting stars. Shader-clocked, deterministic per seed. */}
        <ShootingStars masterSeed={masterSeed} radius={stars.radius} />
      </StarPass>

      <Moon />
      <Ground />
      {/* City-derived layers: held back until the seeded generation cache is warm
          (#44) so the first mount frame paints the sky/ground without the ~200ms
          generation stall. Once cityReady flips, every generator below hits the
          warm cache and runs synchronously. */}
      {cityReady ? (
        <>
          <Roads masterSeed={masterSeed} />
          <InstancedCity masterSeed={masterSeed} />
          <Streetlights masterSeed={masterSeed} />
          <Beacons masterSeed={masterSeed} />
          <Traffic masterSeed={masterSeed} />
          {/* Planning overlays — each respects its own visibility flag (default
              off). Highway/arterial/street tier tinting now lives in <Roads/>. */}
          <DistrictShells masterSeed={masterSeed} />
          <TensorFieldOverlay masterSeed={masterSeed} />
        </>
      ) : null}
      {/* #59 Phase B: trace mounts unconditionally so it outlives cityReady and
          can fade beneath the cascade rather than blinking out on the swap. */}
      <GenTrace masterSeed={masterSeed} />
      <FocalIndicator />
    </Canvas>
  );
}
