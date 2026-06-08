"use client";

import { useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Html, Line } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { MapPin } from "lucide-react";
import * as THREE from "three";
import { useSceneStore, DEFAULT_ORBIT, type OrbitConfig } from "@/lib/state/sceneStore";
import { CITY_SCALE } from "@/lib/seed/topology";

// Phase-1 (sub-step A) orbit bridge onto drei <CameraControls>. Mounted only
// behind the ?controls=drei flag in Scene.tsx; production stays on the old
// components/scene/CameraControls.tsx. See wiki/notes/plan-drei-camera-migration.md
// "Phase 1 — build sequence" for the data-flow inversion and what's deferred.
//
// Input = the Google-Maps model (rotate/tilt on RMB instead of Google's Ctrl+LMB):
//   LMB-drag  → pan (grab-the-earth, custom ground-anchored pan)
//   RMB-drag  → rotate (L/R) + tilt (U/D)
//   wheel     → zoom toward the cursor (both projections)
//   dbl-click → zoom in, recentred on the clicked point
//   1-finger  → pan (ground);  2-finger → pinch-zoom + twist-rotate + parallel-drag tilt
// Plus the hand-rolled auto-revolution sweep (Space pause, drag threshold, resume
// ramp) and throttled cameraLive (fog / moon-follow). NOT yet ported: slider/preset
// → camera sync, projection swap, fly, still (flag off for those).
//
// Ortho vs perspective: pan/zoom are projection-customised (ortho = orthoSize +
// a hand-built parallel ray; perspective = dolly + the standard ray), behind one
// shared groundHit / zoomToPoint so both feel the same. Rotate/tilt are shared.

const DEG = Math.PI / 180;
const _tgt = new THREE.Vector3();
const _focal = new THREE.Vector3();

// Ortho zoom = frustum half-height (matches the old controller + ProjectionBlender).
const WHEEL_STEP = 1.1; // wheel zoom factor per tick (both projections, via zoomToPoint)
const ORTHO_SIZE_MIN = 5 * CITY_SCALE;
const ORTHO_SIZE_MAX = 2000 * CITY_SCALE;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (n: number) => Math.round(n * 10) / 10; // 1 decimal place

// Auto-revolution resume: after a control gesture, hold the sweep off briefly,
// then ramp (tween) back up to speed. Enabling via Space also ramps up; disabling
// stops instantly (handled by snapping the factor to 0 when paused).
const RESUME_DELAY = 0.4; // s after a gesture before the sweep restarts
const RESUME_RAMP_SEC = 1; // s to ramp the sweep factor 0 → 1 (linear, to full speed)
const DRAG_PX = 6; // press→drag threshold: a click/tap under this doesn't pause the sweep
const DBLCLICK_ZOOM = 0.6; // double-click moves ~40% closer to the clicked point
const TWIST_SIGN = 1; // two-finger twist → azimuth sign (so the scene follows the fingers)
const TILT_SPEED = 0.005; // two-finger parallel drag → polar (tilt), rad per pixel
const GESTURE_LOCK_PX = 12; // two-finger: travel before locking to one of pinch/twist/tilt
const GROUND_CLEARANCE = 20; // focus point (target) stays at least this far above y=0
const ROTATE_PIVOT_FROM_BOTTOM = 0.37; // RMB orbit pivots ~37% up from the bottom (Google-ish)
// Focal indicator: a ground radius ring around the base of the plumbline.
const RING_RADIUS = 50;
const RING_Y = 2; // just above the ground so it reads as "on the map"
const RING_POINTS: [number, number, number][] = Array.from({ length: 49 }, (_, i) => {
  const a = (i / 48) * Math.PI * 2;
  return [Math.cos(a) * RING_RADIUS, 0, Math.sin(a) * RING_RADIUS] as [number, number, number];
});

