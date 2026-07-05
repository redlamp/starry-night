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
import { IntroTicker } from "@/components/scene/IntroTicker";
import { ShootingStars } from "@/components/scene/ShootingStars";
import { IntroStarField } from "./IntroStarField";
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
// Framing (measured at tier 3): heights run p50 16m / p90 70m / p99 ~180m,
// with ~25 towers >250m and a 470m freak per city. Half-height 180 with the
// camera at 170 spans y -10..350 — ground hugs the bottom edge, the p99.9
// skyline fits, the upper half belongs to stars; only the handful of >350m
// outliers crop.
const VIEW_HALF_H = 180; // metres of city per half screen-height
const VIEW_HALF_W = VIEW_HALF_H * SCREEN_ASPECT;
const BASE_POS: [number, number, number] = [-22, 170, 800];
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
// Spacebar auto-orbit: a turntable revolution of the city (the record
// spinning on the platter). The rig advances the FOUNDATION azimuth, so the
// snow-globe coupling — the platter following the Mac — composes on top. The
// spin runs only while the rig owns the camera: it pauses when you reach in
// to manipulate (hover/drag), then resumes. Speed kept in autoRotateSpeed
// units for familiarity: 0.1 ≈ (2π/60)·0.1 rad/s ≈ 10 min per revolution.
const AUTO_ORBIT_SPEED = 0.1;
const AUTO_ORBIT_RAD_PER_SEC = ((2 * Math.PI) / 60) * AUTO_ORBIT_SPEED;

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
  autoOrbit,
  resetting,
  onResetSettled,
  base,
  controlsRef,
}: {
  mode: IntroViewMode;
  interactive: boolean;
  autoOrbit: boolean;
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
    // Auto-orbit advances the FOUNDATION azimuth (snowglobe then offsets from
    // it, so the turntable spin and the Mac-orientation coupling compose). Off
    // during a reset glide, so the settle test below can converge. While the
    // pointer is over the screen the rig yields entirely — OrbitControls'
    // autoRotate carries the spin there instead. Sign matches autoRotate's
    // rotateLeft (theta decreases) so the spin direction is continuous across
    // the hover boundary — a mismatch reads as "the orbit flips with the mouse".
    if (autoOrbit && !resetting) {
      b.az -= AUTO_ORBIT_RAD_PER_SEC * delta;
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
  autoOrbit = false,
  resetSignal = 0,
  onDragChange,
}: {
  mode: IntroViewMode;
  interactive?: boolean;
  /** spacebar turntable: revolve the city around its pivot, hands-free */
  autoOrbit?: boolean;
  resetSignal?: number;
  /** city-orbit drag lifecycle — lets the stage's drag-owner lock keep the
   * gesture alive when the pointer leaves the CRT mid-drag */
  onDragChange?: (dragging: boolean) => void;
}) {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const stars = useSceneStore((s) => s.stars);
  // #70: no `cityShapeScale` arg — see useGeneratedCity's MAX_SCALE comment;
  // the gate no longer bounces (and this screen's own city no longer rebuilds
  // or replays) on a crop notch.
  const { ready: cityReady } = useGeneratedCity(masterSeed, cityShape);
  // sticky foundation: survives hover cycles, owned here so the rig and the
  // (conditionally mounted) controls agree on the pivot
  const base = useRef(makeDefaultBase());
  const cityControls = useRef<OrbitControlsImpl | null>(null);
  // The Mac's screensaver city has "been running a while" when you walk up:
  // windows snap to fully-awake on mount (fresh visitors land with progress 0
  // and no autoplay). Stars are the exception — IntroStarField owns its own
  // gradual wake so the sky fades in. Replays come from the Apple badge.
  useEffect(() => {
    const s = useSceneStore.getState();
    if (!s.intro.playing && s.intro.progress < 1) s.setIntroProgress(1);
  }, []);

  // double-click on the screen: foundation back to default, rig glides home
  // (controls stand down for the glide, even though the pointer still hovers)
  const [resetting, setResetting] = useState(false);
  const onResetSettled = useCallback(() => setResetting(false), []);
  useEffect(() => {
    if (resetSignal > 0) {
      base.current = makeDefaultBase();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetSignal is an imperative event counter from the screen dblclick; this effect is its subscriber
      setResetting(true);
    }
  }, [resetSignal]);

  return (
    <>
      <ScreenRig
        mode={mode}
        interactive={interactive}
        autoOrbit={autoOrbit}
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
          // eslint-disable-next-line react-hooks/refs -- base is the ref-owned orbit foundation (mutations must NOT re-render); the prop only seeds the pivot at controls (re)mount
          target={base.current.tgt.toArray()}
          onStart={() => onDragChange?.(true)}
          onEnd={() => onDragChange?.(false)}
          autoRotate={autoOrbit}
          autoRotateSpeed={AUTO_ORBIT_SPEED}
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
      {/* atmosphere off: flat near-black sky (crushes solid under the 1-bit
          levels) — no SkyGradient. The main StarField's 9 km dome is gone
          too; IntroStarField's cylindrical band owns the sky here. */}
      <color attach="background" args={["#070b22"]} />
      <TimeTicker />
      {/* advances wake progress + stamps shader start-times on replay; no
          autoplay — the badge (playAllIntros) is the only replay trigger.
          cityReady gates the per-frame cascade clock so badge replays advance
          (the city is mounted here); autoPlay=false keeps the mount/edge
          auto-triggers off — ScreenCity snaps itself awake above. */}
      <IntroTicker autoPlay={false} cityReady={cityReady} />
      <ambientLight intensity={0.04} />

      <IntroStarField masterSeed={masterSeed} />
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
