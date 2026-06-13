"use client";

import { useState } from "react";
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
import { DreiSceneControls } from "./DreiSceneControls";
import { ScreenYGuide } from "./ScreenYGuide";
import { PerfMonitor } from "./PerfMonitor";
import { TimeTicker } from "./TimeTicker";
import { ProjectionBlender } from "./ProjectionBlender";
import { FocalIndicator } from "./FocalIndicator";
import { IntroTicker } from "./IntroTicker";
import { FogTicker } from "./FogTicker";
import { FogBoundsMarkers } from "./FogBoundsMarkers";
import { GroundHaze } from "./GroundHaze";
import { Roads } from "./Roads";
import { DistrictShells } from "./DistrictShells";
import { PopulationHeatmap } from "./PopulationHeatmap";
import { TensorFieldOverlay } from "./TensorFieldOverlay";
import { TileCullOverlay } from "./TileCullOverlay";
import { Traffic } from "./Traffic";
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

  // The drei <CameraControls> bridge (DreiSceneControls — Google-Maps input model) is now the
  // DEFAULT for ORBIT. fly / still aren't ported to the bridge yet (Phase 3 / sub-step D), so
  // they fall back to the old controller; `?controls=legacy` (or `=old`) forces the old
  // controller for every mode. Read in a useState initialiser (client-only WebGL) so it can't
  // cause a hydration mismatch.
  const [controlsFlag] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("controls")
      : null,
  );
  const legacyControls = controlsFlag === "legacy" || controlsFlag === "old";
  const cameraMode = useSceneStore((s) => s.cameraMode);
  // drei owns orbit unless forced legacy. Keep DreiSceneControls MOUNTED across modes (it
  // self-gates to orbit and goes inert otherwise) so its once-per-mount "pin perspective"
  // entry effect doesn't re-fire each time you return to orbit; the old controller mounts only
  // for fly / still (or all modes in legacy).
  const dreiOrbit = !legacyControls && cameraMode === "orbit";
  const oldController = legacyControls || cameraMode !== "orbit";

  // #44: warm the heavy city-generation cache off the mount-critical path. The
  // canvas + sky / stars / moon / ground mount immediately; the city-derived
  // layers stream in one idle tick later, once their shared seeded cache is warm
  // (so each renders synchronously). Determinism is unaffected — same seed in,
  // byte-identical city out, just scheduled after first paint.
  const { ready: cityReady } = useGeneratedCity(masterSeed, cityShape, cityShapeScale);

  return (
    <>
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
        {!legacyControls && <DreiSceneControls />}
        {oldController && <CameraControls />}
        <ProjectionBlender />
        <PerfMonitor />
        <TimeTicker />
        {/* City cascade waits for cityReady (user 2026-06-08) — see IntroTicker. */}
        <IntroTicker cityReady={cityReady} />
        <FogTicker />
        <FogBoundsMarkers />

        {/* near/far/density args are placeholders — FogTicker re-derives them
          every frame around the camera→city-centre distance (city-anchored
          fog), so only the colour matters here. */}
        {fog.enabled ? (
          fog.mode === "exp2" ? (
            <fogExp2 attach="fog" args={[fog.color, 0.0001]} />
          ) : (
            <fog attach="fog" args={[fog.color, 1, 10]} />
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
        {/* While the worker generates, the scene stays dark (ground + stars) and
          the city pops in whole when the bundle lands. The old GenTrace overlay
          (#59 streamed "city sketches itself" lines) read as stray bright
          scribbles over the intro — removed; the worker stream + cityGenClient
          subscribe API stay for the road-reveal choreography to consume. */}
        {cityReady && (
          <>
            <Roads masterSeed={masterSeed} />
            <InstancedCity masterSeed={masterSeed} />
            <Streetlights masterSeed={masterSeed} />
            <Beacons masterSeed={masterSeed} />
            <Traffic masterSeed={masterSeed} />
            {/* Planning overlays — each respects its own visibility flag (default
              off). Highway/arterial/street tier tinting now lives in <Roads/>. */}
            <DistrictShells masterSeed={masterSeed} />
            <PopulationHeatmap masterSeed={masterSeed} />
            <TensorFieldOverlay masterSeed={masterSeed} />
            <TileCullOverlay masterSeed={masterSeed} />
          </>
        )}
        {/* old controller's store-based indicator; the drei bridge renders its own
          live one (tracks the camera-controls target with no throttle lag) */}
        {oldController && <FocalIndicator />}
      </Canvas>
      {dreiOrbit && <ScreenYGuide />}
    </>
  );
}
