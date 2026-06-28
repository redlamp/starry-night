"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { orbitFramingFactor } from "@/lib/scene/aspectFraming";
import { GROUND_APRON_M } from "../Ground";

// "Turntable" — a showcase spin. The city rotates steadily at a fixed elevation,
// presented like a model on a rotating stage. Unlike Drift (hands-off, organic
// wander) you can GRAB it: drag horizontally to spin it by hand; the auto-spin pauses
// and resumes shortly after release. Space pauses. Elevation + spin rate are live in
// Settings -> Orbit -> Turntable.
//
// Determinism: the auto-spin is a pure function of the R3F clock; the drag is live
// pointer input (runtime, like every gesture). Camera is runtime state, so gate1 is
// unaffected.

const DEG = Math.PI / 180;
const round1 = (n: number) => Math.round(n * 10) / 10;
const RADIUS_FACTOR = 1.7; // orbit radius as a multiple of the city half-extent (+ apron); clip-safe in ortho
const FOCAL_Y = 0; // aim at the ground centre
const RESUME_DELAY = 0.6; // s after a grab-drag before the auto-spin resumes
const DRAG_PX = 6; // press -> drag threshold (a click doesn't grab)
const DRAG_SENS = 0.3; // deg of azimuth per px of horizontal drag

// Shared low-angle curve (mirrors DreiSceneControls.lowAngleT) for the framing pull.
function lowAngleT(elevDeg: number, lowAngleDeg: number): number {
  const x = Math.max(0, Math.min(1, (lowAngleDeg - elevDeg) / Math.max(1, lowAngleDeg)));
  return x * x * (3 - 2 * x);
}

export function TurntableModel() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const mode = useSceneStore((s) => s.cameraMode);
  const gl = useThree((s) => s.gl);
  const azimuth = useRef(0); // current azimuth (deg); advanced by spin, nudged by drag
  const seeded = useRef(false);
  const paused = useRef(false);
  const dragging = useRef(false);
  const wasDragging = useRef(false);
  const resumeAt = useRef(0);
  const lastWrite = useRef(0);

  // Disable camera-controls' native input — the frame loop owns the pose, and the
  // drag is handled by our own listener so it can nudge the azimuth directly.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    c.mouseButtons.left = A.NONE;
    c.mouseButtons.middle = A.NONE;
    c.mouseButtons.right = A.NONE;
    c.mouseButtons.wheel = A.NONE;
    c.touches.one = A.NONE;
    c.touches.two = A.NONE;
    c.touches.three = A.NONE;
    c.minDistance = 1;
    c.maxDistance = Infinity;
    c.minPolarAngle = 0;
    c.maxPolarAngle = Math.PI;
  }, [mode]);

  // Grab-to-spin (LMB / 1-finger horizontal drag) + Space pause.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    let pressed = false;
    let downX = 0;
    let lastX = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // primary button / first touch
      pressed = true;
      downX = e.clientX;
      lastX = e.clientX;
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!pressed) return;
      if (!dragging.current && Math.abs(e.clientX - downX) >= DRAG_PX) dragging.current = true;
      if (dragging.current) {
        azimuth.current = (azimuth.current - (e.clientX - lastX) * DRAG_SENS) % 360; // drag = spin
        lastX = e.clientX;
      }
    };
    const onUp = (e: PointerEvent) => {
      pressed = false;
      dragging.current = false;
      dom.releasePointerCapture?.(e.pointerId);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      paused.current = !paused.current;
    };
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [mode, gl]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const s = useSceneStore.getState();
    const cfg = s.turntable;
    const tt = state.clock.elapsedTime;
    const cam = state.camera as THREE.PerspectiveCamera;

    // seed the azimuth from the stored pose on the first frame (continuity with Map).
    if (!seeded.current) {
      azimuth.current = s.orbit.azimuthDeg;
      seeded.current = true;
    }

    // resume the auto-spin a short beat after a grab-drag ends.
    if (wasDragging.current && !dragging.current) resumeAt.current = tt + RESUME_DELAY;
    wasDragging.current = dragging.current;

    const spinning =
      !paused.current && !dragging.current && tt >= resumeAt.current && cfg.spinSec > 0;
    if (spinning) azimuth.current = (azimuth.current + (360 / cfg.spinSec) * dt) % 360;

    const tier = CITY_TIERS[s.citySize] + GROUND_APRON_M;
    const R = tier * RADIUS_FACTOR;
    const polar = (90 - cfg.elevDeg) * DEG;
    const sp = Math.sin(polar);
    const cp = Math.cos(polar);
    const az = azimuth.current * DEG;
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    void c.setLookAt(
      cx + R * sp * Math.sin(az),
      FOCAL_Y + R * cp,
      cz + R * sp * Math.cos(az),
      cx,
      FOCAL_Y,
      cz,
      false,
    );

    // Same low-angle ground-pull framing as Drift/Map: at low elevation the skyline
    // sits low with sky above; at higher showcase angles the pull relaxes and the
    // city fills more of the frame.
    const oeff = s.orthoSize * orbitFramingFactor(cam.aspect);
    const perspK = R * Math.tan((cam.fov * DEG) / 2);
    const halfH = perspK + (oeff - perspK) * s.projectionBlend;
    const tLow = lowAngleT(cfg.elevDeg, s.rotateSlowBelowDeg);
    const pivot = s.orbitPivotFromBottom + (s.groundFrameLow - s.orbitPivotFromBottom) * tLow;
    c.setFocalOffset(0, (pivot - 0.5) * 2 * halfH, 0, false);

    // sync ~10/s so fog, moon-follow, projection morph, and the panel readout track it.
    if (tt - lastWrite.current >= 0.1) {
      lastWrite.current = tt;
      s.setCameraLive({
        position: [cam.position.x, cam.position.y, cam.position.z],
        rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
        fov: cam.fov,
      });
      s.setOrbit({
        azimuthDeg: round1(((azimuth.current % 360) + 360) % 360),
        elevationDeg: round1(cfg.elevDeg),
        radius: Math.round(R),
        centerX: Math.round(cx),
        centerZ: Math.round(cz),
        lookAtY: FOCAL_Y,
      });
    }
  });

  if (mode !== "orbit") return null;
  return <CameraControls ref={controls} />;
}
