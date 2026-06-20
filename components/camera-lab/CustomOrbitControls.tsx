"use client";

// Custom orbit input shared by the "lever-arm" and "fixed-rate" methods. drei's own
// mouse/touch actions are disabled and we drive controls.rotate / truck / dolly /
// setLookAt from raw pointer events, so the rotate MODEL is ours to pick.
//
//   leverArm=true  -> a faithful port of the app's orbit input (DreiSceneControls):
//       LMB                       rotate (press-point-relative azimuth) + regulated tilt
//       LMB on the pin            scrub Focal Y (cursor-locked relative drag; re-aims in place)
//       RMB / Shift+LMB           ground-anchored "grab the earth" pan
//       LMB+RMB / Ctrl|Cmd+LMB    free-look (look around in place; Focal Y follows the pitch)
//       wheel                     dolly toward the pin (the app's default zoom mode)
//       dbl-click / double-tap    reset view
//       1-finger rotate+tilt · 2-finger pan|pinch (locks to the leader) · 3-finger free-look
//   leverArm=false -> uniform degrees-per-pixel rotate + tilt (classic OrbitControls), a
//       screen-plane truck pan, dolly zoom; no pin-scrub / free-look (the honest baseline).

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import CameraControlsImpl from "camera-controls";
import type { LabTuning } from "./tuning";
import { parkFocal, cameraHalfHeight, snapFocalY } from "./labProjection";

const _tgt = new THREE.Vector3();
const _scr = new THREE.Vector3();
const _ga = new THREE.Vector3();
const _gb = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lk = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
const _rayA = new THREE.Vector3();
const _rayB = new THREE.Vector3();
const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Ground-pan limit near the horizon. A cursor-locked ground pan re-pins the grabbed point under
// the cursor, but as the view grazes the ground the pick ray runs near-parallel to it, so one
// drag pixel maps to an enormous (or, across the horizon, sign-flipped) ground delta — the focal
// teleports to the far side of the map. So we cap the per-event step to a few × the equivalent
// screen-plane pan, and taper the rate toward the horizon (most at 0°). Above the band it stays
// exact cursor-lock.
const PAN_CAP_MULT = 6; // max ground-lock step as a multiple of the screen-plane pan for the same pixels
const PAN_TAPER_DEG = 12; // elevation below which the pan rate eases off
const PAN_TAPER_FLOOR = 0.2; // pan rate at 0° elevation (fraction), so it still creeps, never rockets

const FREE_LOOK_GAIN = 1; // 1 = a drag tracks the focal (pin) plane 1:1 (app parity)
const FOCAL_SCRUB_K = 0.0018; // Focal-Y units per pixel, ×distance (app parity)
const FOCAL_Y_MIN = -1000;
const FOCAL_Y_MAX = 1000;
const PIN_HIT_PX = 28; // screen radius to grab the focus pin for the Focal-Y scrub (mouse)
const PIN_HIT_TOUCH_PX = 44; // larger grab radius for touch (fat finger)
const GESTURE_LOCK_PX = 12; // two-finger travel before locking to pan OR pinch
const DOUBLE_TAP_MS = 300;
const TAP_MAX_MS = 250;
const TAP_MOVE_PX = 16;

