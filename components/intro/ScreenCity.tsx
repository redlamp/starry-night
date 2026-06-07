"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { useFrame, type RootState } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_SCALE } from "@/lib/seed/topology";
import { useGeneratedCity } from "@/lib/hooks/useGeneratedCity";
import { TimeTicker } from "@/components/scene/TimeTicker";
import { SkyGradient } from "@/components/scene/SkyGradient";
import { StarField } from "@/components/scene/StarField";
import { ShootingStars } from "@/components/scene/ShootingStars";
import { Moon } from "@/components/scene/Moon";
import { Ground } from "@/components/scene/Ground";
import { Roads } from "@/components/scene/Roads";
import { InstancedCity } from "@/components/scene/InstancedCity";
import { Streetlights } from "@/components/scene/Streetlights";
import { Beacons } from "@/components/scene/Beacons";
import { Traffic } from "@/components/scene/Traffic";
import { STUDIO_CAM_POS, STUDIO_TARGET } from "./studioCamera";
import type { IntroViewMode } from "./viewMode";

/**
 * Interior camera: orthographic, head-on down the north–south street axis —
 * the original Starry Night's flat-skyline framing at rest.
 *
 * Snow-globe mode *orbits* the camera around the city pivot in lockstep with
 * the studio camera's orbit around the Mac (azimuth/elevation 1:1) — the
 * city behaves like a solid object locked inside the case. Hover-controls
 * orbit the same pivot. Projection stays orthographic throughout.
 */
const SCREEN_ASPECT = 512 / 342;
const VIEW_HALF_H = 120; // metres of city per half screen-height
const VIEW_HALF_W = VIEW_HALF_H * SCREEN_ASPECT;
const BASE_POS: [number, number, number] = [-22, 110, 800];
const PIVOT = new THREE.Vector3(BASE_POS[0], BASE_POS[1], 0); // city point the base pose frames
const RADIUS = BASE_POS[2];
// Rest-pose orbit angles, derived from the studio camera's *orientation*
// (look direction), not its position — so the coupling keeps working when
// the orbit retargets to a different Mac on the stage.
const BASE_AZIMUTH = Math.atan2(STUDIO_CAM_POS[0] - STUDIO_TARGET[0], STUDIO_CAM_POS[2]);
const BASE_ELEV = Math.atan2(
  STUDIO_CAM_POS[1] - STUDIO_TARGET[1],
  Math.hypot(STUDIO_CAM_POS[0] - STUDIO_TARGET[0], STUDIO_CAM_POS[2]),
);
const AZIMUTH_GAIN = 1; // studio orbit → city orbit, 1:1 = solid snow globe
const ELEV_GAIN = 1;
const EPS = 1e-3;

/**
 * The snow-globe "foundation": the pose deltas are applied around. Starts at
 * the flat street-parallel view; whenever the user adjusts the city camera
 * via the screen (hover orbit/pan/zoom), their pose is adopted as the new
 * foundation on release.
 */
type OrbitBase = { az: number; el: number; rad: number; zoom: number; tgt: THREE.Vector3 };
const makeDefaultBase = (): OrbitBase => ({
  az: 0,
  el: 0,
  rad: RADIUS,
  zoom: 1,
  tgt: PIVOT.clone(),
});

// The rig may sit several portals deep (city FBO → process FBO → canvas);
// walk previousRoot up to the page's root state for the studio camera.
function rootStateOf(state: RootState): RootState {
  let s = state;
  while (s.previousRoot) s = s.previousRoot.getState();
  return s;
}

