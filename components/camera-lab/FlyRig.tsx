"use client";

// FPS / editor flythrough: WASD move, E/Space up, Q/C/Shift down, hold-drag to look
// (horizon-locked, no roll), wheel = move speed. Releasing the drag frees the cursor
// (no continuous re-aim). Ported from the /drei-lab DragLookFly, tuning-driven.

import { useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LabTuning } from "./tuning";

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _UP = new THREE.Vector3(0, 1, 0);

export function FlyRig({
  tuning,
  home,
  resetSignal = 0,
}: {
  tuning: LabTuning;
  home?: { pos: readonly [number, number, number]; target: readonly [number, number, number] };
  resetSignal?: number;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const keys = useRef<Record<string, boolean>>({});
  const dragging = useRef(false);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const speed = useRef(tuning.flyMove);
  const tun = useRef(tuning);
  useEffect(() => {
    tun.current = tuning;
  }, [tuning]);

  // seed orientation from the current camera (carry over from the orbit method)
  useEffect(() => {
    _euler.setFromQuaternion(camera.quaternion);
    yaw.current = _euler.y;
    pitch.current = _euler.x;
    speed.current = tun.current.flyMove;
  }, [camera]);

  // Reset view: jump to home + re-aim. Skip the initial mount (so entering fly
  // carries over the orbit pose); only fire when resetSignal actually changes.
  const lastReset = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === lastReset.current || !home) return;
    lastReset.current = resetSignal;
    camera.position.set(home.pos[0], home.pos[1], home.pos[2]);
    camera.lookAt(home.target[0], home.target[1], home.target[2]);
    _euler.setFromQuaternion(camera.quaternion);
    yaw.current = _euler.y;
    pitch.current = _euler.x;
  }, [resetSignal, home, camera]);

  useEffect(() => {
    const dom = gl.domElement;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      dragging.current = false;
      dom.releasePointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const ls = tun.current.flyLook;
      yaw.current -= (e.clientX - lastX) * ls;
      pitch.current -= (e.clientY - lastY) * ls;
      lastX = e.clientX;
      lastY = e.clientY;
      const lim = Math.PI / 2 - 0.01;
      pitch.current = Math.max(-lim, Math.min(lim, pitch.current));
    };
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const kd = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.code === "Space") e.preventDefault();
      keys.current[e.code] = true;
    };
    const ku = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.001);
      speed.current = Math.min(1200, Math.max(5, speed.current * f));
    };
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      keys.current = {};
      dragging.current = false;
    };
  }, [gl]);

  useFrame((_, dt) => {
    _euler.set(pitch.current, yaw.current, 0, "YXZ");
    camera.quaternion.setFromEuler(_euler);
    const k = keys.current;
    const v = speed.current * dt;
    camera.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, _UP).normalize();
    if (k["KeyW"]) camera.position.addScaledVector(_fwd, v);
    if (k["KeyS"]) camera.position.addScaledVector(_fwd, -v);
    if (k["KeyD"]) camera.position.addScaledVector(_right, v);
    if (k["KeyA"]) camera.position.addScaledVector(_right, -v);
    if (k["KeyE"] || k["Space"]) camera.position.y += v;
    if (k["KeyQ"] || k["KeyC"] || k["ShiftLeft"] || k["ShiftRight"]) camera.position.y -= v;
  });

  return null;
}
