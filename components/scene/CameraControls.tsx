"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, type CameraIntent, type Vec3 } from "@/lib/state/sceneStore";
import { enterFlyMode, enterOrbitMode } from "@/lib/scene/cameraView";
import { CITY_SCALE } from "@/lib/seed/topology";

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type TweenInternal = {
  from: { position: Vec3; lookAt: Vec3; fov: number };
  to: { position: Vec3; lookAt: Vec3; fov: number };
  startedAt: number;
  durationMs: number;
  finalIntent: CameraIntent;
};

type KeyName = "w" | "a" | "s" | "d" | "space" | "c" | "q" | "e" | "sprint";
type KeyState = Record<KeyName, boolean>;

const initialKeys: KeyState = {
  w: false,
  a: false,
  s: false,
  d: false,
  space: false,
  c: false,
  q: false,
  e: false,
  sprint: false,
};

function keyOf(e: KeyboardEvent): KeyName | null {
  const k = e.key.toLowerCase();
  if (k === "w" || k === "arrowup") return "w";
  if (k === "s" || k === "arrowdown") return "s";
  if (k === "a" || k === "arrowleft") return "a";
  if (k === "d" || k === "arrowright") return "d";
  if (k === " ") return "space";
  if (k === "c") return "c";
  if (k === "q") return "q";
  if (k === "e") return "e";
  if (k === "shift") return "sprint";
  return null;
}

const ROLL_SPEED = 1.5;
const FLY_SPRINT_MULTIPLIER = 2.85; // matches the legacy 40 m/s sprint vs 14 m/s base
const FLY_SPEED_MIN = 0.1;
const FLY_SPEED_MAX = 500;
const FLY_WHEEL_STEP = 1.15; // each wheel tick scales fly speed by this — UE5-ish
const FLY_WHEEL_DOLLY = 0.12; // metres dollied per wheel-delta when not moving (perspective)
const FLY_PINCH_DOLLY = 0.8; // metres flown per pixel of two-finger pinch-spread (touch)

// Ortho zoom (frustum half-height) tuning — shared by wheel + pinch.
const ORTHO_WHEEL_STEP = 1.1;
const ORTHO_SIZE_MIN = 5 * CITY_SCALE;
const ORTHO_SIZE_MAX = 2000 * CITY_SCALE;

const POINTER_SENSITIVITY = 0.002;
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const HALF_PI = Math.PI / 2;
const DEG2RAD = Math.PI / 180;

// Orbit drag tuning
const ORBIT_YAW_SENSITIVITY = 0.25; // deg per pixel
const ORBIT_PITCH_SENSITIVITY = 0.25; // deg per pixel
const ORBIT_WHEEL_SENSITIVITY = 0.5; // metres per wheel-delta tick
const ORBIT_RADIUS_MIN = 50 * CITY_SCALE;
const ORBIT_RADIUS_MAX = 5000 * CITY_SCALE;
const ORBIT_ELEVATION_MIN = 0.01; // hair above horizon — el = 0 clips the ground plane and culls it from the frame
// Just under vertical: manual orbit keeps world-up (level horizon), and capping
// below 90° means world-up never goes parallel to the view direction (gimbal).
// Top-down (looking straight down) is the dedicated preset, which sets 90° + the
// north-up roll via topDownTip rather than coming through the drag handler.
const ORBIT_ELEVATION_MAX = 89;

