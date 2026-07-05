"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_SCALE, CITY_TIERS } from "@/lib/seed/topology";
import { displayedRadius, resolveCityShape } from "@/lib/seed/cityShape";
import { GROUND_APRON_M } from "../Ground";
import { HOME_TWEEN_SEC } from "@/lib/scene/cameraView";

// "Top-down" — a fixed, north-up overhead plan view (per spec: north up, no rotation,
// looking straight down at the city centre). NOT an orbit: the camera sits directly
// above the centre looking down, fit to the whole city (+ margin) for the current
// aspect. Driven directly (no camera-controls, so no gimbal ambiguity at straight-down);
// ProjectionBlender still supplies the ortho/persp matrix from orthoSize, which we size
// to fit.
//
// #83 — the `t` hotkey tweens INTO this pose (shortest arc) and back OUT to whichever
// model + pose was active before (snapshotted into topDownEntry by cameraView.ts's
// toggleTopDown). CameraModelHost unmounts/remounts on cameraModel change, so the
// animation has to live here rather than in cameraView.ts: a 3-phase state machine
// ("entering" -> "steady" -> "exiting") built on ONE reversible GSAP tween — pressing
// `t` again mid-transition plays the SAME tween the other way (gsap reverse()/play()),
// rather than restarting from a fresh snapshot.
//
// Entry motion — a drone GIMBAL sweep (user 2026-07-05, revised after the end-of-tween snap).
// Two channels on ONE eased clock. (1) ORIENTATION slerps the start quaternion -> the overhead
// north-up-straight-down quaternion. A quaternion slerp is smooth and takes the SHORTEST arc, so
// the north-up alignment eases in across the WHOLE tween instead of resolving abruptly at the pole
// (the earlier up-lerp let the azimuth stay suppressed while the view was oblique, then snap ~180
// degrees in the last few frames as the view went vertical). (2) the EYE is DERIVED, not lerped:
// the FOCUS eases from the ground point the camera was aimed at to the city centre, the DISTANCE
// eases start -> overhead height, and the eye is parked at focus - forward*distance so the slerped
// orientation looks EXACTLY at the easing-to-centre focus every frame. That keeps the city
// dead-centre the whole way. (A slerp with an INDEPENDENT straight-line eye is what swung the city
// off-screen earlier; deriving the eye from the focus is what frames it.) t=0 reproduces the entry
// pose exactly, t=1 the overhead pose; reversing the SAME tween runs it back out. The live
// `orbit.azimuthDeg` readout (panel + #84's ProjectionBlender feed) is still driven separately
// during the outro, unwound the shortest way (the R-reset formula in cameraView.ts's tweenOrbitToHome).
//
// #84 — orbit.radius (and azimuthDeg / elevationDeg) are synced live, not just written
// once, so a `p` press while resting in (or transitioning through) top-down has a fresh,
// K-matched radius for ProjectionBlender's framing bridge instead of a stale one. orthoSize
// eases symmetrically (in on entry, back out on exit): in pure ortho the apparent size IS
// orthoSize, so holding it through the outro and snapping at the end popped the size on return
// (user 2026-07-05). radius is kept K-matched to the current orthoSize each frame so the eased
// zoom stays consistent; in perspective orthoSize is unused (size is the dolly) so it is moot.

