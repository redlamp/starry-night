"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, QUALITY_TIERS } from "@/lib/state/sceneStore";
import { CITY_SCALE, CITY_CENTER } from "@/lib/seed/topology";
import { cropFollowScale } from "@/lib/scene/cameraView";
import { InstancedCity } from "./InstancedCity";
import { Moon } from "./Moon";
import { StarField } from "./StarField";
import { StarPass } from "./StarPass";
import { SkyGradient } from "./SkyGradient";
import { Ground } from "./Ground";
import { Streetlights } from "./Streetlights";
import { Beacons } from "./Beacons";
import { CameraControls } from "./CameraControls";
import { CameraModelHost } from "./camera-models/CameraModelHost";
import { ScreenYGuide } from "./ScreenYGuide";
import { PerfMonitor } from "./PerfMonitor";
import { AdaptiveQuality } from "./AdaptiveQuality";
import { CityReveal } from "./CityReveal";
import { TimeTicker } from "./TimeTicker";
import { ProjectionBlender } from "./ProjectionBlender";
import { OrthoPickingFix } from "./OrthoPickingFix";
import { FocalIndicator } from "./FocalIndicator";
import { IntroTicker } from "./IntroTicker";
import { FogTicker } from "./FogTicker";
import { FogBoundsMarkers } from "./FogBoundsMarkers";
import { PinPlaneMarker } from "./PinPlaneMarker";
import { BuildingPin } from "./BuildingPin";
import { SelectedDistrictOutline } from "./SelectedDistrictOutline";
import { SelectedBuildingOutline } from "./SelectedBuildingOutline";
import { CommuteArc } from "./CommuteArc";
import { RoadHover } from "./RoadHover";
import { StreetHighlight } from "./StreetHighlight";
import { InspectCursor } from "./InspectCursor";
import { GroundHaze } from "./GroundHaze";
import { Roads } from "./Roads";
import { DistrictShells } from "./DistrictShells";
import { PopulationHeatmap } from "./PopulationHeatmap";
import { TrafficDensityOverlay } from "./TrafficDensityOverlay";
import { TensorFieldOverlay } from "./TensorFieldOverlay";
import { TileCullOverlay } from "./TileCullOverlay";
import { Traffic } from "./Traffic";
import { Flights } from "./Flights";
import { FlightRoutes } from "./FlightRoutes";
import { HelicopterRoutes } from "./HelicopterRoutes";
import { Helicopters } from "./Helicopters";
import { ShootingStars } from "./ShootingStars";
import { useGeneratedCity } from "@/lib/hooks/useGeneratedCity";