export function CameraControls() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const mode = useSceneStore((s) => s.cameraMode);
  const intent = useSceneStore((s) => s.cameraIntent);
  const setCameraLive = useSceneStore((s) => s.setCameraLive);
  const setCameraIntent = useSceneStore((s) => s.setCameraIntent);

  const keys = useRef<KeyState>({ ...initialKeys });
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const worldUp = useRef(new THREE.Vector3(0, 1, 0));
  const tween = useRef<TweenInternal | null>(null);
  const tweenRequest = useSceneStore((s) => s.cameraTweenRequest);
  const clearCameraTweenRequest = useSceneStore((s) => s.clearCameraTweenRequest);
  const orbit = useSceneStore((s) => s.orbit);
  const setOrbit = useSceneStore((s) => s.setOrbit);
  const orbitStart = useRef(performance.now());

  // Track period changes so we can rebase the sweep without a visual jolt.
  const lastPeriod = useRef(orbit.periodSec);
  useEffect(() => {
    if (lastPeriod.current === orbit.periodSec) return;
    const now = performance.now();
    const elapsed = (now - orbitStart.current) / 1000;
    const sweepDeg = (elapsed / Math.max(1, lastPeriod.current)) * 360;
    const currentAz =
      ((useSceneStore.getState().orbit.azimuthDeg + sweepDeg) % 360 + 360) % 360;
    setOrbit({ azimuthDeg: currentAz });
    orbitStart.current = now;
    lastPeriod.current = orbit.periodSec;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbit.periodSec]);

  useEffect(() => {
    if (mode === "orbit") orbitStart.current = performance.now();
  }, [mode]);

  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === "orbit" && mode !== "orbit") {
      captureCurrentPoseAsIntent();
    }
    if (prevMode.current === "fly" && mode !== "fly") {
      if (typeof document !== "undefined" && document.pointerLockElement) {
        document.exitPointerLock();
      }
    }
    prevMode.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, camera]);

  useEffect(() => {
    if (mode !== "still") return;
    if (tween.current) return; // tween owns the camera until finished
    camera.position.set(intent.position[0], intent.position[1], intent.position[2]);
    if (intent.orient === "rotation") {
      camera.rotation.set(intent.rotation[0], intent.rotation[1], intent.rotation[2]);
    } else {
      camera.lookAt(intent.lookAt[0], intent.lookAt[1], intent.lookAt[2]);
    }
    camera.fov = intent.fov;
    camera.updateProjectionMatrix();
  }, [mode, intent, camera]);

  useEffect(() => {
    if (!tweenRequest) return;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const lookFrom = new THREE.Vector3().copy(camera.position).addScaledVector(fwd, 10);
    tween.current = {
      from: {
        position: [camera.position.x, camera.position.y, camera.position.z],
        lookAt: [lookFrom.x, lookFrom.y, lookFrom.z],
        fov: camera.fov,
      },
      to: {
        position: tweenRequest.to.position,
        lookAt: tweenRequest.to.lookAt,
        fov: tweenRequest.to.fov,
      },
      startedAt: performance.now(),
      durationMs: tweenRequest.durationMs,
      finalIntent: tweenRequest.to,
    };
    clearCameraTweenRequest();
  }, [tweenRequest, camera, clearCameraTweenRequest]);

  const captureCurrentPoseAsIntent = () => {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const target = new THREE.Vector3().copy(camera.position).addScaledVector(fwd, 10);
    setCameraIntent({
      position: [camera.position.x, camera.position.y, camera.position.z],
      lookAt: [target.x, target.y, target.z],
      rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
      fov: camera.fov,
      orient: "lookAt",
    });
  };

  useEffect(() => {
    const isTyping = () => {
      const el = typeof document !== "undefined" ? document.activeElement : null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el as HTMLElement).isContentEditable
      );
    };
    const onDown = (e: KeyboardEvent) => {
      if (isTyping()) return; // typing in a field (e.g. settings search) never drives the camera
      const currentMode = useSceneStore.getState().cameraMode;
      const k = keyOf(e);
      if (k && currentMode === "fly") {
        keys.current[k] = true;
        if (k === "space") e.preventDefault();
      }
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        if (currentMode === "fly") enterOrbitMode();
        else enterFlyMode();
        return;
      }
      // G switches to orbit when NOT in fly mode (in fly, S/G are movement keys).
      // Routes through enterOrbitMode so it also exits a held top-down cleanly.
      if (currentMode !== "fly" && key === "g") {
        enterOrbitMode();
      }
      // Space in orbit mode toggles auto-revolution. When pausing, settle the
      // current azimuth into the store + reset orbitStart so resume continues
      // from the same angle (same trick the drag handler uses).
      if (currentMode === "orbit" && e.key === " ") {
        e.preventDefault();
        const s = useSceneStore.getState();
        const next = !s.orbitPaused;
        if (next) {
          const now = performance.now();
          const elapsed = (now - orbitStart.current) / 1000;
          const sweepDeg = (elapsed / Math.max(1, s.orbit.periodSec)) * 360;
          const az = ((s.orbit.azimuthDeg + sweepDeg) % 360 + 360) % 360;
          s.setOrbit({ azimuthDeg: az });
          orbitStart.current = now;
        } else {
          orbitStart.current = performance.now();
        }
        s.setOrbitPaused(next);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = keyOf(e);
      if (k) keys.current[k] = false;
    };
    const onBlur = () => {
      keys.current = { ...initialKeys };
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [camera]);

  // Orbit drag state.
  //   LMB drag         = yaw + elevation (camera arcs around the fixed focal point)
  //   RMB drag         = focal Y (lookAtY) — vertical only for now
  //   Pinch            = radius zoom
  //   Two-finger pan   = focal Y
  //   Wheel            = radius zoom
  const dragging = useRef(false);
  const dragBase = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    azimuthDeg: number;
    elevationDeg: number;
    lookAtY: number;
    focal: boolean;
  } | null>(null);
  const pinch = useRef<{
    startDist: number;
    startRadius: number;
    startOrthoSize: number;
    startMidY: number;
    startLookAtY: number;
  } | null>(null);
  const activeTouches = useRef<Map<number, { x: number; y: number }>>(new Map());

  const FOCAL_Y_SENSITIVITY_RATIO = 0.005; // multiplied by orbit.radius — pan scales with how far out we are
  // Focal Y is a VERTICAL extent — building heights are fixed across size tiers,
  // so this range must NOT scale with city width (#47). Matches the literal panel
  // slider range and the literal DEFAULT_ORBIT.lookAtY.
  const LOOK_AT_Y_MIN = -200;
  const LOOK_AT_Y_MAX = 2000;

  const lastWrite = useRef(0);
  const lastPaused = useRef(false);
  useFrame((_, dt) => {
    const now = performance.now();
    if (now - lastWrite.current >= 100) {
      lastWrite.current = now;
      setCameraLive({
        position: [camera.position.x, camera.position.y, camera.position.z],
        rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
        fov: camera.fov,
      });
    }

    // Orbit mode — spherical revolution around configured centre.
    if (mode === "orbit") {
      const paused = useSceneStore.getState().orbitPaused;
      let azBase = orbit.azimuthDeg;

      // Catch programmatic pause/resume (e.g. top-down preset / Default restore)
      // in the same frame: bake the in-flight sweep into azimuthDeg on pause,
      // and restart the sweep clock on resume — so the camera never snaps.
      if (paused !== lastPaused.current) {
        if (paused) {
          const elapsed = (now - orbitStart.current) / 1000;
          const sweepDeg = (elapsed / Math.max(1, orbit.periodSec)) * 360;
          azBase = ((orbit.azimuthDeg + sweepDeg) % 360 + 360) % 360;
          setOrbit({ azimuthDeg: azBase });
          orbitStart.current = now;
        } else {
          orbitStart.current = now;
        }
        lastPaused.current = paused;
      }

      const elapsed = dragging.current || paused ? 0 : (now - orbitStart.current) / 1000;
      const sweepRad = (elapsed / Math.max(1, orbit.periodSec)) * Math.PI * 2;
      const az = azBase * DEG2RAD + sweepRad;
      const el = orbit.elevationDeg * DEG2RAD;
      const horizR = orbit.radius * Math.cos(el);
      const camY = orbit.radius * Math.sin(el);
      camera.position.set(
        orbit.centerX + Math.sin(az) * horizR,
        camY,
        orbit.centerZ + Math.cos(az) * horizR,
      );
      // Tip camera.up from world-Y toward +Z (north) as elevation approaches
      // 90°, so looking straight down never hits the up/view-direction gimbal
      // degeneracy. Flat (world-Y up) below 70°, fully tipped at 90°. Keyed on
      // elevation alone (not the top-down snapshot) so switching top-down →
      // orbit mid-drag stays seamless.
      // Up stays world-up for ALL orbit (level horizon — ground down, sky up) and
      // rolls toward +Z (north-up) only for top-down, driven by the tweened
      // topDownTip. Decoupled from elevation, so free orbiting never rolls the
      // horizon; the <90° elevation cap keeps world-up from gimballing.
      const upT = useSceneStore.getState().topDownTip;
      const upAng = upT * Math.PI * 0.5;
      camera.up.set(0, Math.cos(upAng), Math.sin(upAng));
      camera.lookAt(orbit.centerX, orbit.lookAtY, orbit.centerZ);
      return;
    }

    // Tween (still mode only)
    if (tween.current && mode === "still") {
      const tw = tween.current;
      const t = Math.min(1, (now - tw.startedAt) / tw.durationMs);
      const e = easeInOutCubic(t);
      const p = lerpVec3(tw.from.position, tw.to.position, e);
      const la = lerpVec3(tw.from.lookAt, tw.to.lookAt, e);
      camera.position.set(p[0], p[1], p[2]);
      camera.lookAt(la[0], la[1], la[2]);
      camera.fov = lerp(tw.from.fov, tw.to.fov, e);
      camera.updateProjectionMatrix();
      if (t >= 1) {
        useSceneStore.getState().setCameraIntent(tw.finalIntent);
        tween.current = null;
      }
      return;
    }

    if (mode !== "fly") return;

    const k = keys.current;
    const flySpeed = useSceneStore.getState().flySpeed;
    const baseSpeed = k.sprint ? flySpeed * FLY_SPRINT_MULTIPLIER : flySpeed;
    const dist = baseSpeed * dt;

    camera.getWorldDirection(forward.current);
    right.current.crossVectors(forward.current, worldUp.current).normalize();

    if (k.w) camera.position.addScaledVector(forward.current, dist);
    if (k.s) camera.position.addScaledVector(forward.current, -dist);
    if (k.d) camera.position.addScaledVector(right.current, dist);
    if (k.a) camera.position.addScaledVector(right.current, -dist);
    if (k.space) camera.position.y += dist;
    if (k.c) camera.position.y -= dist;
    if (k.q) camera.rotateZ(ROLL_SPEED * dt);
    if (k.e) camera.rotateZ(-ROLL_SPEED * dt);
  });

  // Orbit-mode pointer / touch / wheel handlers — yaw, pitch, pinch zoom.
  // Auto-revolution pauses while the user is dragging and resumes from the
  // newly-set azimuth on release.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    // Snapshot the touch map for cleanup — the ref identity is stable, but
    // exhaustive-deps wants `.current` captured inside the effect body.
    const touches = activeTouches.current;

    const settleAzimuthBeforeDrag = () => {
      const s = useSceneStore.getState();
      const now = performance.now();
      // Read pause + period LIVE and respect pause: when paused the sweep isn't
      // advancing, so orbitStart has been aging — adding (now − orbitStart)·speed
      // would bake a phantom sweep and jump the camera on click. Mirror exactly
      // what the useFrame sweep renders.
      const elapsed = s.orbitPaused ? 0 : (now - orbitStart.current) / 1000;
      const sweepDeg = (elapsed / Math.max(1, s.orbit.periodSec)) * 360;
      const az = ((s.orbit.azimuthDeg + sweepDeg) % 360 + 360) % 360;
      setOrbit({ azimuthDeg: az });
      orbitStart.current = now;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
      // Prevent native gestures (pinch-zoom, double-tap zoom, scroll) on touch.
      // The body sets `touch-action: none` so this is belt-and-braces.
      e.preventDefault();
      if (e.pointerType === "touch") {
        activeTouches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activeTouches.current.size === 2) {
          const pts = Array.from(activeTouches.current.values());
          const dx = pts[0].x - pts[1].x;
          const dy = pts[0].y - pts[1].y;
          const o = useSceneStore.getState().orbit;
          pinch.current = {
            startDist: Math.hypot(dx, dy),
            startRadius: o.radius,
            startOrthoSize: useSceneStore.getState().orthoSize,
            startMidY: (pts[0].y + pts[1].y) / 2,
            startLookAtY: o.lookAtY,
          };
          // The first finger may have started a drag — cancel it so pinch owns
          // both pointers cleanly.
          dragging.current = false;
          dragBase.current = null;
          dom.setPointerCapture?.(e.pointerId);
          return;
        }
      }
      const focal = e.pointerType === "mouse" && e.button === 2;
      if (!focal) settleAzimuthBeforeDrag();
      // Rotating the camera in top-down exits to plain Orbit (orbit rules apply).
      // Dropping the snapshot is seamless now that camera.up keys on elevation.
      if (!focal && useSceneStore.getState().orbitRestore !== null) {
        // Grabbing top-down to orbit it → exit to a LEVEL orbit: drop the
        // north-up roll and pull elevation just under vertical (same frame, so
        // world-up never gimbals at 90°). Resume the pre-top-down auto-revolution
        // state (top-down paused it) so the speed slider works again afterward.
        const st = useSceneStore.getState();
        const wasPaused = st.orbitRestore?.paused ?? false;
        st.setOrbitRestore(null);
        st.setTopDownTip(0);
        st.setOrbitPaused(wasPaused);
        if (st.orbit.elevationDeg > ORBIT_ELEVATION_MAX) {
          st.setOrbit({ elevationDeg: ORBIT_ELEVATION_MAX });
        }
      }
      dragging.current = true;
      const o = useSceneStore.getState().orbit;
      dragBase.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        azimuthDeg: o.azimuthDeg,
        elevationDeg: o.elevationDeg,
        lookAtY: o.lookAtY,
        focal,
      };
      if (focal) useSceneStore.getState().setFocalDragging(true);
      dom.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" && activeTouches.current.has(e.pointerId)) {
        activeTouches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.current && activeTouches.current.size === 2) {
          const pts = Array.from(activeTouches.current.values());
          const dx = pts[0].x - pts[1].x;
          const dy = pts[0].y - pts[1].y;
          const dist = Math.hypot(dx, dy);
          const scale = pinch.current.startDist / Math.max(1, dist);
          // In ortho, zoom = frustum half-height; in perspective, zoom = radius.
          const ortho = useSceneStore.getState().projection === "orthographic";
          if (ortho) {
            useSceneStore
              .getState()
              .setOrthoSize(
                clamp(pinch.current.startOrthoSize * scale, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX),
              );
          }
          const newRadius = clamp(
            pinch.current.startRadius * scale,
            ORBIT_RADIUS_MIN,
            ORBIT_RADIUS_MAX,
          );
          // Two-finger midpoint translation drives focal Y (lookAtY).
          const midY = (pts[0].y + pts[1].y) / 2;
          const focalSpeed = newRadius * FOCAL_Y_SENSITIVITY_RATIO;
          const newLookAtY = clamp(
            pinch.current.startLookAtY -
              (midY - pinch.current.startMidY) * focalSpeed,
            LOOK_AT_Y_MIN,
            LOOK_AT_Y_MAX,
          );
          setOrbit({ radius: ortho ? pinch.current.startRadius : newRadius, lookAtY: newLookAtY });
          return;
        }
      }
      if (!dragging.current || !dragBase.current) return;

      if (dragBase.current.focal) {
        // RMB-drag → focal Y. Horizontal axis idle until world-plane translation
        // arrives. Sensitivity scales with orbit.radius so far-out cameras get
        // proportional drag distance.
        const dy = e.clientY - dragBase.current.startY;
        const focalSpeed =
          useSceneStore.getState().orbit.radius * FOCAL_Y_SENSITIVITY_RATIO;
        const newLookAtY = clamp(
          dragBase.current.lookAtY - dy * focalSpeed,
          LOOK_AT_Y_MIN,
          LOOK_AT_Y_MAX,
        );
        setOrbit({ lookAtY: newLookAtY });
        return;
      }

      const dx = e.clientX - dragBase.current.startX;
      const dy = e.clientY - dragBase.current.startY;
      const newAz =
        ((dragBase.current.azimuthDeg - dx * ORBIT_YAW_SENSITIVITY) % 360 + 360) % 360;
      const newEl = clamp(
        dragBase.current.elevationDeg + dy * ORBIT_PITCH_SENSITIVITY,
        ORBIT_ELEVATION_MIN,
        ORBIT_ELEVATION_MAX,
      );
      setOrbit({ azimuthDeg: newAz, elevationDeg: newEl });
    };

    const onPointerEnd = (e: PointerEvent) => {
      const wasFocal = dragBase.current?.focal ?? false;
      activeTouches.current.delete(e.pointerId);
      if (activeTouches.current.size < 2) pinch.current = null;
      if (activeTouches.current.size === 0) {
        dragging.current = false;
        dragBase.current = null;
        orbitStart.current = performance.now();
      }
      if (wasFocal) useSceneStore.getState().setFocalDragging(false);
      dom.releasePointerCapture?.(e.pointerId);
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useSceneStore.getState();
      if (s.projection === "orthographic") {
        // Ortho zoom = frustum half-height (radius doesn't change apparent size).
        const factor = e.deltaY < 0 ? 1 / ORTHO_WHEEL_STEP : ORTHO_WHEEL_STEP;
        s.setOrthoSize(clamp(s.orthoSize * factor, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
        return;
      }
      const newRadius = clamp(
        s.orbit.radius + e.deltaY * ORBIT_WHEEL_SENSITIVITY,
        ORBIT_RADIUS_MIN,
        ORBIT_RADIUS_MAX,
      );
      setOrbit({ radius: newRadius });
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerEnd);
    dom.addEventListener("pointercancel", onPointerEnd);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("contextmenu", onContextMenu);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerEnd);
      dom.removeEventListener("pointercancel", onPointerEnd);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("contextmenu", onContextMenu);
      touches.clear();
      pinch.current = null;
      dragging.current = false;
      dragBase.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gl]);

  // Fly-mode wheel — adjust fly speed multiplicatively, UE5-style.
  useEffect(() => {
    if (mode !== "fly") return;
    const dom = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useSceneStore.getState();
      if (s.projection === "orthographic") {
        // Ortho: wheel zooms the frustum half-height (same as orbit).
        const factor = e.deltaY < 0 ? 1 / ORTHO_WHEEL_STEP : ORTHO_WHEEL_STEP;
        s.setOrthoSize(clamp(s.orthoSize * factor, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
        return;
      }
      const k = keys.current;
      const moving = k.w || k.a || k.s || k.d || k.space || k.c;
      if (moving) {
        // Mid-flight: wheel scales fly speed (UE5-style).
        const factor = e.deltaY < 0 ? FLY_WHEEL_STEP : 1 / FLY_WHEEL_STEP;
        s.setFlySpeed(clamp(s.flySpeed * factor, FLY_SPEED_MIN, FLY_SPEED_MAX));
      } else {
        // Stationary: wheel dollies forward / back along the view direction.
        camera.getWorldDirection(forward.current);
        camera.position.addScaledVector(forward.current, -e.deltaY * FLY_WHEEL_DOLLY);
      }
    };
    dom.addEventListener("wheel", onWheel, { passive: false });
    return () => dom.removeEventListener("wheel", onWheel);
  }, [mode, gl, camera]);

  // Fly-mode pointer lock — engaged only while the user is actively dragging
  // (mouse held down). Releasing returns the cursor; the camera keeps whatever
  // orientation it ended on. UE5-style.
  useEffect(() => {
    if (mode !== "fly") return;
    const dom = gl.domElement;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement !== dom) {
        dom.requestPointerLock?.();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement === dom) {
        document.exitPointerLock();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== dom) return;
      _euler.setFromQuaternion(camera.quaternion);
      _euler.y -= e.movementX * POINTER_SENSITIVITY;
      _euler.x -= e.movementY * POINTER_SENSITIVITY;
      _euler.x = Math.max(-HALF_PI + 0.001, Math.min(HALF_PI - 0.001, _euler.x));
      camera.quaternion.setFromEuler(_euler);
    };

    dom.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousemove", onMouseMove);

    return () => {
      dom.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousemove", onMouseMove);
      if (document.pointerLockElement === dom) document.exitPointerLock();
    };
  }, [mode, gl, camera]);

  // Fly-mode touch — 1-finger drag looks around (yaw/pitch); 2-finger pinch
  // flies forward / back along the view direction (pinch out = forward).
  useEffect(() => {
    if (mode !== "fly") return;
    const dom = gl.domElement;
    const touches = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      e.preventDefault();
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const p = Array.from(touches.values());
        pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      }
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
      e.preventDefault();
      const prev = touches.get(e.pointerId) as { x: number; y: number };
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        const p = Array.from(touches.values());
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        camera.getWorldDirection(forward.current);
        camera.position.addScaledVector(forward.current, (d - pinchDist) * FLY_PINCH_DOLLY);
        pinchDist = d;
      } else {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        _euler.setFromQuaternion(camera.quaternion);
        _euler.y -= dx * POINTER_SENSITIVITY;
        _euler.x -= dy * POINTER_SENSITIVITY;
        _euler.x = Math.max(-HALF_PI + 0.001, Math.min(HALF_PI - 0.001, _euler.x));
        camera.quaternion.setFromEuler(_euler);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.delete(e.pointerId);
      dom.releasePointerCapture?.(e.pointerId);
    };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointercancel", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointercancel", onUp);
    };
  }, [mode, gl, camera]);

  return null;
}
