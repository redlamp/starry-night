"use client";

import { useCallback, useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { GROUND_APRON_M } from "../Ground";
import { writeOrbitPose } from "./orbitWriteback";

// "Google Earth" — a faithful reference of Google Earth's stock controls, on drei MapControls
// (three.js OrbitControls rebound for maps). Kept vanilla as a benchmark; the Starry-Night
// refinements built on top of it this session — the click-pin orbit, grab-look, hand cursor —
// moved to "Starry Night Cam v2".
//
//   Desktop   LMB drag           Move — pan across the ground (orientation kept)
//             RMB / Shift+LMB    Orbit + Tilt
//             wheel              Zoom toward the cursor
//             double-click       Zoom in toward the clicked point
//   Touch     1-finger  pan  ·  2-finger  pinch-zoom + twist-rotate
//
// Perspective only + frame-on-mount + ~10/s pose write-back, like the sibling comparison models.
// Self-gates to orbit.

const DEG = Math.PI / 180;
const _target = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// Ground point (y = 0) under a client-space pointer (perspective only — GE mode forces it).
function groundHit(
  cam: THREE.Camera,
  dom: HTMLElement,
  clientX: number,
  clientY: number,
  out: THREE.Vector3,
): boolean {
  const r = dom.getBoundingClientRect();
  _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
  _ray.setFromCamera(_ndc, cam);
  return _ray.ray.intersectPlane(_plane, out) !== null;
}

export function GoogleEarthModel() {
  const ref = useRef<ComponentRef<typeof MapControls>>(null);
  const cam = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const mode = useSceneStore((s) => s.cameraMode);
  const lastWrite = useRef(0);

  // Force perspective while active; restore the prior projection on exit.
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

  // Frame the city + GE-flavoured MapControls config.
  const frame = useCallback(() => {
    const m = ref.current;
    if (!m) return;
    const s = useSceneStore.getState();
    const tier = CITY_TIERS[s.citySize] + GROUND_APRON_M;
    const R = tier * 2.0;
    const elev = 28 * DEG;
    const az = s.orbit.azimuthDeg * DEG;
    const cx = CITY_CENTER.x;
    const cz = CITY_CENTER.z;
    m.target.set(cx, 0, cz);
    m.object.position.set(
      cx + R * Math.cos(elev) * Math.sin(az),
      R * Math.sin(elev),
      cz + R * Math.cos(elev) * Math.cos(az),
    );
    m.minDistance = tier * 0.15;
    m.maxDistance = tier * 8;
    m.maxPolarAngle = Math.PI / 2 - 0.01; // never orbit under the ground
    m.screenSpacePanning = false; // pan over the GROUND (GE's move), not the screen plane
    m.zoomToCursor = true; // GE zooms toward the pointer
    m.mouseButtons.LEFT = THREE.MOUSE.PAN; // GE: LMB moves
    m.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; // GE: RMB orbits + tilts
    m.update();
  }, []);

  useEffect(() => {
    frame();
  }, [frame]);

  // Shift+LMB = orbit twin (Mac-safe, no RMB needed); double-click = zoom in toward the point.
  useEffect(() => {
    const dom = gl.domElement;
    const onKeyDown = (e: KeyboardEvent) => {
      const m = ref.current;
      if (m && e.key === "Shift") m.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const m = ref.current;
      if (m && e.key === "Shift") m.mouseButtons.LEFT = THREE.MOUSE.PAN;
    };
    const onDbl = (e: MouseEvent) => {
      const m = ref.current;
      if (!m) return;
      if (!groundHit(cam, dom, e.clientX, e.clientY, _cur)) return;
      // Centre the clicked point and dolly ~40% closer (GE / Maps double-click zoom-in).
      _eye.copy(m.object.position).sub(_cur).multiplyScalar(0.6).add(_cur);
      m.target.copy(_cur);
      m.object.position.copy(_eye);
      m.update();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    dom.addEventListener("dblclick", onDbl);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      dom.removeEventListener("dblclick", onDbl);
    };
  }, [gl, cam]);

  // ~10/s pose write-back so fog / moon-follow / panel readout track the live view.
  useFrame((state) => {
    const m = ref.current;
    if (!m || mode !== "orbit") return;
    const tt = state.clock.elapsedTime;
    if (tt - lastWrite.current >= 0.1) {
      lastWrite.current = tt;
      _target.copy(m.target);
      writeOrbitPose(state.camera as THREE.PerspectiveCamera, _target);
    }
  });

  if (mode !== "orbit") return null;
  return <MapControls ref={ref} makeDefault />;
}