export function Scene() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const intent = useSceneStore((s) => s.cameraIntent);
  const stars = useSceneStore((s) => s.stars);
  const fog = useSceneStore((s) => s.fog);
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const dprMax = QUALITY_TIERS[qualityTier].dprMax;
  // MSAA (off by default) — a context-creation flag, so it can't change live; the
  // `key` remounts the canvas (brief re-init) when it's toggled. DPR cap is live.
  const antialias = useSceneStore((s) => s.antialias);
  const dprCap = useSceneStore((s) => s.dprCap);

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
  // The CameraModelHost mounts the selected camera MODEL (Settings → Camera): Map / Drift /
  // Turntable / Top-down are orbit-rig models, Fly is free flight. cameraMode is kept in sync
  // (fly → "fly", else "orbit") so the orbit models' self-gate and the framing helpers still
  // read it. The legacy controller now only covers Still (capture) + the ?controls=legacy
  // escape hatch.
  const dreiOrbit = !legacyControls && cameraMode === "orbit";
  const oldController = legacyControls || cameraMode === "still";

  // #44: warm the heavy city-generation cache off the mount-critical path. The
  // canvas + sky / stars / moon / ground mount immediately; the city-derived
  // layers stream in one idle tick later, once their shared seeded cache is warm
  // (so each renders synchronously). Determinism is unaffected — same seed in,
  // byte-identical city out, just scheduled after first paint.
  // #70: no `cityShapeScale` arg — the gate no longer bounces on a crop notch
  // (see useGeneratedCity's MAX_SCALE comment), so InstancedCity and its
  // siblings below stay mounted (and the intro cascade doesn't replay) across one.
  const { ready: cityReady } = useGeneratedCity(masterSeed, cityShape);

  // Boot-time-only camera position (#56 crop-follow): StarryNightV2Model's mount
  // effect immediately re-poses the live camera to this same scaled hero shot, so
  // this only matters for the very first painted frame — computed once so a reload
  // never flashes the un-scaled framing before that effect corrects it. Horizontal-
  // only, relative to CITY_CENTER (never Y — #47 vertical invariance).
  const [bootPosition] = useState<[number, number, number]>(() => {
    const k = cropFollowScale();
    return [
      CITY_CENTER.x + (intent.position[0] - CITY_CENTER.x) * k,
      intent.position[1],
      CITY_CENTER.z + (intent.position[2] - CITY_CENTER.z) * k,
    ];
  });

  return (
    <>
      <Canvas
        key={antialias ? "aa-on" : "aa-off"} // remount on MSAA change (context-creation flag)
        camera={{ position: bootPosition, fov: intent.fov, near: 0.5, far: 12000 * CITY_SCALE }}
        gl={{
          antialias,
          toneMapping: THREE.ACESFilmicToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={dprCap ?? [1, dprMax]}
        style={{ touchAction: "none" }}
      >
        {!legacyControls && <CameraModelHost />}
        {oldController && <CameraControls />}
        <ProjectionBlender />
        {/* Build parallel picking rays in (faked) ortho so hover/selection land right. */}
        <OrthoPickingFix />
        <PerfMonitor />
        {/* Dynamic DPR regression — default-inert; enable with ?adaptive (see
            AdaptiveQuality + samples/perf-report.html). Verify on real devices. */}
        <AdaptiveQuality />
        <TimeTicker />
        {/* City cascade waits for cityReady (user 2026-06-08) — see IntroTicker. */}
        <IntroTicker cityReady={cityReady} />
        <FogTicker />
        <FogBoundsMarkers />
        <PinPlaneMarker />

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
          {/* Moon lives INSIDE the star pass (#65) so it's drawn by the same star
            camera as the stars and sweeps locked to the skybox — it used to render in
            the main scene (main camera) and drifted relative to the stars on orbit. */}
          <Moon />
        </StarPass>

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
        {/* CityReveal pre-warms shaders off the visible frame (compileAsync) and
            reveals once compiled — removes the city-first-frame compile stall. */}
        {cityReady && (
          <CityReveal>
            <Roads masterSeed={masterSeed} />
            <InstancedCity masterSeed={masterSeed} />
            <Streetlights masterSeed={masterSeed} />
            <Beacons masterSeed={masterSeed} />
            <Traffic masterSeed={masterSeed} />
            <Flights masterSeed={masterSeed} />
            <FlightRoutes masterSeed={masterSeed} />
            <Helicopters masterSeed={masterSeed} />
            <HelicopterRoutes masterSeed={masterSeed} />
            {/* Planning overlays — each respects its own visibility flag (default
              off). Highway/arterial/street tier tinting now lives in <Roads/>. */}
            <DistrictShells masterSeed={masterSeed} />
            <PopulationHeatmap masterSeed={masterSeed} />
            <TrafficDensityOverlay masterSeed={masterSeed} />
            <TensorFieldOverlay masterSeed={masterSeed} />
            <TileCullOverlay masterSeed={masterSeed} />
          </CityReveal>
        )}
        {/* #87: marker pin above the selected building (renders null until a
          selection exists; gated on cityReady so its lookup hits the warm cache). */}
        {cityReady && <BuildingPin />}
        {/* #87: outline the district the selected building sits in (inspect only). */}
        {cityReady && <SelectedDistrictOutline masterSeed={masterSeed} />}
        {/* #87: x-ray outline of the selected building, visible through occluders. */}
        {cityReady && <SelectedBuildingOutline masterSeed={masterSeed} />}
        {/* Personas: home→work arc for the selected persona, mode-coloured. */}
        {cityReady && <CommuteArc masterSeed={masterSeed} />}
        {/* Inspect: street-name hover chip + hovered-road highlight. */}
        {cityReady && <RoadHover masterSeed={masterSeed} />}
        <InspectCursor />
        {/* Entity columns: persistent highlight for a selected street. */}
        {cityReady && <StreetHighlight masterSeed={masterSeed} />}
        {/* old controller's store-based indicator; the drei bridge renders its own
          live one (tracks the camera-controls target with no throttle lag) */}
        {oldController && <FocalIndicator />}
      </Canvas>
      {dreiOrbit && <ScreenYGuide />}
    </>
  );
}
