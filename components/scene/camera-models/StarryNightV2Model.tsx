"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Html } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { MapPin } from "lucide-react";
import * as THREE from "three";
import { useSceneStore, DEFAULT_INTENT } from "@/lib/state/sceneStore";
import { orbitFramingFactor } from "@/lib/scene/aspectFraming";
import { CITY_SCALE, CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { GROUND_APRON_M } from "../Ground";
import { writeOrbitPose } from "./orbitWriteback";

// "Starry Night Cam v2" — the current Starry Night interactive camera (the app default). A
// drone-style rig built on camera-controls (the library the app's orbit is built on) and DRIVEN
// through its methods (setLookAt / setTarget), so nothing gets clobbered by the library's per-frame
// update — the failure mode of an earlier MapControls attempt, where OrbitControls.update() overwrote
// every manual re-aim.
//
//   Desktop   LMB drag         Orbit + Tilt around the CLICKED point (a pin marks it; cleared on release)
//             RMB / Shift+LMB  Move — grab the ground (grabbing cursor); it stays under the cursor
//             Ctrl/⌘ + LMB     Aim — grab a map point (grab / grabbing cursor) and swing the view in
//                              place so it stays under the cursor (free-look)
//             wheel            Zoom toward the cursor (Google-Earth curve; position only, no re-aim)
//             double-click     Zoom in toward the clicked point (position only, keeps orientation)
//   Touch     1-finger         Move (native truck)  ·  2-finger  pinch-zoom + twist-rotate
//
// Perspective + faked-ortho (via ProjectionBlender): honors the current projection instead of
// forcing perspective. In ortho, raycasts through a hand-built PARALLEL ray and zoom scales
// orthoSize (not distance). frame-on-mount + ~10/s pose write-back, like the sibling models.
// Self-gates to orbit. Mouse gestures are custom (guarded to pointerType "mouse"); touch falls
// through to camera-controls' native touch actions.

const DEG = Math.PI / 180;
const ORBIT_RATE = 0.006; // rad per pixel of Shift orbit (~0.34°/px; a ~500px drag ≈ 170°)
const MIN_EYE_Y = 5; // keep the camera above the ground while orbiting/tilting
const MAX_VERT = 0.98; // clamp free-look short of straight up/down (no flip)
const MAX_ORBIT_EL = 89.9 * DEG; // orbit look-down cap: 0.1° short of straight-down; never crosses (no flip)
const MAX_STEP = 0.15; // per-move cap on the free-look servo (rad), guards against big jumps
const WHEEL_ZOOM_SPEED = 1.0; // GE/OrbitControls wheel curve: ~5% dolly per notch at speed 1
const ORTHO_SIZE_MIN = 5 * CITY_SCALE; // faked-ortho zoom band (frustum half-height); matches Map
const ORTHO_SIZE_MAX = 2000 * CITY_SCALE;

const _eye = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _look = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e2 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _grab = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _UP = new THREE.Vector3(0, 1, 0);
const _camUp = new THREE.Vector3(); // ortho raycast: camera basis + world pose
const _fwd = new THREE.Vector3();
const _camWorld = new THREE.Vector3();
const _anchor = new THREE.Vector3(); // ortho zoom: pre-zoom ground point under the cursor
const A = CameraControlsImpl.ACTION;

// Ground point (y = 0) under a client-space pointer. Leaves _ray set from the cursor, so callers
// can reuse _ray.ray.direction when there's no ground hit. Ortho-correct: under the faked-ortho
// camera (a PerspectiveCamera with an overridden matrix) setFromCamera would build a diverging
// perspective ray, so at full ortho we build the PARALLEL ray ourselves from the camera basis +
// orthoSize, matching ProjectionBlender's frustum (halfH = orthoSize·f, halfW = aspect·halfH).
function groundHit(
  cam: THREE.Camera,
  dom: HTMLElement,
  clientX: number,
  clientY: number,
  out: THREE.Vector3,
): boolean {
  const r = dom.getBoundingClientRect();
  const nx = ((clientX - r.left) / r.width) * 2 - 1;
  const ny = -(((clientY - r.top) / r.height) * 2 - 1);
  if (useSceneStore.getState().projectionBlend >= 0.9999) {
    const aspect = r.width / Math.max(1, r.height);
    const halfH = useSceneStore.getState().orthoSize * orbitFramingFactor(aspect);
    cam.updateMatrixWorld();
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _camUp.setFromMatrixColumn(cam.matrixWorld, 1);
    cam.getWorldDirection(_fwd);
    cam.getWorldPosition(_camWorld);
    _ray.ray.origin
      .copy(_camWorld)
      .addScaledVector(_right, nx * halfH * aspect)
      .addScaledVector(_camUp, ny * halfH);
    _ray.ray.direction.copy(_fwd).normalize();
  } else {
    _ndc.set(nx, ny);
    _ray.setFromCamera(_ndc, cam);
  }
  return _ray.ray.intersectPlane(_plane, out) !== null;
}

// Zoom by uniformly scaling eye + target about a world pivot by `k` (k < 1 = closer, > 1 = farther).
// Uniform scale keeps the look vector's DIRECTION (only its length changes), so the camera's
// orientation is untouched — position moves, rotation does not — and the pivot stays put on screen.
// The resulting eye→target distance is clamped to the control's distance bounds. This is Google
// Earth's zoom-toward-cursor (no re-aim), shared by the wheel and the double-click zoom-in.
function zoomAboutPoint(c: CameraControlsImpl, pivot: THREE.Vector3, k: number, smooth: boolean) {
  c.getPosition(_eye);
  c.getTarget(_tgt);
  const oldR = _eye.distanceTo(_tgt) || 1e-3;
  const s = THREE.MathUtils.clamp(oldR * k, c.minDistance, c.maxDistance) / oldR;
  void c.setLookAt(
    pivot.x + (_eye.x - pivot.x) * s,
    pivot.y + (_eye.y - pivot.y) * s,
    pivot.z + (_eye.z - pivot.z) * s,
    pivot.x + (_tgt.x - pivot.x) * s,
    pivot.y + (_tgt.y - pivot.y) * s,
    pivot.z + (_tgt.z - pivot.z) * s,
    smooth,
  );
}

// Zoom at a screen point in EITHER projection. Perspective: scale eye + target about the cursor's
// ground point (the GE zoom-toward-cursor above). Ortho: the camera distance is decoupled from
// apparent size, so scale orthoSize instead, then truck the rig so the cursor's ground point stays
// put (re-pin). k < 1 = zoom in.
function zoomAtCursor(
  c: CameraControlsImpl,
  cam: THREE.Camera,
  dom: HTMLElement,
  sx: number,
  sy: number,
  k: number,
  smooth: boolean,
) {
  const s = useSceneStore.getState();
  if (s.projection === "orthographic") {
    const had = groundHit(cam, dom, sx, sy, _anchor); // pre-zoom ground point under the cursor
    s.setOrthoSize(THREE.MathUtils.clamp(s.orthoSize * k, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
    if (had && groundHit(cam, dom, sx, sy, _cur)) {
      _delta.subVectors(_anchor, _cur); // how far that point slid under the new orthoSize
      c.getPosition(_eye);
      c.getTarget(_tgt);
      void c.setLookAt(
        _eye.x + _delta.x,
        _eye.y,
        _eye.z + _delta.z,
        _tgt.x + _delta.x,
        _tgt.y,
        _tgt.z + _delta.z,
        false,
      );
    }
    return;
  }
  // Perspective: pivot about the cursor's ground point (fall back to a point along the ray on sky).
  if (!groundHit(cam, dom, sx, sy, _cur)) {
    c.getPosition(_eye);
    c.getTarget(_tgt);
    _cur.copy(_eye).addScaledVector(_ray.ray.direction, _eye.distanceTo(_tgt));
  }
  zoomAboutPoint(c, _cur, k, smooth);
}

// Keep the focal point within the city's ground disc (centre CITY_CENTER, radius = the current tier
// half-extent + apron) so a pan can't wander the view off the map into the void. Returns the clamped
// [x, z]; the pan shifts the eye by the same clamped amount, preserving the pose.
const _cc = { x: 0, z: 0 };
function clampToCity(x: number, z: number): { x: number; z: number } {
  const R = CITY_TIERS[useSceneStore.getState().citySize] + GROUND_APRON_M;
  const dx = x - CITY_CENTER.x;
  const dz = z - CITY_CENTER.z;
  const d2 = dx * dx + dz * dz;
  if (d2 <= R * R) {
    _cc.x = x;
    _cc.z = z;
  } else {
    const k = R / Math.sqrt(d2);
    _cc.x = CITY_CENTER.x + dx * k;
    _cc.z = CITY_CENTER.z + dz * k;
  }
  return _cc;
}

export function StarryNightV2Model() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const cam = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const mode = useSceneStore((s) => s.cameraMode);
  const bounds = useSceneStore((s) => s.snv2); // user-set min/max distance
  const lastWrite = useRef(0);
  const grabP = useRef(new THREE.Vector3()); // free-look grab handle (a fixed world point)
  const orbitAxis = useRef(new THREE.Vector3(1, 0, 0)); // carried tilt axis (stable through straight-down)
  const [pin, setPin] = useState<[number, number, number] | null>(null); // shift-orbit pivot marker

  // v2 supports BOTH projections (perspective + faked-ortho via ProjectionBlender). Honor the current
  // projection instead of forcing perspective: snap the blend to match on mount. Runtime toggles
  // (p hotkey / panel) morph the blend through tweenProjectionTo; writeOrbitPose keeps the live
  // orbit.radius current so the morph's virtual-eye distance stays right. On a switch INTO ortho we
  // match orthoSize to the live perspective framing so the flip doesn't jump the zoom.
  const projection = useSceneStore((s) => s.projection);
  const projSynced = useRef(false);
  useEffect(() => {
    const s = useSceneStore.getState();
    if (!projSynced.current) {
      projSynced.current = true; // mount: snap the blend; the framing effect sets ortho continuity
      s.setProjectionBlend(s.projection === "orthographic" ? 1 : 0);
      return;
    }
    if (s.projection === "orthographic") {
      const c = controls.current;
      if (c) {
        const half = c.distance * Math.tan((s.cameraIntent.fov * DEG) / 2);
        s.setOrthoSize(THREE.MathUtils.clamp(half, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
      }
    }
  }, [projection]);

  // Frame the city + control config. ALL mouse input is custom (below) — including the wheel, so
  // its zoom curve matches Google Earth; native touch is left on for the mobile gestures.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    // Open to the curated default pose (DEFAULT_INTENT) — the hero establishing shot. v2 always
    // opens here on mount; it doesn't restore a saved pose (the old computed framing didn't either).
    const [px, py, pz] = DEFAULT_INTENT.position;
    const [tx, ty, tz] = DEFAULT_INTENT.lookAt;
    void c.setLookAt(px, py, pz, tx, ty, tz, false);
    // Ortho continuity: if we boot in ortho, match orthoSize to this pose's framing so the faked-
    // ortho render shows the same content the perspective pose would (no zoom mismatch on entry).
    const st = useSceneStore.getState();
    if (st.projection === "orthographic") {
      const dist = Math.hypot(px - tx, py - ty, pz - tz);
      const half = dist * Math.tan((st.cameraIntent.fov * DEG) / 2);
      st.setOrthoSize(THREE.MathUtils.clamp(half, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
    }
    // No tight polar clamp: free-look re-aims via setTarget (moving the target around a fixed eye),
    // which legitimately drives the eye→target polar past 90°. A tight clamp would "correct" that by
    // shoving the eye's POSITION — the bug where Ctrl-drag translated the camera. The under-ground
    // guard for orbit is enforced directly (MIN_EYE_Y) in the orbit handler instead.
    c.minPolarAngle = 0.001;
    c.maxPolarAngle = Math.PI - 0.001;
    c.dollyToCursor = true; // touch pinch-zoom toward the pinch centre (mouse wheel is custom)
    c.mouseButtons.left = A.NONE; // move / orbit / free-look are custom (below)
    c.mouseButtons.right = A.NONE;
    c.mouseButtons.middle = A.NONE;
    c.mouseButtons.wheel = A.NONE; // wheel zoom is custom (GE curve, below) — not native DOLLY
    c.touches.one = A.TOUCH_TRUCK; // mobile: 1-finger pan
    c.touches.two = A.TOUCH_ZOOM_ROTATE; // mobile: 2-finger pinch-zoom + twist-rotate
    c.touches.three = A.NONE;
  }, []);

  // Distance bounds (the user range slider) — applied live; clamp the current distance in on change.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const lo = Math.max(1, bounds.minDist);
    const hi = Math.max(lo + 1, bounds.maxDist);
    c.minDistance = lo;
    c.maxDistance = hi;
    void c.dollyTo(THREE.MathUtils.clamp(c.distance, lo, hi), false);
  }, [bounds]);

  // Custom mouse gestures (guarded to pointerType "mouse"; touch uses the native actions above).
  useEffect(() => {
    const dom = gl.domElement;
    let drag: "pan" | "orbit" | "look" | null = null;
    let lastX = 0;
    let lastY = 0;
    let ctrlHeld = false;

    // Drag affordance glyph shown ALONGSIDE the hand cursor: a lucide eye (free-look) / move (move),
    // as a fixed DOM overlay offset down-right of the pointer, updated in the pointer handlers. It
    // rides next to the OS cursor rather than replacing it — the cursor stays browser-standard.
    const EYE_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
    const MOVE_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/></svg>';
    const glyph = document.createElement("div");
    glyph.setAttribute("aria-hidden", "true");
    glyph.style.cssText =
      "position:fixed;left:0;top:0;z-index:9999;pointer-events:none;display:none;color:#7dd3fc;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.85))";
    document.body.appendChild(glyph);
    const moveGlyph = (x: number, y: number) => {
      glyph.style.transform = `translate3d(${x + 26}px, ${y + 24}px, 0)`; // down-right of the cursor
    };
    const showGlyph = (kind: "look" | "pan", x: number, y: number) => {
      glyph.innerHTML = kind === "look" ? EYE_SVG : MOVE_SVG;
      glyph.style.display = "block";
      moveGlyph(x, y);
    };
    const hideGlyph = () => {
      glyph.style.display = "none";
    };

    // Cursor: browser-standard hand — grabbing (closed) while moving / free-looking, grab (open) while
    // Ctrl/⌘ is armed pre-drag; default otherwise. The eye / move glyph rides alongside (above).
    const applyCursor = () => {
      dom.style.cursor = drag === "look" || drag === "pan" ? "grabbing" : ctrlHeld ? "grab" : "";
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        ctrlHeld = true;
        applyCursor();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        ctrlHeld = false;
        applyCursor();
      }
    };

    const onDown = (e: PointerEvent) => {
      const c = controls.current;
      if (!c || e.pointerType !== "mouse") return;
      if (e.button !== 0 && e.button !== 2) return; // LMB or RMB only
      lastX = e.clientX;
      lastY = e.clientY;
      if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        // Aim / free-look (Ctrl+LMB): grab the map point under the cursor, then swing the view
        // (below) so that point stays under the cursor as you drag. Grab the ground; if the cursor
        // is on the sky, grab a point along the ray at the current focal distance.
        drag = "look";
        setPin(null);
        const hit = groundHit(cam, dom, e.clientX, e.clientY, _cur);
        c.getPosition(_eye);
        c.getTarget(_tgt);
        const d = _eye.distanceTo(_tgt);
        if (hit) grabP.current.copy(_cur);
        else grabP.current.copy(_eye).addScaledVector(_ray.ray.direction, d);
        showGlyph("look", e.clientX, e.clientY);
      } else if (e.button === 2 || e.shiftKey) {
        // Move (RMB or Shift+LMB): grab the ground point under the cursor; keep it under the cursor.
        drag = "pan";
        setPin(null);
        if (!groundHit(cam, dom, e.clientX, e.clientY, _grab)) drag = null;
        else showGlyph("pan", e.clientX, e.clientY);
      } else {
        // Orbit + tilt (bare LMB) around the clicked ground point; drop a pin there (the view
        // rotates around it, no re-centre).
        drag = "orbit";
        hideGlyph(); // orbit uses the pin marker, not a cursor glyph
        if (groundHit(cam, dom, e.clientX, e.clientY, _cur)) {
          _grab.copy(_cur); // reuse _grab as the orbit pivot for the gesture
          setPin([_cur.x, _cur.y, _cur.z]);
        } else {
          c.getTarget(_grab);
          setPin(null);
        }
        // Seed the carried tilt axis from the current view heading (kept valid through the pole).
        c.getPosition(_eye);
        c.getTarget(_tgt);
        _dir.subVectors(_tgt, _eye);
        const h = Math.hypot(_dir.x, _dir.z);
        if (h > 1e-3) orbitAxis.current.set(-_dir.z, 0, _dir.x).multiplyScalar(1 / h);
      }
      if (drag) dom.setPointerCapture?.(e.pointerId);
      applyCursor();
    };

    const onMove = (e: PointerEvent) => {
      const c = controls.current;
      if (!c || !drag) return;
      if (drag === "look" || drag === "pan") moveGlyph(e.clientX, e.clientY);
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (drag === "pan") {
        // Ground-anchored: shift the whole rig so the grabbed world point returns under the cursor —
        // but clamp the focal point to the city disc (shift the eye by the SAME clamped amount so the
        // pose is preserved), so a pan stops at the boundary instead of wandering off-map into the void.
        if (!groundHit(cam, dom, e.clientX, e.clientY, _cur)) return;
        _delta.subVectors(_grab, _cur); // _grab.y === _cur.y === 0 → horizontal only
        c.getPosition(_eye);
        c.getTarget(_tgt);
        const cl = clampToCity(_tgt.x + _delta.x, _tgt.z + _delta.z);
        const adx = cl.x - _tgt.x; // actual (clamped) horizontal shift
        const adz = cl.z - _tgt.z;
        void c.setLookAt(_eye.x + adx, _eye.y, _eye.z + adz, cl.x, _tgt.y, cl.z, false);
      } else if (drag === "orbit") {
        // Rotate BOTH eye and target around the pivot _grab, so the pivot's screen position holds
        // (no re-centre). Yaw around world-up (stable at any tilt). Tilt around a CARRIED horizontal
        // axis (kept valid through the pole).
        c.getPosition(_eye);
        c.getTarget(_tgt);
        _q.setFromAxisAngle(_UP, -dx * ORBIT_RATE);
        _eye.sub(_grab).applyQuaternion(_q).add(_grab);
        _tgt.sub(_grab).applyQuaternion(_q).add(_grab);
        _dir.subVectors(_tgt, _eye);
        const dlen = _dir.length() || 1e-3;
        const horiz = Math.hypot(_dir.x, _dir.z);
        if (horiz > 1e-3) orbitAxis.current.set(-_dir.z, 0, _dir.x).multiplyScalar(1 / horiz);
        // Clamp the TILT in pitch, not after the fact. The carried axis is perpendicular to the
        // look heading, so rotating the look direction about it changes its pitch by exactly the
        // rotation angle. Cap the DESIRED look-down at MAX_ORBIT_EL and apply only the residual —
        // so it lands exactly at straight-down and never rotates PAST it. (The old post-rotation
        // elevation check let a single large step overshoot the pole and land on the far side at a
        // low-enough angle to pass — teleporting the eye across the top: the reported flip/flicker.)
        const lookDown = Math.asin(THREE.MathUtils.clamp(-_dir.y / dlen, -1, 1));
        const desired = lookDown + dy * ORBIT_RATE; // drag down tilts toward straight-down
        const applied = lookDown - Math.min(desired, MAX_ORBIT_EL); // == -dy·RATE until the cap
        _q.setFromAxisAngle(orbitAxis.current, applied);
        _e2.copy(_eye).sub(_grab).applyQuaternion(_q).add(_grab);
        _t2.copy(_tgt).sub(_grab).applyQuaternion(_q).add(_grab);
        if (_e2.y > MIN_EYE_Y) {
          // ground guard
          _eye.copy(_e2);
          _tgt.copy(_t2);
        }
        void c.setLookAt(_eye.x, _eye.y, _eye.z, _tgt.x, _tgt.y, _tgt.z, false);
      } else {
        // Free-look grab handle: keep the eye fixed and swing the aim so the grabbed world point
        // (grabP) tracks the cursor — GE's "drag the world" look. Servo the view each move to pin
        // grabP's projection onto the pointer. setTarget re-aims without moving the eye.
        const pc = cam as THREE.PerspectiveCamera;
        const r = dom.getBoundingClientRect();
        c.getPosition(_eye);
        c.getTarget(_tgt);
        _dir.subVectors(_tgt, _eye);
        const d = _dir.length();
        if (d < 1e-3) return;
        _proj.copy(grabP.current).project(pc);
        if (_proj.z > 1) return; // grabbed point went behind the camera — stop tracking
        const sx = (_proj.x * 0.5 + 0.5) * r.width;
        const sy = (-_proj.y * 0.5 + 0.5) * r.height;
        // Servo gain (rad per pixel of screen error). Perspective: a pixel subtends 2·tan(fov/2)/H,
        // distance-independent (foreshortening cancels). ORTHO has no foreshortening — a view rotation
        // shifts a point at focal distance d on screen by (d/oeff)·(H/2), so the gain must scale with
        // orthoSize/d instead. The perspective gain in ortho made the aim mis-track (the Ctrl-drag
        // issue). oeff = orthoSize · framing-factor, matching ProjectionBlender's ortho frustum.
        const st = useSceneStore.getState();
        const H = Math.max(1, r.height);
        const radPerPx =
          st.projection === "orthographic"
            ? (2 * st.orthoSize * orbitFramingFactor(pc.aspect)) / (H * d)
            : (2 * Math.tan((pc.fov * DEG) / 2)) / H;
        const dYaw = THREE.MathUtils.clamp(
          (e.clientX - r.left - sx) * radPerPx,
          -MAX_STEP,
          MAX_STEP,
        );
        const dPitch = THREE.MathUtils.clamp(
          (e.clientY - r.top - sy) * radPerPx,
          -MAX_STEP,
          MAX_STEP,
        );
        _dir.multiplyScalar(1 / d);
        _q.setFromAxisAngle(_UP, dYaw);
        _dir.applyQuaternion(_q);
        _right.crossVectors(_dir, _UP).normalize();
        _q.setFromAxisAngle(_right, dPitch);
        _look.copy(_dir).applyQuaternion(_q);
        if (Math.abs(_look.y) < MAX_VERT) _dir.copy(_look);
        void c.setTarget(_eye.x + _dir.x * d, _eye.y + _dir.y * d, _eye.z + _dir.z * d, false);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (drag === "orbit") setPin(null); // pin only lives for the duration of the orbit drag
      hideGlyph(); // clear the look / move glyph on release
      drag = null;
      dom.releasePointerCapture?.(e.pointerId);
      applyCursor(); // grabbing → grab (if Ctrl still held) → default
    };

    // Double-click = zoom in toward the clicked point (~40% closer). Perspective: position-only (keeps
    // orientation, holds the point under the cursor). Ortho: scales orthoSize + re-pins. See zoomAtCursor.
    const onDbl = (e: MouseEvent) => {
      const c = controls.current;
      if (!c) return;
      zoomAtCursor(c, cam, dom, e.clientX, e.clientY, 0.6, true);
      setPin(null);
    };

    // Wheel zoom — Google Earth's curve (a fixed ~5%/notch multiplicative step, applied instantly),
    // zooming toward the cursor in BOTH projections (perspective dollies about the ground point; ortho
    // scales orthoSize + re-pins). See zoomAtCursor.
    const onWheel = (e: WheelEvent) => {
      const c = controls.current;
      if (!c) return;
      e.preventDefault();
      const k = Math.pow(0.95, -e.deltaY * 0.01 * WHEEL_ZOOM_SPEED);
      zoomAtCursor(c, cam, dom, e.clientX, e.clientY, k, false);
    };

    // Suppress the browser context menu so RMB-drag can pan.
    const onContext = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("dblclick", onDbl);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("dblclick", onDbl);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("contextmenu", onContext);
      dom.style.cursor = "";
      glyph.remove();
    };
  }, [gl, cam]);

  // ~10/s pose write-back so fog / moon-follow / panel readout track the live view.
  useFrame((state) => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const tt = state.clock.elapsedTime;
    if (tt - lastWrite.current >= 0.1) {
      lastWrite.current = tt;
      c.getTarget(_tgt);
      writeOrbitPose(state.camera as THREE.PerspectiveCamera, _tgt);
    }
  });

  if (mode !== "orbit") return null;
  return (
    <>
      <CameraControls ref={controls} makeDefault />
      {pin && (
        <Html position={pin} center zIndexRange={[100, 0]} pointerEvents="none">
          <MapPin
            className="text-sky-300"
            strokeWidth={2.5}
            style={{ width: 26, height: 26, transform: "translateY(-50%)" }}
          />
        </Html>
      )}
    </>
  );
}