// Ground-anchored pan temps + helper. LMB locks the GROUND point (y=0) under the
// cursor where the drag began and translates the rig so it stays glued there
// (Google "grab the earth"). Caveat: at very shallow elevation the ground is
// near-edge-on, so grabs near the horizon move fast — pans best when tilted down.
const _UP = new THREE.Vector3(0, 1, 0);
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane();
const _anchor = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camWorld = new THREE.Vector3();

function groundHit(
  camera: THREE.Camera,
  dom: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  planeY: number,
  out: THREE.Vector3,
): boolean {
  const r = dom.getBoundingClientRect();
  const nx = ((clientX - r.left) / r.width) * 2 - 1;
  const ny = -((clientY - r.top) / r.height) * 2 + 1;
  if (useSceneStore.getState().projectionBlend >= 0.9999) {
    // Faked ortho (perspective camera + overridden matrix): setFromCamera would
    // take its perspective branch and build a DIVERGING ray, so the cursor maps
    // to the wrong ground point. Build the PARALLEL ortho ray ourselves, matching
    // ProjectionBlender's frustum (halfH = orthoSize, halfW = aspect·orthoSize).
    const aspect = r.width / Math.max(1, r.height);
    const halfH = useSceneStore.getState().orthoSize;
    camera.updateMatrixWorld();
    _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.getWorldDirection(_camFwd);
    camera.getWorldPosition(_camWorld);
    _ray.ray.origin
      .copy(_camWorld)
      .addScaledVector(_camRight, nx * halfH * aspect)
      .addScaledVector(_camUp, ny * halfH);
    _ray.ray.direction.copy(_camFwd).normalize();
  } else {
    _ndc.set(nx, ny);
    _ray.setFromCamera(_ndc, camera);
  }
  _plane.set(_UP, -planeY); // horizontal plane at y = planeY
  return _ray.ray.intersectPlane(_plane, out) !== null;
}

