"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
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

export function CameraControls() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
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

  const exitFly = () => {
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
    setCameraMode("still");
    if (typeof document !== "undefined" && document.pointerLockElement) {
      document.exitPointerLock();
    }
  };

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const k = keyOf(e);
      if (k) {
        keys.current[k] = true;
        if (k === "space") e.preventDefault();
      }
      if ((e.key === "f" || e.key === "F") && !e.repeat) {
        if (useSceneStore.getState().cameraMode === "fly") exitFly();
        else setCameraMode("fly");
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
    const baseSpeed = k.sprint ? 40 : 14;
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

  if (mode === "fly") {
    return <PointerLockControls onUnlock={exitFly} />;
  }
  return null;
}
