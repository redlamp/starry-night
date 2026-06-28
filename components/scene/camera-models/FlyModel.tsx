"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_SCALE, CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { GROUND_APRON_M } from "../Ground";
import { useDoubleClickReset } from "./cameraReset";

// "Fly" — free first-person flight in PERSPECTIVE (per spec). W/S fly along the look
// direction, A/D strafe, E up / Q down in world space (no roll/tilt), drag to look
// (yaw + pitch), wheel sets speed, Shift sprints. Forces perspective on entry and
// restores the prior projection on exit. Driven directly (no camera-controls).

const LOOK_SENS = 0.0025; // rad per pixel of drag
const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;
const BASE_SPEED = 600 * CITY_SCALE; // world units / sec at the default speed
const MIN_SPEED = 60 * CITY_SCALE;
const MAX_SPEED = 6000 * CITY_SCALE;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");

export function FlyModel() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const keys = useRef<Set<string>>(new Set());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const speed = useRef(BASE_SPEED);
  const seeded = useRef(false);
  const lastWrite = useRef(0);

  // Force perspective while flying; restore the prior projection on exit.
  useEffect(() => {
    const s = useSceneStore.getState();
    const prevProj = s.projection;
    const prevBlend = s.projectionBlend;
    s.setProjection("perspective");
    s.setProjectionBlend(0);
    return () => {
      const s2 = useSceneStore.getState();
      s2.setProjection(prevProj);
      s2.setProjectionBlend(prevBlend);
    };
  }, []);

  // Keyboard, drag-look, wheel-speed.
  useEffect(() => {
    const dom = gl.domElement;
    const keySet = keys.current;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      keySet.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keySet.delete(e.code);
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      yaw.current -= (e.clientX - lastX) * LOOK_SENS;
      pitch.current = clamp(
        pitch.current - (e.clientY - lastY) * LOOK_SENS,
        -HALF_PI * 0.98,
        HALF_PI * 0.98,
      );
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      dom.releasePointerCapture?.(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      speed.current = clamp(speed.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_SPEED, MAX_SPEED);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel);
      keySet.clear();
    };
  }, [gl]);

  // Double-click returns to a default establishing fly pose + speed (e.g. after flying off into space).
  useDoubleClickReset(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const s = useSceneStore.getState();
    const tier = CITY_TIERS[s.citySize] + GROUND_APRON_M;
    const R = tier * 2.0;
    const elev = 28 * DEG;
    const az = s.orbit.azimuthDeg * DEG;
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    cam.position.set(
      cx + R * Math.cos(elev) * Math.sin(az),
      R * Math.sin(elev),
      cz + R * Math.cos(elev) * Math.cos(az),
    );
    // Aim at the city centre — derive yaw/pitch from the look direction (FlyModel's YXZ convention:
    // fwd = (−cos·sin yaw, sin pitch, −cos·cos yaw)).
    const lx = cx - cam.position.x;
    const ly = -cam.position.y;
    const lz = cz - cam.position.z;
    const len = Math.hypot(lx, ly, lz) || 1;
    pitch.current = Math.asin(ly / len);
    yaw.current = Math.atan2(-lx / len, -lz / len);
    speed.current = BASE_SPEED;
  });

  useFrame((state, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    // Seed yaw/pitch from the camera's current orientation on the first frame, so fly
    // continues from wherever the previous model left off.
    if (!seeded.current) {
      _euler.setFromQuaternion(cam.quaternion, "YXZ");
      yaw.current = _euler.y;
      pitch.current = _euler.x;
      seeded.current = true;
    }
    // Look (no roll).
    _euler.set(pitch.current, yaw.current, 0, "YXZ");
    cam.quaternion.setFromEuler(_euler);
    // Move: W/S along the look direction, A/D strafe, E/Q world up/down.
    _move.set(0, 0, 0);
    const k = keys.current;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    if (k.has("KeyW")) _move.add(_fwd);
    if (k.has("KeyS")) _move.sub(_fwd);
    if (k.has("KeyD")) _move.add(_right);
    if (k.has("KeyA")) _move.sub(_right);
    if (k.has("KeyE")) _move.y += 1;
    if (k.has("KeyQ")) _move.y -= 1;
    if (_move.lengthSq() > 0) {
      const sprint = k.has("ShiftLeft") || k.has("ShiftRight") ? 3 : 1;
      cam.position.addScaledVector(_move.normalize(), speed.current * sprint * dt);
    }
    cam.updateMatrixWorld();
    // Throttled cameraLive for fog / moon-follow.
    if (state.clock.elapsedTime - lastWrite.current >= 0.1) {
      lastWrite.current = state.clock.elapsedTime;
      useSceneStore.getState().setCameraLive({
        position: [cam.position.x, cam.position.y, cam.position.z],
        rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
        fov: cam.fov,
      });
    }
  });

  return null;
}