export function CustomOrbitControls({
  controls,
  leverArm,
  tuning,
  showPin,
  onReset,
}: {
  controls: React.RefObject<CameraControlsImpl | null>;
  leverArm: boolean;
  tuning: LabTuning;
  showPin: boolean;
  onReset: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const tun = useRef(tuning);
  const showPinRef = useRef(showPin);
  const onResetRef = useRef(onReset);
  useEffect(() => {
    tun.current = tuning;
  }, [tuning]);
  useEffect(() => {
    showPinRef.current = showPin;
  }, [showPin]);
  useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);

  // live damping
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.smoothTime = tuning.smoothTime;
    c.draggingSmoothTime = Math.min(tuning.smoothTime, 0.12);
  }, [controls, tuning.smoothTime]);

  // Double-click (mouse) + double-tap (touch) → reset view, like the app. touch-action:none
  // suppresses the synthesized dblclick on the canvas, so detect the tap chain ourselves.
  useEffect(() => {
    const dom = gl.domElement;
    const onDbl = (e: MouseEvent) => {
      e.preventDefault();
      onResetRef.current();
    };
    let activeId = -1;
    let fingers = 0;
    let downAt = 0;
    let downX = 0;
    let downY = 0;
    let moved = false;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      fingers += 1;
      if (fingers !== 1) {
        activeId = -1; // a second finger → a gesture owns it, not a tap
        return;
      }
      activeId = e.pointerId;
      downAt = e.timeStamp;
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      if (Math.abs(e.clientX - downX) > TAP_MOVE_PX || Math.abs(e.clientY - downY) > TAP_MOVE_PX) {
        moved = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (fingers > 0) fingers -= 1;
      if (e.pointerId !== activeId) return;
      activeId = -1;
      if (moved || e.timeStamp - downAt > TAP_MAX_MS) {
        lastTapAt = 0; // a drag / long press breaks the chain
        return;
      }
      const near =
        Math.abs(e.clientX - lastTapX) <= TAP_MOVE_PX * 2 &&
        Math.abs(e.clientY - lastTapY) <= TAP_MOVE_PX * 2;
      if (e.timeStamp - lastTapAt <= DOUBLE_TAP_MS && near) {
        lastTapAt = 0;
        onResetRef.current();
      } else {
        lastTapAt = e.timeStamp;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
      }
    };
    dom.addEventListener("dblclick", onDbl);
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      dom.removeEventListener("dblclick", onDbl);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

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

    const dom = gl.domElement;
    const pts = new Map<number, { x: number; y: number }>();
    let mode: "none" | "rotate" | "pan" | "scrub" | "freelook" = "none";
    let lastX = 0;
    let lastY = 0;
    let lastDist = 0;
    let accX = 0; // axis-gate accumulators (lever-arm rotate)
    let accY = 0;
    let scrubY = 0; // Focal Y being scrubbed (raw accumulated value, cursor-locked)
    let scrubSnapped = false; // held in the Focal-Y = 0 detent
    let hovering = false; // ns-resize affordance over the pin
    // two-finger lock state (lever-arm)
    let g2: "pan" | "pinch" | null = null;
    let startDist = 0;
    let startMidX = 0;
    let startMidY = 0;
    let lastMidX = 0;
    let lastMidY = 0;
    let last3X = 0; // three-finger free-look midpoint
    let last3Y = 0;

    const eased = () => tun.current.smoothTime > 0.02;
    const capture = (id: number) => {
      try {
        dom.setPointerCapture?.(id);
      } catch {
        // inactive / synthetic pointer — capture is optional
      }
    };

    const focusScreen = () => {
      c.getTarget(_tgt);
      _scr.copy(_tgt).project(camera);
      const r = dom.getBoundingClientRect();
      return { x: r.left + ((_scr.x + 1) / 2) * r.width, y: r.top + ((1 - _scr.y) / 2) * r.height };
    };

    // Is (sx,sy) over the focus pin? Project the orbit target (parked low by the focal offset,
    // which project() reflects) and test a screen-space radius around it. Touch passes a larger
    // radius (fat-finger grab).
    const pinHit = (sx: number, sy: number, radius = PIN_HIT_PX) => {
      c.getTarget(_tgt);
      _scr.copy(_tgt).project(camera);
      if (_scr.z > 1) return false; // behind the camera
      const r = dom.getBoundingClientRect();
      const px = r.left + ((_scr.x + 1) / 2) * r.width;
      const py = r.top + ((1 - _scr.y) / 2) * r.height;
      return Math.hypot(sx - px, sy - py) <= radius;
    };

    const doRotate = (dx: number, dy: number, px: number, py: number) => {
      const t = tun.current;
      const H = Math.max(1, dom.clientHeight);
      let dAz: number;
      let dPolar = (-2 * Math.PI * t.tiltSpeed * dy) / H;
      if (leverArm) {
        const pin = focusScreen();
        const vx = px - pin.x;
        const vy = py - pin.y;
        const r2 = Math.max(vx * vx + vy * vy, t.leverMinR * t.leverMinR);
        dAz = ((vx * dy - vy * dx) / r2) * t.rotateSpeed;
        if (t.axisGate) {
          accX = accX * 0.9 + Math.abs(dx);
          accY = accY * 0.9 + Math.abs(dy);
          const hf = accX / (accX + accY + 1e-6);
          const xa = clamp((hf - 0.4) / 0.3, 0, 1);
          dAz *= xa * xa * (3 - 2 * xa);
        }
        // App parity: taper rotate AND tilt by elevation (smoothstep to the floor below
        // the threshold) + distance (1/d past 5000, floor 0.35), then cap per event at
        // 0.2 rad. Same constants as the shipped DreiSceneControls.
        const elevDeg = 90 - c.polarAngle / DEG;
        const xe = clamp(elevDeg / Math.max(1, t.slowBelowDeg), 0, 1);
        const gElev = t.lowAngleGain + (1 - t.lowAngleGain) * (xe * xe * (3 - 2 * xe));
        const gDist = clamp(5000 / Math.max(5000, c.distance), 0.35, 1);
        const gain = gElev * gDist;
        dAz = clamp(dAz * gain, -0.2, 0.2);
        dPolar = clamp(dPolar * gain, -0.2, 0.2);
      } else {
        dAz = -t.rotateSpeed * dx * 0.005; // uniform deg/px; no taper/cap (that is the point)
      }
      void c.rotate(dAz, dPolar, eased());
    };

    // Ground-anchored "grab the earth": cast the cursor ray to the ground (y=0). Unproject the
    // near- and far-plane points and take their difference as the ray — this reads the camera's
    // LIVE projection matrix, so it's correct for perspective, the faked ortho, AND every blend in
    // between (the morph). The grab point lies between near and far (t in [0,1]); a near-horizon
    // up-ray gives t outside that range → no hit, so the pan stops instead of flipping to the far
    // side of the map.
    const groundHit = (sx: number, sy: number, out: THREE.Vector3) => {
      const r = dom.getBoundingClientRect();
      const nx = ((sx - r.left) / r.width) * 2 - 1;
      const ny = -(((sy - r.top) / r.height) * 2 - 1);
      _rayA.set(nx, ny, -1).unproject(camera); // near-plane point
      _rayB.set(nx, ny, 1).unproject(camera); // far-plane point
      _rayB.sub(_rayA); // near → far direction (diverging in persp, parallel in ortho)
      if (Math.abs(_rayB.y) < 1e-9) return false;
      const tt = -_rayA.y / _rayB.y;
      if (tt < 0 || tt > 1) return false; // ground not in front between near & far
      out.copy(_rayA).addScaledVector(_rayB, tt);
      return true;
    };

    const doPan = (prevX: number, prevY: number, currX: number, currY: number) => {
      if (leverArm) {
        if (groundHit(prevX, prevY, _ga) && groundHit(currX, currY, _gb)) {
          let dx = _ga.x - _gb.x; // horizontal world delta that re-locks the grabbed point
          let dz = _ga.z - _gb.z;
          // Near-horizon limit: cap the step to PAN_CAP_MULT × the equivalent screen-plane pan
          // (kills the grazing teleport), then taper the rate toward the horizon.
          const pixel = Math.hypot(currX - prevX, currY - prevY);
          const wpp = (2 * cameraHalfHeight(c, camera)) / Math.max(1, dom.clientHeight);
          const cap = PAN_CAP_MULT * wpp * pixel;
          const mag = Math.hypot(dx, dz);
          if (cap > 0 && mag > cap) {
            const k = cap / mag;
            dx *= k;
            dz *= k;
          }
          const elev = 90 - c.polarAngle / DEG;
          const xe = clamp(elev / PAN_TAPER_DEG, 0, 1);
          const gain = PAN_TAPER_FLOOR + (1 - PAN_TAPER_FLOOR) * (xe * xe * (3 - 2 * xe));
          dx *= gain;
          dz *= gain;
          c.getPosition(_cp);
          c.getTarget(_tgt);
          void c.setLookAt(_cp.x + dx, _cp.y, _cp.z + dz, _tgt.x + dx, _tgt.y, _tgt.z + dz, false);
        }
        return;
      }
      // fixed-rate: classic screen-plane truck (negate so content tracks the cursor)
      const t = tun.current;
      const k = (t.panSpeed * Math.max(1, c.distance)) / Math.max(1, dom.clientHeight);
      void c.truck(-(currX - prevX) * k, -(currY - prevY) * k, eased());
    };

    // Free-look (lever-arm): rotate the view around the camera's OWN position — look around in
    // place. The focal rides a fixed distance along the new view ray, so its height (Focal Y)
    // follows the pitch. Screen-proportional rate: one drag pixel rotates by the angle subtending
    // one focal-plane pixel, so the scene tracks the cursor 1:1 at the current zoom (app parity).
    const freeLook = (dx: number, dy: number) => {
      c.getPosition(_cp);
      c.getTarget(_tgt);
      _fwd.subVectors(_tgt, _cp);
      const d = _fwd.length();
      if (d < 1e-3) return;
      _fwd.multiplyScalar(1 / d);
      const H = Math.max(1, dom.clientHeight);
      // world units per vertical pixel at the focal plane → 1:1 cursor tracking at any zoom.
      // Projection-correct: perspective foreshortens with distance, ortho is distance-independent.
      const wppY = (2 * cameraHalfHeight(c, camera)) / H;
      const rate = (wppY / d) * FREE_LOOK_GAIN;
      _q.setFromAxisAngle(_UP, -dx * rate); // yaw around world up
      _fwd.applyQuaternion(_q);
      _right.crossVectors(_fwd, _UP).normalize();
      _q.setFromAxisAngle(_right, -dy * rate); // pitch
      _lk.copy(_fwd).applyQuaternion(_q);
      if (Math.abs(_lk.y) < 0.996) _fwd.copy(_lk); // clamp short of vertical (no flip)
      void c.setLookAt(_cp.x, _cp.y, _cp.z, _cp.x + _fwd.x * d, _cp.y + _fwd.y * d, _cp.z + _fwd.z * d, false);
    };

    // Zoom about a screen point (pinch midpoint): dolly the rig by `factor`, then re-pin the ground
    // point that was under it so it stays put — Google's zoom-to-cursor (lever-arm pinch, app
    // parity). Always a dolly: the faked ortho is sized to the orbit distance, so dollying scales
    // the apparent size in both projections (and the morph), and groundHit re-pins through the live
    // matrix. (factor < 1 = zoom in.)
    const zoomAtScreen = (sx: number, sy: number, factor: number) => {
      const had = groundHit(sx, sy, _ga);
      void c.dollyTo(c.distance * factor, false);
      parkFocal(c, camera, leverArm); // re-park the pin for the new size, then flush…
      c.update(0);
      if (had && groundHit(sx, sy, _gb)) {
        const ddx = _ga.x - _gb.x;
        const ddz = _ga.z - _gb.z;
        c.getPosition(_cp);
        c.getTarget(_tgt);
        void c.setLookAt(_cp.x + ddx, _cp.y, _cp.z + ddz, _tgt.x + ddx, _tgt.y, _tgt.z + ddz, false);
      }
    };

    const doDolly = (deltaY: number) => {
      const t = tun.current;
      void c.dolly(-deltaY * 0.001 * t.zoomSpeed * Math.max(1, c.distance), true);
    };

    const finishScrub = () => {
      mode = "none";
      dom.style.cursor = "";
    };

    const mid = (a: { x: number; y: number }[]) => {
      let x = 0;
      let y = 0;
      for (const p of a) {
        x += p.x;
        y += p.y;
      }
      return { x: x / a.length, y: y / a.length };
    };
    const twoFingerStart = () => {
      const a = [...pts.values()];
      startDist = lastDist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const m = mid(a);
      startMidX = lastMidX = m.x;
      startMidY = lastMidY = m.y;
      g2 = null; // undetermined until pan / pinch leads past GESTURE_LOCK_PX
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        capture(e.pointerId);
        const n = pts.size;
        if (n === 1) {
          // a 1-finger press ON the pin scrubs Focal Y (mobile equivalent of LMB-on-pin); else rotate
          if (leverArm && showPinRef.current && pinHit(e.clientX, e.clientY, PIN_HIT_TOUCH_PX)) {
            mode = "scrub";
            c.getTarget(_tgt);
            scrubY = _tgt.y;
            scrubSnapped = _tgt.y === 0;
            lastY = e.clientY;
          } else {
            mode = "rotate";
            lastX = e.clientX;
            lastY = e.clientY;
            accX = accY = 0;
          }
        } else if (n === 2) {
          mode = "pan"; // (lock resolves in onMove)
          twoFingerStart();
        } else if (n === 3 && leverArm) {
          mode = "freelook";
          const m = mid([...pts.values()]);
          last3X = m.x;
          last3Y = m.y;
        }
        return;
      }
      // (mouse) — uses the effect-level `c` (stable: one camera, no controls rebuild)
      const both = (e.buttons & 0b11) === 0b11;
      const ctrlLook = (e.buttons & 0b01) === 0b01 && (e.ctrlKey || e.metaKey);
      if (leverArm && (both || ctrlLook)) {
        mode = "freelook";
        lastX = e.clientX;
        lastY = e.clientY;
        capture(e.pointerId);
        return;
      }
      if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (leverArm && showPinRef.current && pinHit(e.clientX, e.clientY)) {
          mode = "scrub";
          c.getTarget(_tgt);
          scrubY = _tgt.y;
          scrubSnapped = _tgt.y === 0;
          lastY = e.clientY;
          dom.style.cursor = "none";
          capture(e.pointerId);
          return;
        }
        mode = "rotate";
      } else if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        mode = "pan";
      } else return;
      lastX = e.clientX;
      lastY = e.clientY;
      accX = accY = 0;
      capture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const c = controls.current;
        if (!c) return;
        const n = pts.size;
        if (n === 1 && mode === "scrub") {
          // Focal-Y scrub: use the finger's Y delta (touch movementY is unreliable), same K + ground
          // detent as the mouse pin-scrub. Re-aims in place; parkFocal keeps the pin screen-parked.
          c.getTarget(_tgt);
          c.getPosition(_cp);
          scrubY = clamp(scrubY - (e.clientY - lastY) * c.distance * FOCAL_SCRUB_K, FOCAL_Y_MIN, FOCAL_Y_MAX);
          lastY = e.clientY;
          const snap = snapFocalY(scrubY, scrubSnapped, c.distance);
          scrubSnapped = snap.snapped;
          void c.setLookAt(_cp.x, _cp.y, _cp.z, _tgt.x, snap.y, _tgt.z, false);
        } else if (n === 1 && mode === "rotate") {
          doRotate(e.clientX - lastX, e.clientY - lastY, e.clientX, e.clientY);
          lastX = e.clientX;
          lastY = e.clientY;
        } else if (n === 2) {
          const a = [...pts.values()];
          const dist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
          const m = mid(a);
          if (leverArm) {
            // lock to pan (midpoint travel) vs pinch (spread change) — whichever leads first.
            if (g2 === null) {
              const accPinch = Math.abs(dist - startDist);
              const accPan = Math.hypot(m.x - startMidX, m.y - startMidY);
              if (Math.max(accPinch, accPan) > GESTURE_LOCK_PX) {
                g2 = accPinch > accPan ? "pinch" : "pan";
                lastMidX = m.x;
                lastMidY = m.y;
              }
            }
            if (g2 === "pinch" && lastDist > 0 && dist > 0) {
              zoomAtScreen(m.x, m.y, lastDist / dist); // <1 spread = zoom in
            } else if (g2 === "pan") {
              doPan(lastMidX, lastMidY, m.x, m.y);
              lastMidX = m.x;
              lastMidY = m.y;
            }
          } else {
            // fixed-rate: classic simultaneous pan + pinch
            doPan(lastMidX, lastMidY, m.x, m.y);
            if (lastDist > 0 && dist > 0) doDolly((lastDist - dist) * 1.5);
            lastMidX = m.x;
            lastMidY = m.y;
          }
          lastDist = dist;
        } else if (n >= 3 && leverArm) {
          const m = mid([...pts.values()]);
          freeLook(m.x - last3X, m.y - last3Y);
          last3X = m.x;
          last3Y = m.y;
        }
        return;
      }
      // ---- mouse ----
      // idle hover affordance for the Focal-Y scrub pin
      if (e.buttons === 0) {
        if (leverArm && showPinRef.current) {
          const over = pinHit(e.clientX, e.clientY);
          if (over !== hovering) {
            dom.style.cursor = over ? "ns-resize" : "";
            hovering = over;
          }
        }
        return;
      }
      if (mode === "none") return;
      const both = (e.buttons & 0b11) === 0b11;
      const ctrlLook = (e.buttons & 0b01) === 0b01 && (e.ctrlKey || e.metaKey);
      if (leverArm && (both || ctrlLook)) {
        if (mode !== "freelook") {
          mode = "freelook"; // a second button / modifier joined → re-anchor, look next event
          lastX = e.clientX;
          lastY = e.clientY;
          return;
        }
        freeLook(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (mode === "freelook") {
        mode = "none"; // dropped back to a single button → require a re-press
        return;
      }
      if (mode === "scrub") {
        if ((e.buttons & 0b11) !== 0b01) {
          finishScrub();
          return;
        }
        const c = controls.current;
        if (!c) return;
        c.getTarget(_tgt);
        c.getPosition(_cp);
        scrubY = clamp(scrubY - e.movementY * c.distance * FOCAL_SCRUB_K, FOCAL_Y_MIN, FOCAL_Y_MAX);
        // sticky detent at ground level (Focal Y = 0): snaps in when near, holds until dragged out
        const snap = snapFocalY(scrubY, scrubSnapped, c.distance);
        scrubSnapped = snap.snapped;
        void c.setLookAt(_cp.x, _cp.y, _cp.z, _tgt.x, snap.y, _tgt.z, false); // re-aim in place → tilt
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (mode === "rotate") doRotate(dx, dy, e.clientX, e.clientY);
      else if (mode === "pan") doPan(lastX, lastY, e.clientX, e.clientY);
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        pts.delete(e.pointerId);
        try {
          dom.releasePointerCapture?.(e.pointerId);
        } catch {
          // inactive / synthetic pointer
        }
        const n = pts.size;
        if (n === 2) {
          twoFingerStart(); // dropped 3 → 2: re-seed the pan / pinch baseline
        } else if (n === 1) {
          const r = [...pts.values()][0];
          mode = "rotate";
          lastX = r.x;
          lastY = r.y;
          accX = accY = 0;
        } else if (n === 0) {
          mode = "none";
        }
        return;
      }
      if (mode === "scrub") dom.style.cursor = "";
      mode = "none";
      hovering = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      doDolly(e.deltaY);
    };
    const onCtx = (e: Event) => e.preventDefault();

    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("contextmenu", onCtx);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("contextmenu", onCtx);
      dom.style.cursor = "";
    };
  }, [controls, gl, camera, leverArm]);

  // The per-frame Screen-Y park, ground clamp, readout, and __labCC handle live in <ProjectionRig>
  // (shared by every camera-controls method). This component only translates raw pointer input.
  return null;
}