function ScreenRig({
  mode,
  interactive,
  resetting,
  onResetSettled,
  base,
  controlsRef,
}: {
  mode: IntroViewMode;
  interactive: boolean;
  resetting: boolean;
  onResetSettled: () => void;
  base: MutableRefObject<OrbitBase>;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
}) {
  const camRef = useRef<THREE.OrthographicCamera>(null);
  // damped orbit state around the foundation target
  const orbit = useRef({ az: 0, el: 0, rad: RADIUS, tgt: PIVOT.clone() });
  const wasInteractive = useRef(false);
  const sph = useRef(new THREE.Spherical());
  const fwd = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    const cam = camRef.current;
    if (!cam) return;
    // While the pointer is over the screen, the city OrbitControls own the
    // camera — the rig yields. A reset glide overrides that.
    if (interactive && !resetting) {
      wasInteractive.current = true;
      return;
    }
    const o = orbit.current;
    const b = base.current;
    if (resetting) {
      // reset glide: head home from wherever the camera is, no adoption
      wasInteractive.current = false;
    } else if (wasInteractive.current) {
      // the user's adjusted pose becomes the new snow-globe foundation
      wasInteractive.current = false;
      const tgt = controlsRef.current?.target ?? o.tgt;
      b.tgt.copy(tgt);
      const s = new THREE.Spherical().setFromVector3(cam.position.clone().sub(tgt));
      b.rad = s.radius;
      b.az = s.theta;
      b.el = Math.PI / 2 - s.phi;
      b.zoom = cam.zoom;
      // seed the damped state at exactly this pose — no visual jump
      o.az = b.az;
      o.el = b.el;
      o.rad = b.rad;
      o.tgt.copy(b.tgt);
    }
    let azTarget = b.az;
    let elTarget = b.el;
    if (mode === "snowglobe") {
      const root = rootStateOf(state);
      // orbit angles from the camera's look direction — target-independent
      root.camera.getWorldDirection(fwd.current);
      const f = fwd.current;
      const azimuth = Math.atan2(-f.x, -f.z);
      const elev = Math.atan2(-f.y, Math.hypot(f.x, f.z));
      azTarget = b.az + (azimuth - BASE_AZIMUTH) * AZIMUTH_GAIN;
      elTarget = b.el + (elev - BASE_ELEV) * ELEV_GAIN;
    }
    o.az = THREE.MathUtils.damp(o.az, azTarget, 6, delta);
    o.el = THREE.MathUtils.damp(o.el, THREE.MathUtils.clamp(elTarget, -0.1, 1.49), 6, delta);
    o.rad = THREE.MathUtils.damp(o.rad, b.rad, 6, delta);
    o.tgt.x = THREE.MathUtils.damp(o.tgt.x, b.tgt.x, 6, delta);
    o.tgt.y = THREE.MathUtils.damp(o.tgt.y, b.tgt.y, 6, delta);
    o.tgt.z = THREE.MathUtils.damp(o.tgt.z, b.tgt.z, 6, delta);

    sph.current.set(o.rad, THREE.MathUtils.clamp(Math.PI / 2 - o.el, EPS, Math.PI - EPS), o.az);
    cam.position.setFromSpherical(sph.current).add(o.tgt);
    cam.lookAt(o.tgt);
    if (Math.abs(cam.zoom - b.zoom) > 1e-4) {
      cam.zoom = THREE.MathUtils.damp(cam.zoom, b.zoom, 6, delta);
      cam.updateProjectionMatrix();
    }

    if (
      resetting &&
      Math.abs(o.az - azTarget) < 0.004 &&
      Math.abs(o.el - elTarget) < 0.004 &&
      Math.abs(o.rad - b.rad) < 1 &&
      o.tgt.distanceTo(b.tgt) < 0.5 &&
      Math.abs(cam.zoom - b.zoom) < 0.01
    ) {
      onResetSettled();
    }
  });

  return (
    <OrthographicCamera
      ref={camRef}
      makeDefault
      position={BASE_POS}
      rotation={[0, 0, 0]}
      left={-VIEW_HALF_W}
      right={VIEW_HALF_W}
      top={VIEW_HALF_H}
      bottom={-VIEW_HALF_H}
      near={0.5}
      far={12000 * CITY_SCALE}
    />
  );
}

/**
 * The starry-night city as rendered *inside* the Mac's screen texture.
 * Mirrors Scene.tsx's composition minus the parts that own the main canvas:
 * CameraControls (ScreenRig above instead), StarPass (render-loop
 * compositor, incompatible inside an FBO), FogTicker/fog (camera-anchored,
 * revisit), debug overlays.
 *
 * Same global store, same seed, same generation cache as the main app —
 * the screen shows the *same* city `/` shows.
 */
export function ScreenCity({
  mode,
  interactive = false,
  resetSignal = 0,
}: {
  mode: IntroViewMode;
  interactive?: boolean;
  resetSignal?: number;
}) {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const stars = useSceneStore((s) => s.stars);
  const fog = useSceneStore((s) => s.fog);
  const { ready: cityReady } = useGeneratedCity(masterSeed, cityShape, cityShapeScale);
  // sticky foundation: survives hover cycles, owned here so the rig and the
  // (conditionally mounted) controls agree on the pivot
  const base = useRef(makeDefaultBase());
  const cityControls = useRef<OrbitControlsImpl | null>(null);
  // double-click on the screen: foundation back to default, rig glides home
  // (controls stand down for the glide, even though the pointer still hovers)
  const [resetting, setResetting] = useState(false);
  const onResetSettled = useCallback(() => setResetting(false), []);
  useEffect(() => {
    if (resetSignal > 0) {
      base.current = makeDefaultBase();
      setResetting(true);
    }
  }, [resetSignal]);

  return (
    <>
      <ScreenRig
        mode={mode}
        interactive={interactive}
        resetting={resetting}
        onResetSettled={onResetSettled}
        base={base}
        controlsRef={cityControls}
      />
      {/* pointer over the CRT: main-app-style orbit around the city pivot —
          drag orbits, right-drag pans, wheel zooms (ortho). */}
      {interactive && !resetting && (
        <OrbitControls
          ref={cityControls}
          target={base.current.tgt.toArray()}
          screenSpacePanning
          enableDamping
          zoomSpeed={0.8}
          maxPolarAngle={Math.PI / 2 + 0.1}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      )}
      {/* flat ortho frustum is a narrow box — the SkyGradient dome barely
          intersects it, so the background carries the sky. Zenith indigo,
          per the #26 night-reads-luminous note. */}
      <color attach="background" args={["#070b22"]} />
      <TimeTicker />
      <ambientLight intensity={0.04} />

      <SkyGradient horizonColor={fog.color} zenithColor="#070b22" />
      <StarField
        masterSeed={masterSeed}
        radius={stars.radius}
        depth={stars.depth}
        count={stars.count}
        size={stars.factor}
      />
      <ShootingStars masterSeed={masterSeed} radius={stars.radius} />
      <Moon />
      <Ground />
      {cityReady && (
        <>
          <Roads masterSeed={masterSeed} />
          <InstancedCity masterSeed={masterSeed} />
          <Streetlights masterSeed={masterSeed} />
          <Beacons masterSeed={masterSeed} />
          <Traffic masterSeed={masterSeed} />
        </>
      )}
    </>
  );
}
