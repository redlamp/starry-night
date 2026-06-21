"use client";

// Drei MapControls method. Unlike the other orbit methods (which share one
// camera-controls instance), this is three.js OrbitControls rebound for maps
// (left = pan, right = orbit, wheel = zoom), so it mounts its own controller.
// Sets the focus on mount, re-homes on the reset signal, and reports the readout.

import { useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import { MOUSE, PerspectiveCamera, Vector3 } from "three";
import type { LabTuning } from "./tuning";
import type { CamReadout } from "@/components/scene/CameraDiagram";
import { snapFocalY } from "./labProjection";

const DEG = Math.PI / 180;
const FOCAL_Y_GAIN = 0.9; // pin-drag sensitivity (focal-Y change per screen-fraction × distance)
const PIN_HIT_PX = 30; // screen radius to grab the focus pin
const _pinV = new Vector3();

export function LabMapControls({
  tuning,
  home,
  resetSignal,
  onReadout,
  focusRef,
  showPin,
}: {
  tuning: LabTuning;
  home: { pos: readonly [number, number, number]; target: readonly [number, number, number] };
  resetSignal: number;
  onReadout: (r: CamReadout) => void;
  focusRef: React.RefObject<Vector3>;
  showPin: boolean;
}) {
  const ref = useRef<ComponentRef<typeof MapControls>>(null);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const showPinRef = useRef(showPin);
  useEffect(() => {
    showPinRef.current = showPin;
  }, [showPin]);

  // frame the field on mount (the LMB/RMB flip is a prop below, so it applies via R3F
  // regardless of when this ref resolves). Expose for debugging, like the app's window.__cam.
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    (window as unknown as Record<string, unknown>).__labMap = m;
    m.target.set(home.target[0], home.target[1], home.target[2]);
    m.update();
  }, [home]);

  // reset view: jump camera + target home (skip the initial mount)
  const lastReset = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === lastReset.current) return;
    lastReset.current = resetSignal;
    const m = ref.current;
    if (!m) return;
    m.object.position.set(home.pos[0], home.pos[1], home.pos[2]);
    m.target.set(home.target[0], home.target[1], home.target[2]);
    m.update();
  }, [resetSignal, home]);

  // Pin-drag = scrub focal Y. Grab the focus pin and drag vertically: MapControls is
  // suppressed for that drag (enabled=false), and we move only target.y so OrbitControls
  // re-aims from the same camera position (the app's tilt-to-focal-Y feel).
  useEffect(() => {
    const dom = gl.domElement;
    let scrubbing = false;
    let lastY = 0;
    let rawY = 0; // raw accumulated focal Y (the detent below holds the applied value at 0)
    let snapped = false;
    const pinScreen = () => {
      const m = ref.current;
      if (!m) return null;
      _pinV.copy(m.target).project(camera);
      const r = dom.getBoundingClientRect();
      return {
        x: r.left + ((_pinV.x + 1) / 2) * r.width,
        y: r.top + ((1 - _pinV.y) / 2) * r.height,
      };
    };
    const onDown = (e: PointerEvent) => {
      if (!showPinRef.current) return; // only grab the pin when it's shown
      const m = ref.current;
      if (!m) return;
      const p = pinScreen();
      if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > PIN_HIT_PX) return;
      scrubbing = true;
      lastY = e.clientY;
      rawY = m.target.y;
      snapped = m.target.y === 0;
      m.enabled = false; // suppress MapControls for this drag
      try {
        dom.setPointerCapture?.(e.pointerId);
      } catch {
        // inactive pointer (e.g. synthetic) — capture is optional
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!scrubbing) return;
      const m = ref.current;
      if (!m) return;
      const dy = e.clientY - lastY;
      lastY = e.clientY;
      const k = (m.getDistance() / Math.max(1, dom.clientHeight)) * FOCAL_Y_GAIN;
      rawY = Math.max(-1000, Math.min(1000, rawY - dy * k)); // drag up raises the focus → view tilts up
      const snap = snapFocalY(rawY, snapped, m.getDistance()); // sticky detent at ground level
      snapped = snap.snapped;
      m.target.y = snap.y;
      m.update();
    };
    const onUp = () => {
      if (!scrubbing) return;
      scrubbing = false;
      const m = ref.current;
      if (m) m.enabled = true;
    };
    dom.addEventListener("pointerdown", onDown, true); // capture: beat OrbitControls' handler
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [gl, camera]);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    focusRef.current.copy(m.target); // every frame so the pin tracks smoothly
    const dist = m.getDistance(); // readout every frame — the ref-backed HUD throttles its own paint
    const persp = camera as PerspectiveCamera;
    onReadout({
      elev: 90 - (m.getPolarAngle() * 180) / Math.PI,
      dist,
      focalY: m.target.y,
      camY: camera.position.y,
      parallel: false, // MapControls runs perspective only in the lab
      frustumHh: dist * Math.tan(((persp.fov || 50) * DEG) / 2),
      blend: 0,
    });
  });

  return (
    <MapControls
      ref={ref}
      makeDefault
      mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      enableDamping={tuning.smoothTime > 0.02}
      dampingFactor={0.08}
      rotateSpeed={tuning.rotateSpeed}
      zoomSpeed={tuning.zoomSpeed}
      panSpeed={tuning.panSpeed}
      minDistance={50}
      maxDistance={8000}
    />
  );
}