const TOP_DOWN_MARGIN = 1.15;
// North-up: compass 0 = +Z (azimuth = atan2(x, z)), so making -Z read as "up" on screen
// points north up. (Flip to +Z if it reads upside down on a given device.)
const NORTH_UP = new THREE.Vector3(0, 0, -1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const RAD2DEG = 180 / Math.PI;
const TWO_DP = (n: number) => Math.round(n * 100) / 100;

// Ortho half-height that fits the city (+ margin); the limiting screen axis sets it.
function fitOrthoSize(tier: number, aspect: number): number {
  return (tier * TOP_DOWN_MARGIN) / Math.min(1, aspect);
}

// Perspective fit + clip-safe height (the fov spans the same framed extent as orthoSize).
function fitHeight(orthoSize: number, fovDeg: number): number {
  const tan = Math.tan((fovDeg * Math.PI) / 360) || 0.4663;
  return Math.min(10000 * CITY_SCALE, Math.max(50 * CITY_SCALE, orthoSize / tan));
}

type Phase = "entering" | "steady" | "exiting";

// Scratch — only one TopDownModel is ever mounted at a time.
const _startPos = new THREE.Vector3();
const _startFocal = new THREE.Vector3(); // ground point the camera was aimed at, at entry
const _startQuat = new THREE.Quaternion(); // entry orientation
const _targetPos = new THREE.Vector3(); // overhead eye position (directly above the centre)
const _targetQuat = new THREE.Quaternion(); // overhead: north-up, straight down at the centre
const _curQuat = new THREE.Quaternion();
const _focus = new THREE.Vector3(); // per-frame gimbal focus (start focal -> city centre)
const _fwd = new THREE.Vector3(); // current forward, from the slerped orientation
const _up = new THREE.Vector3(); // current up, from the slerped orientation (kept on camera.up)
const _lookMat = new THREE.Matrix4();
const _cityGround = new THREE.Vector3(CITY_CENTER.x, 0, CITY_CENTER.z);
const _lookTarget = new THREE.Vector3(CITY_CENTER.x, 0, CITY_CENTER.z); // end focus = city centre

export function TopDownModel() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const citySize = useSceneStore((s) => s.citySize);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const exiting = useSceneStore((s) => s.topDownExiting);
  const prevOrtho = useRef<number | null>(null);
  const lastWrite = useRef(0);
  const phase = useRef<Phase>("entering");
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const az0 = useRef(0); // entry azimuth (deg) — held through entering + steady
  const orthoTarget = useRef(0); // fitted top-down orthoSize (entry target / held during outro)
  const orthoStart = useRef(0); // orthoSize at the moment entry began
  const azExitFrom = useRef(0); // outro azimuth-sync start (== az0 at the moment outro begins)
  const azExitDelta = useRef(0); // shortest-arc delta toward the restore target's azimuth

  // Snapshot orthoSize on mount; restore it (and camera.up) on unmount as a defensive
  // backstop so the orbit models never inherit a stray top-down zoom / north-tipped up if
  // something skips the tween's own restore (e.g. a hot-reload mid-transition). The NORMAL
  // restore path is the exit tween's onReverseComplete (finishExit, below).
  useEffect(() => {
    prevOrtho.current = useSceneStore.getState().orthoSize;
    return () => {
      if (prevOrtho.current != null) useSceneStore.getState().setOrthoSize(prevOrtho.current);
      camera.up.copy(WORLD_UP);
    };
  }, [camera]);

  // Steady-state orthoSize re-fit on citySize/shape/crop/aspect change — skipped
  // mid-transition (entering / exiting) so it can't fight the tween's own orthoSize
  // handling below. Unlike the other camera models' resting poses, top-down's whole
  // job is to keep framing the CURRENT displayed city (#56 extends that live fit to
  // the crop, on the same footing as the pre-existing citySize/aspect tracking).
  useEffect(() => {
    if (phase.current !== "steady") return;
    const aspect = size.width / Math.max(1, size.height);
    const tier =
      displayedRadius(
        resolveCityShape(cityShape, masterSeed),
        cityShapeScale,
        CITY_TIERS[citySize],
      ) + GROUND_APRON_M;
    useSceneStore.getState().setOrthoSize(fitOrthoSize(tier, aspect));
  }, [citySize, cityShape, cityShapeScale, masterSeed, size.width, size.height]);

  // ENTRY — build the sweep the moment this model mounts, FROM wherever the camera
  // actually is (the previous model's live pose). Mount-only: toggleTopDown never
  // re-triggers a fresh entry while already in top-down (it only flips topDownExiting —
  // see the effect below), so a `[]` dep array is correct here.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const tier =
      displayedRadius(
        resolveCityShape(cityShape, masterSeed),
        cityShapeScale,
        CITY_TIERS[citySize],
      ) + GROUND_APRON_M;
    const targetOrtho = fitOrthoSize(tier, aspect);
    orthoTarget.current = targetOrtho;
    orthoStart.current = useSceneStore.getState().orthoSize;

    _startPos.copy(cam.position);
    _startQuat.copy(cam.quaternion);

    const height = fitHeight(targetOrtho, cam.fov);
    _targetPos.set(CITY_CENTER.x, height, CITY_CENTER.z);
    _lookMat.lookAt(_targetPos, _lookTarget, NORTH_UP);
    _targetQuat.setFromRotationMatrix(_lookMat);

    // Forward from the ENTRY orientation — not cam.getWorldDirection (matrixWorld can be a beat
    // stale at mount); the quaternion is the live source and is exactly what applyPose uses at
    // t = 0, so the focal lands on the t = 0 forward ray and eye(t=0) reproduces _startPos with
    // no jump.
    _fwd.set(0, 0, -1).applyQuaternion(_startQuat);
    // Gimbal focus start: the ground point straight ahead if the view looks down, else a point on
    // the forward ray at ~the city-centre distance (the default hero pose looks a hair UP, so
    // there is no ground hit ahead — parking the focal off the ray there dropped the derived eye
    // BELOW ground at t=0). Either way it sits ON the forward ray, so
    // eye(t=0) = focus - fwd*startDist = _startPos EXACTLY (no below-ground dip, entry or return).
    // The tween then eases this focus to the city centre while the derived eye keeps the slerped
    // orientation looking straight at it.
    let startDist: number;
    if (_fwd.y < -1e-3) {
      startDist = -_startPos.y / _fwd.y; // forward ray meets the ground plane y=0 ahead
    } else {
      startDist = _startPos.distanceTo(_cityGround); // level/up view: focus at ~city distance
    }
    startDist = Math.max(1, startDist);
    _startFocal.copy(_startPos).addScaledVector(_fwd, startDist);
    const overheadDist = height; // overhead eye is at y = height directly above the ground centre

    // Hold azimuth fixed (see module doc): capture the CURRENT compass bearing once, up
    // front — matches orbitWriteback's atan2 convention (do NOT trust s.orbit.azimuthDeg,
    // stale under fly/map). This is what steady top-down reports on orbit.azimuthDeg
    // (instead of the degenerate atan2(~0,~0) directly overhead), and it's the anchor the
    // outro's shortest-arc unwrap measures from.
    az0.current = Math.atan2(_startPos.x - CITY_CENTER.x, _startPos.z - CITY_CENTER.z) * RAD2DEG;

    phase.current = "entering";
    const proxy = { t: 0 };

    function applyPose(t: number) {
      const cm = camera as THREE.PerspectiveCamera;
      // ORIENTATION: shortest-arc slerp start -> overhead north-up. Quaternion slerp is smooth and
      // takes the short way, so the north-up alignment eases in over the WHOLE tween instead of
      // snapping ~180 degrees at the pole (the earlier up-lerp resolved the azimuth abruptly there).
      _curQuat.copy(_startQuat).slerp(_targetQuat, t);
      cm.quaternion.copy(_curQuat);
      // EYE (derived, not lerped): park it so the slerped orientation looks EXACTLY at the
      // easing-to-centre focus — eye = focus - forward*distance. Keeps the city dead-centre the
      // whole sweep (a slerp with an independent straight-line eye is what swung it off before).
      _fwd.set(0, 0, -1).applyQuaternion(_curQuat); // world forward of the current orientation
      _focus.lerpVectors(_startFocal, _lookTarget, t);
      const eyeDist = startDist + (overheadDist - startDist) * t;
      cm.position.copy(_focus).addScaledVector(_fwd, -eyeDist);
      _up.set(0, 1, 0).applyQuaternion(_curQuat);
      cm.up.copy(_up);
      cm.updateMatrixWorld();

      // orthoSize eases BOTH ways (in on entry, back out on exit). In pure ortho the apparent
      // size IS orthoSize, so holding it through the outro and snapping at the very end read as a
      // size POP on return (user 2026-07-05); easing it symmetrically eases the zoom instead. In
      // perspective orthoSize is unused (size comes from the dolly), so this is moot there. radius
      // stays K-matched to the current orthoSize each frame; at t=0 ortho lands on orthoStart
      // (== the entry orthoSize finishExit restores), so the handoff is seamless.
      const ortho = orthoStart.current + (orthoTarget.current - orthoStart.current) * t;
      const st = useSceneStore.getState();
      st.setOrthoSize(ortho);
      const fovRad = (st.cameraIntent.fov * Math.PI) / 180;
      const radius = ortho / Math.max(0.05, Math.tan(fovRad / 2));
      const azDeg =
        phase.current === "exiting" ? azExitFrom.current + azExitDelta.current * t : az0.current;
      const dist = Math.max(1, cm.position.distanceTo(_cityGround));
      const elevDeg = Math.asin(THREE.MathUtils.clamp(cm.position.y / dist, -1, 1)) * RAD2DEG;
      st.setOrbit({
        radius: Math.round(radius),
        azimuthDeg: ((azDeg % 360) + 360) % 360,
        elevationDeg: TWO_DP(elevDeg),
        centerX: CITY_CENTER.x,
        centerZ: CITY_CENTER.z,
      });
    }

    function finishExit() {
      const st = useSceneStore.getState();
      const entry = st.topDownEntry;
      if (entry) {
        // Restore the EXACT pose the tween started from — _startPos, looking along _startQuat's
        // forward ray (via _startFocal) — NOT entry.position/lookAt, which toggleTopDown rebuilt
        // from the throttled cameraLive (stale by up to a beat, and only 10 units ahead), so the
        // return missed the pose and the aim snapped on takeover. Because _startFocal is ON that
        // ray, setLookAt(_startPos, _startFocal) reproduces _startQuat's orientation exactly and
        // the reverse-tween's final frame hands off with zero jump. Set the handoff FIRST and swap
        // the model LAST, so the pose (and orbit/ortho/mode) are in place before CameraModelHost
        // mounts the restored model (its hadHandoffOnMount reads cameraHandoff at render).
        if (entry.modelId === "snv2") {
          st.setCameraHandoff({
            position: [_startPos.x, _startPos.y, _startPos.z],
            lookAt: [_startFocal.x, _startFocal.y, _startFocal.z],
            orthoSize: orthoStart.current, // restore the prior ortho zoom verbatim, no size pop (#83)
          });
        }
        st.setOrbit(entry.orbit);
        st.setOrthoSize(entry.orthoSize);
        st.setOrbitPaused(entry.paused);
        st.setCameraMode(entry.modelId === "fly" ? "fly" : "orbit");
        st.setCameraModel(entry.modelId);
      }
      st.setTopDownEntry(null);
      st.setTopDownExiting(false);
    }

    const tween = gsap.to(proxy, {
      t: 1,
      duration: HOME_TWEEN_SEC,
      ease: "power2.inOut",
      onUpdate: () => applyPose(proxy.t),
      onComplete: () => {
        phase.current = "steady";
      },
      onReverseComplete: finishExit,
    });
    tweenRef.current = tween;

    return () => {
      tween.kill();
      tweenRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outro toggle: `t` pressed again while in top-down flips topDownExiting (cameraView.ts).
  // Reverse the SAME tween built above rather than building a fresh one, so an in-flight
  // motion just changes direction instead of jumping; a re-toggle back to false resumes it
  // forward again (mid-outro reversal — see cameraView.ts's toggleTopDown comment).
  useEffect(() => {
    const tween = tweenRef.current;
    if (!tween) return;
    if (exiting) {
      if (phase.current === "exiting") return;
      const entry = useSceneStore.getState().topDownEntry;
      const targetAz = entry ? entry.orbit.azimuthDeg : az0.current;
      // Shortest-arc unwrap — the exact R-reset formula (cameraView.ts's tweenOrbitToHome).
      const dAz = ((((targetAz - az0.current) % 360) + 540) % 360) - 180;
      azExitFrom.current = az0.current;
      azExitDelta.current = dAz;
      phase.current = "exiting";
      tween.reverse();
    } else if (phase.current === "exiting") {
      phase.current = "entering";
      tween.play();
    }
  }, [exiting]);

  // Steady-state drive: instant positioning (no tween in flight) + throttled store sync,
  // matching the other camera models' ~10/s writeback cadence. Skipped entirely while
  // entering/exiting — the GSAP tween's onUpdate (applyPose, above) owns the camera and
  // the store sync during those phases so the two mechanisms never fight.
  useFrame((state) => {
    if (phase.current !== "steady") return;
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const tier =
      displayedRadius(
        resolveCityShape(cityShape, masterSeed),
        cityShapeScale,
        CITY_TIERS[citySize],
      ) + GROUND_APRON_M;
    const orthoSize = fitOrthoSize(tier, aspect);
    const height = fitHeight(orthoSize, cam.fov);
    cam.position.set(CITY_CENTER.x, height, CITY_CENTER.z);
    cam.up.copy(NORTH_UP);
    cam.lookAt(CITY_CENTER.x, 0, CITY_CENTER.z);
    cam.updateMatrixWorld();

    const tt = state.clock.elapsedTime;
    if (tt - lastWrite.current >= 0.1) {
      lastWrite.current = tt;
      const st = useSceneStore.getState();
      st.setCameraLive({
        position: [cam.position.x, cam.position.y, cam.position.z],
        rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
        fov: cam.fov,
      });
      // #84 item 2: keep orbit.radius (+ azimuthDeg / elevationDeg) fresh while RESTING in
      // top-down too, not just during the entry/exit tween — a `p` press here needs a
      // K-matched radius for ProjectionBlender's framing bridge, not a stale one left over
      // from whatever model was active before entering.
      const fovRad = (cam.fov * Math.PI) / 180;
      const radius = orthoSize / Math.max(0.05, Math.tan(fovRad / 2));
      st.setOrbit({
        radius: Math.round(radius),
        azimuthDeg: ((az0.current % 360) + 360) % 360,
        elevationDeg: 90,
        centerX: CITY_CENTER.x,
        centerZ: CITY_CENTER.z,
      });
    }
  });

  return null;
}
