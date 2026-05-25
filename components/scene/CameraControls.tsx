"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore, type CameraIntent, type Vec3 } from "@/lib/state/sceneStore";

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

const POINTER_SENSITIVITY = 0.002;
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const HALF_PI = Math.PI / 2;
const DEG2RAD = Math.PI / 180;

// Orbit drag tuning
const ORBIT_YAW_SENSITIVITY = 0.25; // deg per pixel
const ORBIT_PITCH_SENSITIVITY = 0.25; // deg per pixel
const ORBIT_WHEEL_SENSITIVITY = 0.5; // metres per wheel-delta tick
const ORBIT_RADIUS_MIN = 50;
const ORBIT_RADIUS_MAX = 5000;
const ORBIT_ELEVATION_MIN = 0.01; // hair above horizon — el = 0 clips the ground plane and culls it from the frame
const ORBIT_ELEVATION_MAX = 90; // can sit directly above the city, no flip-over

export function CameraControls() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const mode = useSceneStore((s) => s.cameraMode);
  const intent = useSceneStore((s) => s.cameraIntent);
  const setCameraLive = useSceneStore((s) => s.setCameraLive);
  const setCameraMode = useSceneStore((s) => s.setCameraMode);
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

  const exitFly = () => {
    captureCurrentPoseAsIntent();
    setCameraMode("still");
    if (typeof document !== "undefined" && document.pointerLockElement) {
      document.exitPointerLock();
    }
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
      const currentMode = useSceneStore.getState().cameraMode;
      const k = keyOf(e);
      if (k && currentMode === "fly") {
        keys.current[k] = true;
        if (k === "space") e.preventDefault();
      }
      if (e.repeat || isTyping()) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        if (currentMode === "fly") exitFly();
        else setCameraMode("fly");
        return;
      }
      // S and G switch modes only when NOT in fly mode (S is a movement key there).
      if (currentMode !== "fly") {
        if (key === "s") setCameraMode("still");
        else if (key === "g") setCameraMode("orbit");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  // Orbit drag state.
  //   Bare drag        = yaw + pitch
  //   Shift + drag     = focal y (lookAtY) — vertical only for now
  //   Pinch            = radius zoom
  //   Two-finger pan   = focal y (lookAtY)
  //   Wheel            = radius zoom
  const dragging = useRef(false);
  const dragBase = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    azimuthDeg: number;
    elevationDeg: number;
    lookAtY: number;
    shift: boolean;
  } | null>(null);
  const pinch = useRef<{
    startDist: number;
    startRadius: number;
    startMidY: number;
    startLookAtY: number;
  } | null>(null);
  const activeTouches = useRef<Map<number, { x: number; y: number }>>(new Map());

  const FOCAL_Y_SENSITIVITY_RATIO = 0.005; // multiplied by orbit.radius — pan scales with how far out we are
  const LOOK_AT_Y_MIN = -200;
  const LOOK_AT_Y_MAX = 2000;

  const lastWrite = useRef(0);
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
      const elapsed = dragging.current ? 0 : (now - orbitStart.current) / 1000;
      const sweepRad = (elapsed / Math.max(1, orbit.periodSec)) * Math.PI * 2;
      const az = orbit.azimuthDeg * DEG2RAD + sweepRad;
      const el = orbit.elevationDeg * DEG2RAD;
      const horizR = orbit.radius * Math.cos(el);
      const height = orbit.radius * Math.sin(el);
      camera.position.set(
        orbit.centerX + Math.sin(az) * horizR,
        height,
        orbit.centerZ + Math.cos(az) * horizR,
      );
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

    const settleAzimuthBeforeDrag = () => {
      const now = performance.now();
      const elapsed = (now - orbitStart.current) / 1000;
      const sweepDeg = (elapsed / Math.max(1, orbit.periodSec)) * 360;
      const az =
        ((useSceneStore.getState().orbit.azimuthDeg + sweepDeg) % 360 + 360) % 360;
      setOrbit({ azimuthDeg: az });
      orbitStart.current = now;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
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
            startMidY: (pts[0].y + pts[1].y) / 2,
            startLookAtY: o.lookAtY,
          };
          dragging.current = false;
          dragBase.current = null;
          return;
        }
      }
      settleAzimuthBeforeDrag();
      dragging.current = true;
      const o = useSceneStore.getState().orbit;
      dragBase.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        azimuthDeg: o.azimuthDeg,
        elevationDeg: o.elevationDeg,
        lookAtY: o.lookAtY,
        shift: e.shiftKey,
      };
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
          const newRadius = clamp(
            pinch.current.startRadius * scale,
            ORBIT_RADIUS_MIN,
            ORBIT_RADIUS_MAX,
          );
          // Two-finger midpoint translation drives focal Y (lookAtY).
          // Applied on top of the radius change so a translating pinch still zooms.
          const midY = (pts[0].y + pts[1].y) / 2;
          const focalSpeed = newRadius * FOCAL_Y_SENSITIVITY_RATIO;
          const newLookAtY = clamp(
            pinch.current.startLookAtY -
              (midY - pinch.current.startMidY) * focalSpeed,
            LOOK_AT_Y_MIN,
            LOOK_AT_Y_MAX,
          );
          setOrbit({ radius: newRadius, lookAtY: newLookAtY });
          return;
        }
      }
      if (!dragging.current || !dragBase.current) return;

      // Re-anchor if Shift state changed mid-drag so neither mode jumps.
      if (e.shiftKey !== dragBase.current.shift) {
        const o = useSceneStore.getState().orbit;
        dragBase.current = {
          ...dragBase.current,
          startX: e.clientX,
          startY: e.clientY,
          azimuthDeg: o.azimuthDeg,
          elevationDeg: o.elevationDeg,
          lookAtY: o.lookAtY,
          shift: e.shiftKey,
        };
        return;
      }

      if (e.shiftKey) {
        // Vertical drag → focal Y. Horizontal axis is intentionally idle until
        // we wire up world-plane focal translation.
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
      activeTouches.current.delete(e.pointerId);
      if (activeTouches.current.size < 2) pinch.current = null;
      if (activeTouches.current.size === 0) {
        dragging.current = false;
        dragBase.current = null;
        orbitStart.current = performance.now();
      }
      dom.releasePointerCapture?.(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const o = useSceneStore.getState().orbit;
      const newRadius = clamp(
        o.radius + e.deltaY * ORBIT_WHEEL_SENSITIVITY,
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

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerEnd);
      dom.removeEventListener("pointercancel", onPointerEnd);
      dom.removeEventListener("wheel", onWheel);
      activeTouches.current.clear();
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
      const factor = e.deltaY < 0 ? FLY_WHEEL_STEP : 1 / FLY_WHEEL_STEP;
      const next = clamp(s.flySpeed * factor, FLY_SPEED_MIN, FLY_SPEED_MAX);
      s.setFlySpeed(next);
    };
    dom.addEventListener("wheel", onWheel, { passive: false });
    return () => dom.removeEventListener("wheel", onWheel);
  }, [mode, gl]);

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

  return null;
}
