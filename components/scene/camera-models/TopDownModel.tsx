"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_SCALE, CITY_TIERS } from "@/lib/seed/topology";
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
// Entry azimuth: HOLD FIXED. A straight-line lerp of camera.position from wherever it
// currently is to the fitted top-down point (CITY_CENTER.x, height, CITY_CENTER.z) keeps
// the compass bearing (atan2 of the horizontal offset from CITY_CENTER) constant for the
// WHOLE sweep, for free: the top-down endpoint has ZERO horizontal offset from
// CITY_CENTER, so the horizontal component of the lerp is a pure (shrinking) scalar
// multiple of the starting offset the entire way — its direction never changes. That's
// also why it's trivially the shortest arc: there is no azimuthal travel to shorten.
// Reversing the SAME tween for the outro sweeps the camera back out along that same
// meridian. A restore target's STORED azimuth (map's remembered bearing, say) generally
// differs from the entry azimuth though, so the live `orbit.azimuthDeg` readout (the
// panel, and #84 item 2's ProjectionBlender feed) is driven separately during the outro,
// unwound the shortest way — the same formula as the R-reset (cameraView.ts's
// tweenOrbitToHome) — from the held entry azimuth toward the restore target's.
//
// #84 — orbit.radius (and azimuthDeg / elevationDeg) are synced live, not just written
// once, so a `p` press while resting in (or transitioning through) top-down has a fresh,
// K-matched radius for ProjectionBlender's framing bridge instead of a stale one. orthoSize
// itself EASES during the entry sweep but is HELD FIXED (not eased back) during the outro —
// only snapping to the restored value at the very end — because #84's fix keeps the
// apparent size constant precisely when radius stays K-matched to a non-moving orthoSize;
// easing orthoSize down through the outro while ALSO sweeping the camera back out would
// reintroduce the same breathing the fix removes.

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
const _startUp = new THREE.Vector3();
const _startQuat = new THREE.Quaternion();
const _targetPos = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _lookMat = new THREE.Matrix4();
const _curQuat = new THREE.Quaternion();
const _curUp = new THREE.Vector3();
const _cityGround = new THREE.Vector3(CITY_CENTER.x, 0, CITY_CENTER.z);
const _lookTarget = new THREE.Vector3(CITY_CENTER.x, 0, CITY_CENTER.z);

export function TopDownModel() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const citySize = useSceneStore((s) => s.citySize);
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

  // Steady-state orthoSize re-fit on citySize/aspect change — skipped mid-transition
  // (entering / exiting) so it can't fight the tween's own orthoSize handling below.
  useEffect(() => {
    if (phase.current !== "steady") return;
    const aspect = size.width / Math.max(1, size.height);
    const tier = CITY_TIERS[citySize] + GROUND_APRON_M;
    useSceneStore.getState().setOrthoSize(fitOrthoSize(tier, aspect));
  }, [citySize, size.width, size.height]);

  // ENTRY — build the sweep the moment this model mounts, FROM wherever the camera
  // actually is (the previous model's live pose). Mount-only: toggleTopDown never
  // re-triggers a fresh entry while already in top-down (it only flips topDownExiting —
  // see the effect below), so a `[]` dep array is correct here.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const tier = CITY_TIERS[citySize] + GROUND_APRON_M;
    const targetOrtho = fitOrthoSize(tier, aspect);
    orthoTarget.current = targetOrtho;
    orthoStart.current = useSceneStore.getState().orthoSize;

    _startPos.copy(cam.position);
    _startUp.copy(cam.up);
    _startQuat.copy(cam.quaternion);

    const height = fitHeight(targetOrtho, cam.fov);
    _targetPos.set(CITY_CENTER.x, height, CITY_CENTER.z);
    _lookMat.lookAt(_targetPos, _lookTarget, NORTH_UP);
    _targetQuat.setFromRotationMatrix(_lookMat);

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
      cm.position.lerpVectors(_startPos, _targetPos, t);
      _curUp.lerpVectors(_startUp, NORTH_UP, t).normalize();
      cm.up.copy(_curUp);
      _curQuat.copy(_startQuat).slerp(_targetQuat, t);
      cm.quaternion.copy(_curQuat);
      cm.updateMatrixWorld();

      // orthoSize eases in on the way IN; held FIXED (not eased back) on the way OUT — see
      // module doc. radius stays K-matched to whatever orthoSize is right now either way,
      // so a `p` press mid-transition still gets #84's size-invariant blend.
      const ortho =
        phase.current === "exiting"
          ? orthoTarget.current
          : orthoStart.current + (orthoTarget.current - orthoStart.current) * t;
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
        st.setCameraModel(entry.modelId);
        st.setOrbit(entry.orbit);
        st.setOrthoSize(entry.orthoSize);
        st.setOrbitPaused(entry.paused);
        st.setCameraMode(entry.modelId === "fly" ? "fly" : "orbit");
        // snv2 drives its own camera-controls instance from position/lookAt, not from the
        // orbit config — deliver the exact pose over the handoff channel it already
        // consumes on mount (see StarryNightV2Model's hadHandoffOnMount gate, #83).
        if (entry.modelId === "snv2") {
          st.setCameraHandoff({ position: entry.position, lookAt: entry.lookAt });
        }
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
    const tier = CITY_TIERS[citySize] + GROUND_APRON_M;
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