// Zoom about a screen point (cursor / pinch midpoint): scale the zoom, then pin
// the ground point that was under it so it stays put — Google's zoom-to-cursor,
// in BOTH projections (ortho scales orthoSize, perspective dollies). factor < 1
// zooms in. Reuses groundHit, so the pin is ortho-correct.
function zoomToPoint(
  c: CameraControlsImpl,
  camera: THREE.Camera,
  dom: HTMLCanvasElement,
  sx: number,
  sy: number,
  factor: number,
): void {
  const had = groundHit(camera, dom, sx, sy, 0, _anchor);
  const s = useSceneStore.getState();
  if (s.projection === "orthographic") {
    s.setOrthoSize(clamp(s.orthoSize * factor, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
  } else {
    void c.dollyTo(c.distance * factor, false);
  }
  if (had && groundHit(camera, dom, sx, sy, 0, _hit)) {
    _delta.subVectors(_anchor, _hit);
    c.getTarget(_tgt);
    c.getPosition(_camPos);
    void c.setLookAt(
      _camPos.x + _delta.x,
      _camPos.y + _delta.y,
      _camPos.z + _delta.z,
      _tgt.x + _delta.x,
      _tgt.y + _delta.y,
      _tgt.z + _delta.z,
      false,
    );
  }
}

// orbit config → drei setLookAt. azimuthDeg and camera-controls azimuthAngle are
// both atan2(x,z); elevation above horizon → polar from +Y is (90 − elevation).
function applyOrbit(c: CameraControlsImpl, o: OrbitConfig, transition: boolean): Promise<void> {
  const polar = (90 - o.elevationDeg) * DEG;
  const az = o.azimuthDeg * DEG;
  const sp = Math.sin(polar);
  const cp = Math.cos(polar);
  const px = o.centerX + o.radius * sp * Math.sin(az);
  const py = o.lookAtY + o.radius * cp;
  const pz = o.centerZ + o.radius * sp * Math.cos(az);
  return c.setLookAt(px, py, pz, o.centerX, o.lookAtY, o.centerZ, transition);
}

// camera spherical → orbit-config patch (the inverse of applyOrbit). Used to
// write the live pose back so the panel sliders track + Save sees the real pose.
function readOrbit(c: CameraControlsImpl): Partial<OrbitConfig> {
  c.getTarget(_tgt);
  // Round the live readback so the panel steppers / readout aren't full-precision
  // float noise (e.g. 2437.8294…). camera-controls still owns the real sub-unit
  // pose; this is just the display / persistence copy.
  return {
    azimuthDeg: round1((((c.azimuthAngle / DEG) % 360) + 360) % 360),
    elevationDeg: round1(90 - c.polarAngle / DEG),
    radius: Math.round(c.distance),
    centerX: Math.round(_tgt.x),
    lookAtY: Math.round(_tgt.y),
    centerZ: Math.round(_tgt.z),
  };
}

export function DreiSceneControls() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const mode = useSceneStore((s) => s.cameraMode);
  const projection = useSceneStore((s) => s.projection);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const dragging = useRef(false);
  const panning = useRef(false); // mouse LMB ground-anchored pan
  const seeded = useRef(false);
  const lastWrite = useRef(0);
  const wheelFrames = useRef(0); // brief "controlling" window after a wheel tick
  const speedFactor = useRef(1); // 0..1 sweep ramp; tweens up on resume / enable
  const resumeAt = useRef(0); // clock time the sweep may resume after a gesture
  const wasControlling = useRef(false);
  const showFocal = useSceneStore((s) => s.showFocalIndicator);
  const pinRef = useRef<THREE.Group>(null); // map-pin marker at the focal point
  const ringRef = useRef<THREE.Group>(null); // ground radius ring at the plumbline base
  const plumbRef = useRef<ComponentRef<typeof Line>>(null); // plumbline: focal point → ground

  // On entry to the new controls: start in PERSPECTIVE with a fixed ~25° lens
  // (Google-like; zoom is dolly, not FOV). Pinned so a stale persisted projection
  // / fov can't override it. `p` still toggles to ortho within the session.
  useEffect(() => {
    const s = useSceneStore.getState();
    if (s.cameraIntent.fov !== 25) s.setCameraIntent({ fov: 25 });
    if (s.projection !== "perspective") {
      s.setProjection("perspective");
      s.setProjectionBlend(0);
    }
  }, []);

  // Button map: LMB = pan (custom anchored pan below), RMB = rotate/tilt. Touch
  // keeps the Google model (1-finger pan / 2-finger pinch+twist).
  useEffect(() => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const A = CameraControlsImpl.ACTION;
    c.mouseButtons.left = A.NONE; // pan handled by the custom anchored-pan effect (LMB)
    c.mouseButtons.right = A.ROTATE; // rotate (horizontal) + tilt (vertical)
    c.mouseButtons.wheel = projection === "orthographic" ? A.NONE : A.DOLLY;
    c.dollyToCursor = projection !== "orthographic"; // perspective: zoom toward the mouse
    c.touches.one = A.NONE; // all touch gestures handled custom below (ortho-correct)
    c.touches.two = A.NONE;
    c.minPolarAngle = 0.01; // overhead-ish at most
    c.maxPolarAngle = Math.PI / 2 - 0.01; // never tilt below the ground plane
    // Distance band (matches the old controller). Keeps the camera→centre distance
    // sane so the city-anchored fog (FogTicker, distance-driven) doesn't collapse
    // to a white-out when dollied in or vanish when dollied way out.
    c.minDistance = 50 * CITY_SCALE;
    c.maxDistance = 5000 * CITY_SCALE;
  }, [projection, mode]);

  useEffect(() => {
    const dom = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      const s = useSceneStore.getState();
      if (s.cameraMode !== "orbit") return;
      wheelFrames.current = 10; // mark a wheel as "controlling" so readback tracks
      if (s.projection !== "orthographic") return; // perspective: camera-controls DOLLY + dollyToCursor
      e.preventDefault();
      const c = controls.current;
      if (!c) return;
      const factor = e.deltaY < 0 ? 1 / WHEEL_STEP : WHEEL_STEP;
      zoomToPoint(c, camera, dom, e.clientX, e.clientY, factor); // ortho zoom-to-cursor (orthoSize)
    };
    dom.addEventListener("wheel", onWheel, { passive: false });
    return () => dom.removeEventListener("wheel", onWheel);
  }, [gl, camera]);

  // Custom LMB ground-anchored pan (mouse). Touch one-finger pan is handled by
  // camera-controls TOUCH_SCREEN_PAN (set above).
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const c = controls.current;
      if (!c) return;
      if (!groundHit(camera, dom, e.clientX, e.clientY, 0, _anchor)) return;
      panning.current = true; // the drag-threshold tracker handles pause + readback
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!panning.current) return;
      const c = controls.current;
      if (!c) return;
      if (!groundHit(camera, dom, e.clientX, e.clientY, 0, _hit)) return;
      _delta.subVectors(_anchor, _hit); // world shift to bring the anchor back under cursor
      c.getTarget(_tgt);
      c.getPosition(_camPos);
      void c.setLookAt(
        _camPos.x + _delta.x,
        _camPos.y + _delta.y,
        _camPos.z + _delta.z,
        _tgt.x + _delta.x,
        _tgt.y + _delta.y,
        _tgt.z + _delta.z,
        false,
      );
    };
    const onUp = (e: PointerEvent) => {
      if (!panning.current) return;
      panning.current = false;
      dom.releasePointerCapture?.(e.pointerId);
      const c = controls.current;
      if (c) useSceneStore.getState().setOrbit(readOrbit(c));
    };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      panning.current = false;
    };
  }, [mode, gl, camera]);

  // Custom touch gestures (camera-controls touch is off — touches = NONE — so it
  // stays ortho-correct and we own the twist direction):
  //   1-finger → ground-anchored pan (reuses the ortho-correct groundHit)
  //   2-finger → pinch-zoom (orthoSize/dolly) + twist-rotate + parallel-drag tilt (Google)
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const pts = new Map<number, { x: number; y: number }>();
    // two-finger gesture state: lock to ONE of pinch/twist/tilt once it leads,
    // so the others' minor cross-talk is ignored for the rest of the gesture.
    let g2: "pinch" | "twist" | "tilt" | null = null;
    let startDist = 0;
    let startAngle = 0;
    let startMidX = 0;
    let startMidY = 0;
    let lastDist = 0;
    let lastAngle = 0;
    let lastMidY = 0;
    const reanchor = (x: number, y: number) => {
      if (controls.current && groundHit(camera, dom, x, y, 0, _anchor)) panning.current = true;
    };
    const twoFingerStart = () => {
      const a = [...pts.values()];
      startDist = lastDist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      startAngle = lastAngle = Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x);
      startMidX = (a[0].x + a[1].x) / 2;
      startMidY = lastMidY = (a[0].y + a[1].y) / 2;
      g2 = null; // undetermined until one gesture leads past GESTURE_LOCK_PX
      panning.current = false;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dom.setPointerCapture?.(e.pointerId);
      if (pts.size === 1) reanchor(e.clientX, e.clientY);
      else if (pts.size === 2) twoFingerStart();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = controls.current;
      if (!c) return;
      if (pts.size === 1 && panning.current) {
        if (!groundHit(camera, dom, e.clientX, e.clientY, 0, _hit)) return;
        _delta.subVectors(_anchor, _hit);
        c.getTarget(_tgt);
        c.getPosition(_camPos);
        void c.setLookAt(
          _camPos.x + _delta.x,
          _camPos.y + _delta.y,
          _camPos.z + _delta.z,
          _tgt.x + _delta.x,
          _tgt.y + _delta.y,
          _tgt.z + _delta.z,
          false,
        );
      } else if (pts.size >= 2) {
        const a = [...pts.values()];
        const dist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        const angle = Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x);
        const midY = (a[0].y + a[1].y) / 2;

        // Lock to the dominant gesture once one leads (all three measured in px:
        // pinch = spread change, twist = arc length, tilt = midpoint travel).
        if (g2 === null) {
          let fromStart = angle - startAngle;
          if (fromStart > Math.PI) fromStart -= Math.PI * 2;
          if (fromStart < -Math.PI) fromStart += Math.PI * 2;
          const accPinch = Math.abs(dist - startDist);
          const accTwist = Math.abs(fromStart) * (startDist / 2);
          const accTilt = Math.abs(midY - startMidY);
          const m = Math.max(accPinch, accTwist, accTilt);
          if (m > GESTURE_LOCK_PX) {
            g2 = m === accTilt ? "tilt" : m === accPinch ? "pinch" : "twist";
            // perspective: anchor the gesture on the spot the fingers first pressed —
            // pinch zooms + trucks around it, tilt pivots on it. (Ortho: solved later.)
            if (useSceneStore.getState().projection !== "orthographic") {
              if (g2 === "pinch") {
                groundHit(camera, dom, startMidX, startMidY, 0, _anchor);
              } else if (g2 === "tilt" && groundHit(camera, dom, startMidX, startMidY, 0, _hit)) {
                c.setOrbitPoint(_hit.x, Math.max(GROUND_CLEARANCE, _hit.y), _hit.z);
              }
            }
          }
        }

        if (g2 === "pinch" && lastDist > 0 && dist > 0) {
          const ratio = lastDist / dist; // <1 spread (zoom in), >1 pinch (zoom out)
          const midX = (a[0].x + a[1].x) / 2;
          if (useSceneStore.getState().projection === "orthographic") {
            zoomToPoint(c, camera, dom, midX, midY, ratio); // ortho: solved later
          } else {
            // perspective: zoom (dolly), then truck so the pressed point stays under
            // the moving midpoint — keeps the pinch centred + lets you truck around.
            void c.dollyTo(c.distance * ratio, false);
            if (groundHit(camera, dom, midX, midY, 0, _hit)) {
              _delta.subVectors(_anchor, _hit);
              c.getTarget(_tgt);
              c.getPosition(_camPos);
              void c.setLookAt(
                _camPos.x + _delta.x,
                _camPos.y + _delta.y,
                _camPos.z + _delta.z,
                _tgt.x + _delta.x,
                _tgt.y + _delta.y,
                _tgt.z + _delta.z,
                false,
              );
            }
          }
        } else if (g2 === "twist") {
          let dAng = angle - lastAngle;
          if (dAng > Math.PI) dAng -= Math.PI * 2;
          if (dAng < -Math.PI) dAng += Math.PI * 2;
          void c.rotate(TWIST_SIGN * dAng, 0, false);
        } else if (g2 === "tilt") {
          void c.rotate(0, -(midY - lastMidY) * TILT_SPEED, false); // up = more oblique
        }
        lastDist = dist;
        lastAngle = angle;
        lastMidY = midY;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.delete(e.pointerId);
      dom.releasePointerCapture?.(e.pointerId);
      if (pts.size === 1) {
        const r = [...pts.values()][0];
        reanchor(r.x, r.y); // dropped to one finger → resume pan from it
      } else if (pts.size === 0) {
        panning.current = false;
        const c = controls.current;
        if (c) useSceneStore.getState().setOrbit(readOrbit(c));
      }
    };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      pts.clear();
      panning.current = false;
    };
  }, [mode, gl, camera]);

  // Double-click → zoom in toward the clicked ground point (Google-style): recentre
  // the target on the hit and move DBLCLICK_ZOOM closer; hold the sweep during the tween.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const onDbl = (e: MouseEvent) => {
      const c = controls.current;
      if (!c) return;
      if (!groundHit(camera, dom, e.clientX, e.clientY, 0, _hit)) return;
      const s = useSceneStore.getState();
      c.getPosition(_camPos);
      _delta.subVectors(_camPos, _hit).multiplyScalar(DBLCLICK_ZOOM).add(_hit); // new position
      dragging.current = true; // hold the sweep through the transition
      const ty = Math.max(GROUND_CLEARANCE, _hit.y); // keep the focus above ground
      void c.setLookAt(_delta.x, _delta.y, _delta.z, _hit.x, ty, _hit.z, true).then(() => {
        dragging.current = false;
        useSceneStore.getState().setOrbit(readOrbit(c));
      });
      if (s.projection === "orthographic") {
        s.setOrthoSize(clamp(s.orthoSize * DBLCLICK_ZOOM, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
      }
    };
    dom.addEventListener("dblclick", onDbl);
    return () => dom.removeEventListener("dblclick", onDbl);
  }, [mode, gl, camera]);

  // Perspective RMB orbit pivots on the GROUND point at the centre of the view
  // (Google-style) so the rotation feels anchored to what you're looking at, not
  // an abstract far-off target. Set in capture phase, before camera-controls
  // starts its rotate. (Ortho: solved later.)
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 2) return;
      if (useSceneStore.getState().projection === "orthographic") return;
      const c = controls.current;
      if (!c) return;
      const r = dom.getBoundingClientRect();
      const px = r.left + r.width / 2;
      const py = r.top + r.height * (1 - ROTATE_PIVOT_FROM_BOTTOM); // ~37% up from the bottom
      // pivot = the focal point (same screen point + focal plane the pin uses)
      if (groundHit(camera, dom, px, py, GROUND_CLEARANCE, _hit)) {
        c.setOrbitPoint(_hit.x, _hit.y, _hit.z);
      }
    };
    dom.addEventListener("pointerdown", onDown, true); // capture: pre-empt the rotate
    return () => dom.removeEventListener("pointerdown", onDown, true);
  }, [mode, gl, camera]);

  // Press BOTH mouse buttons together → tween back to the default orbit orientation.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || (e.buttons & 3) !== 3) return; // need L + R held
      const c = controls.current;
      if (!c) return;
      e.preventDefault();
      panning.current = false; // cancel any in-progress pan
      dragging.current = true; // hold the sweep through the tween
      void applyOrbit(c, DEFAULT_ORBIT, true).then(() => {
        dragging.current = false;
        useSceneStore.getState().setOrbit(readOrbit(c));
      });
    };
    dom.addEventListener("pointerdown", onDown);
    return () => dom.removeEventListener("pointerdown", onDown);
  }, [mode, gl]);

  // Pause the sweep only once a press becomes a real DRAG (moves > DRAG_PX) — a
  // click / tap leaves the orbit running. camera-controls fires controlstart on
  // press (too eager), so track the threshold ourselves. On the drag's release,
  // write the pose back to the store (pose persists + Save sees it).
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    let downX = 0;
    let downY = 0;
    let pressed = false;
    const onDown = (e: PointerEvent) => {
      pressed = true;
      downX = e.clientX;
      downY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!pressed || dragging.current) return;
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (dx * dx + dy * dy >= DRAG_PX * DRAG_PX) dragging.current = true; // press → drag
    };
    const onUp = () => {
      pressed = false;
      if (!dragging.current) return;
      dragging.current = false;
      const c = controls.current;
      if (c) useSceneStore.getState().setOrbit(readOrbit(c));
    };
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragging.current = false;
    };
  }, [mode, gl]);

  // Space toggles the auto-revolution sweep (orbit only — matches the old path).
  useEffect(() => {
    if (mode !== "orbit") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      const s = useSceneStore.getState();
      s.setOrbitPaused(!s.orbitPaused);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const s = useSceneStore.getState();

    // seed the camera from the stored orbit pose on the first orbit frame
    if (!seeded.current) {
      void applyOrbit(c, s.orbit, false);
      seeded.current = true;
    }

    // Focal markers show WHERE THE SCREEN WILL ORBIT FROM — derived from the camera
    // each frame (not the drifting target): raycast the rotate-pivot screen point
    // onto the focal plane (a fixed height above ground). So it updates with the
    // camera and holds its height through zoom-to-cursor.
    if (pinRef.current || ringRef.current || plumbRef.current) {
      const r = gl.domElement.getBoundingClientRect();
      const px = r.left + r.width / 2;
      const py = r.top + r.height * (1 - ROTATE_PIVOT_FROM_BOTTOM);
      if (groundHit(camera, gl.domElement, px, py, GROUND_CLEARANCE, _focal)) {
        if (pinRef.current) {
          pinRef.current.position.copy(_focal);
          pinRef.current.updateMatrixWorld(); // sync now so the Html pin doesn't lag a frame
        }
        if (ringRef.current) ringRef.current.position.set(_focal.x, RING_Y, _focal.z);
        // plumbline straight down from the focal point to the ground (y = 0)
        if (plumbRef.current) {
          plumbRef.current.geometry.setPositions([_focal.x, _focal.y, _focal.z, _focal.x, 0, _focal.z]);
          plumbRef.current.computeLineDistances(); // keep the dashes correct after the update
        }
      }
    }

    if (wheelFrames.current > 0) wheelFrames.current--;
    const controlling = dragging.current || wheelFrames.current > 0;
    const now = state.clock.elapsedTime;

    // a gesture just ended → hold the sweep off for RESUME_DELAY, then ramp back
    if (wasControlling.current && !controlling) resumeAt.current = now + RESUME_DELAY;
    wasControlling.current = controlling;

    // signed angular velocity; periodSec 0 = stopped, negative = reverse
    const omega = s.orbit.periodSec !== 0 ? (Math.PI * 2) / s.orbit.periodSec : 0;
    const active = !s.orbitPaused && !controlling && now >= resumeAt.current && omega !== 0;
    if (s.orbitPaused) {
      speedFactor.current = 0; // disabling stops the sweep immediately
    } else if (active) {
      speedFactor.current = Math.min(1, speedFactor.current + dt / RESUME_RAMP_SEC); // 0→full over 1s
    } else {
      speedFactor.current = 0; // during a gesture or the post-gesture delay
    }
    if (active) void c.rotate(omega * speedFactor.current * dt, 0, false);

    // throttled (~10/s): feed cameraLive (fog / moon-follow), and while the user
    // is controlling, write the pose back so the panel sliders track live.
    if (state.clock.elapsedTime - lastWrite.current >= 0.1) {
      lastWrite.current = state.clock.elapsedTime;
      const cam = state.camera as THREE.PerspectiveCamera;
      s.setCameraLive({
        position: [cam.position.x, cam.position.y, cam.position.z],
        rotation: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
        fov: cam.fov,
      });
      if (controlling) s.setOrbit(readOrbit(c));
    }
  });

  // sub-step A: orbit only. Fly / still stay on the old controller (flag off).
  if (mode !== "orbit") return null;
  return (
    <>
      <CameraControls ref={controls} />
      {showFocal && (
        <>
          {/* plumbline focal → ground + ground radius ring, drawn on top of terrain */}
          <Line
            ref={plumbRef}
            points={[
              [0, 0, 0],
              [0, 1, 0],
            ]}
            color="#7dd3fc"
            lineWidth={1.5}
            dashed
            dashSize={6}
            gapSize={4}
            transparent
            opacity={0.7}
            depthTest={false}
          />
          <group ref={ringRef}>
            <Line
              points={RING_POINTS}
              color="#7dd3fc"
              lineWidth={1.5}
              transparent
              opacity={0.7}
              depthTest={false}
            />
          </group>
          {/* map pin (DOM → always on top); tip anchored on the focal point */}
          <group ref={pinRef}>
            <Html center={false} pointerEvents="none" zIndexRange={[100, 0]}>
              <div
                style={{
                  transform: "translate(-50%, -100%)",
                  color: "#7dd3fc",
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
                }}
              >
                <MapPin size={28} strokeWidth={2.5} />
              </div>
            </Html>
          </group>
        </>
      )}
    </>
  );
}
