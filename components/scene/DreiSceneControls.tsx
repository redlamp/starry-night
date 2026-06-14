"use client";

import { useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Html, Line } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { MapPin } from "lucide-react";
import * as THREE from "three";
import { useSceneStore, DEFAULT_INTENT, type OrbitConfig } from "@/lib/state/sceneStore";
import { CITY_SCALE, CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { GROUND_APRON_M } from "@/components/scene/Ground";

// Phase-1 (sub-step A) orbit bridge onto drei <CameraControls>. Mounted only
// behind the ?controls=drei flag in Scene.tsx; production stays on the old
// components/scene/CameraControls.tsx. See wiki/notes/plan-drei-camera-migration.md
// "Phase 1 — build sequence" for the data-flow inversion and what's deferred.
//
// Input = the Google-Maps model (rotate/tilt on RMB instead of Google's Ctrl+LMB):
//   LMB-drag  → pan (grab-the-earth, custom ground-anchored pan)
//   LMB on pin→ scrub Focal Y (cursor-locked relative drag; tilts the view) — persp + pin on
//   Shift+LMB → rotate (L/R) + tilt (U/D) — modifier twin of RMB (trackpad / 1-button)
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
const _proj = new THREE.Vector3();
const _rel = new THREE.Vector3();

// Ortho zoom = frustum half-height (matches the old controller + ProjectionBlender).
const WHEEL_STEP = 1.1; // wheel zoom factor per tick (both projections, via zoomToPoint)
const ORTHO_SIZE_MIN = 5 * CITY_SCALE;
const ORTHO_SIZE_MAX = 2000 * CITY_SCALE;
const MIN_DIST = 50 * CITY_SCALE; // camera → focal distance band (keeps the fog sane)
const MAX_DIST = 5000 * CITY_SCALE;
// Ortho clipping: orthoSize is the zoom, so the orbit radius is decoupled from apparent size —
// but the faked-ortho frustum still uses the real camera's near/far at the real radius. A small
// radius parks the camera AMONG the city and clips its near half. So in ortho we hold the radius
// out past the scene (≥ this × the tier half-extent), which is invisible (size = orthoSize) but
// keeps the whole scene in front of the near plane. See wiki/notes/camera-tuning-notes #2.
// 1.5 → parks ortho at ~4800 at the default tier (3200 × 1.5), the user's chosen ortho
// distance (2026-06-14); still clip-safe (camera sits ~1600 past the scene's near edge).
const ORTHO_RADIUS_FACTOR = 1.5;
const ORTHO_ELEV_FLOOR_DEG = 0; // ortho: allow tilting fully to the horizon (parallel view) — the ground-framing ease in applyScreenFocus keeps the low-angle framing clean
function orthoMinRadius(): number {
  const r = CITY_TIERS[useSceneStore.getState().citySize] + GROUND_APRON_M;
  return Math.min(r * ORTHO_RADIUS_FACTOR, MAX_DIST);
}
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
const FREE_LOOK_SENS = 0.0035; // LMB+RMB free-look: radians of view rotation per pixel
const GESTURE_LOCK_PX = 12; // two-finger: travel before locking to one of pinch/twist/tilt
// Focal indicator: a ground beacon ring around the focal's ground point.
const RING_RADIUS = 50;
const RING_Y = 0; // on the ground (depthTest:false draws the ring over the terrain)
const COLOR_ABOVE = "#7dd3fc"; // focal indicator colour above ground (sky)
const COLOR_BELOW = "#b5835a"; // focal indicator colour below ground (soil)
// Pin-scrub: LMB on the pin scrubs Focal Y as a CURSOR-LOCKED RELATIVE drag. The pin is
// parked at the screen-focus % (focalOffset), so it can't also follow the cursor positionally
// — so we hide the cursor and read movementY instead (see wiki/research/camera-interaction-models).
const FOCAL_Y_MIN = -1000; // matches the Focal Y slider range (CameraPanel)
const FOCAL_Y_MAX = 1000;
const FOCAL_SCRUB_K = 0.0018; // Focal-Y units per pixel, ×distance (consistent feel across zoom)
const PIN_HIT_HALF_W = 16; // pin grab hit box, screen px (centred on the projected focal)
const PIN_HIT_TOP = 34; // px above the focal screen point — the pin icon body extends up
const PIN_HIT_BOT = 8; // px below the tip
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

// Ground bounds = the ground disc (Ground.tsx): centre CITY_CENTER, radius = the
// current tier's half-extent + apron. The focal/target is clamped to it so a pan
// or zoom can't push the focus off the map — which, at shallow elevation, would
// otherwise rocket the rig toward the horizon.
const _clamped = { x: 0, z: 0 };
function clampToGround(x: number, z: number, out: { x: number; z: number }): void {
  const r = CITY_TIERS[useSceneStore.getState().citySize] + GROUND_APRON_M;
  const dx = x - CITY_CENTER.x;
  const dz = z - CITY_CENTER.z;
  const d2 = dx * dx + dz * dz;
  if (d2 <= r * r) {
    out.x = x;
    out.z = z;
    return;
  }
  const k = r / Math.sqrt(d2);
  out.x = CITY_CENTER.x + dx * k;
  out.z = CITY_CENTER.z + dz * k;
}

// Translate the rig (camera + target) by a horizontal ground delta, clamping the
// resulting focal to the ground disc and shifting the camera by the SAME clamped
// amount so the pose is preserved. Every pan / zoom-truck path goes through here.
function panRig(c: CameraControlsImpl, dx: number, dz: number): void {
  c.getTarget(_tgt);
  c.getPosition(_camPos);
  clampToGround(_tgt.x + dx, _tgt.z + dz, _clamped);
  const ax = _clamped.x - _tgt.x;
  const az = _clamped.z - _tgt.z;
  void c.setLookAt(
    _camPos.x + ax,
    _camPos.y,
    _camPos.z + az,
    _clamped.x,
    _tgt.y,
    _clamped.z,
    false,
  );
}

// Park the orbit pivot (the pin) at the SCREEN FOCUS position — a fraction up from
// the bottom of the screen — via camera-controls' focal offset. The camera still
// orbits the pivot, but the pivot renders off-centre, so rotating around it keeps it
// fixed on screen at that height. The world offset scales with distance (perspective)
// / orthoSize (ortho) so the screen % holds through zoom. Only writes on a real
// change, so a resting camera can still rest.
const _focalOff = new THREE.Vector3();
// Ortho low-elevation ground framing. As the camera tilts toward the horizon the ground plane
// (y = 0, lookAtY below the pin) sweeps up the frame and leaves below-ground void at the bottom.
// Below ORTHO_GROUND_EASE_DEG, pull the pivot DOWN so the ground line settles near the bottom,
// keeping real content across the top ORTHO_GROUND_CONTENT_CAP of the frame. The pull magnitude is
// keyed to elevation (smoothstep — proportional to how parallel the view is, and only where the void
// appears), then the APPLIED value is damped over time so a fast tilt eases in instead of tracking
// 1:1 and lurching. Scaled by projectionBlend, so it's an ortho-only effect.
const ORTHO_GROUND_EASE_DEG = 12;
const ORTHO_GROUND_CONTENT_CAP = 0.95;
const ORTHO_GROUND_DAMP = 6; // damped-follow rate for the pivot pull (≈0.2s time constant); higher = snappier
let _groundCorr = 0; // smoothed pivot correction (≤ 0 = pulled down). Module-level; resets on reload.
function applyScreenFocus(c: CameraControlsImpl, camera: THREE.Camera, dt?: number): void {
  const s = useSceneStore.getState();
  const base = s.orbitPivotFromBottom;
  const blend = s.projectionBlend;
  // Elevation-keyed target pull (≤ 0): how far below the user's ScreenY to sit at this tilt.
  let corrTarget = 0;
  if (blend > 0.0001) {
    const elevDeg = 90 - c.polarAngle / DEG;
    if (elevDeg < ORTHO_GROUND_EASE_DEG) {
      // groundDrop = how far below the pin the ground line sits (frame fraction) at this tilt.
      const groundDrop = (s.orbit.lookAtY * Math.cos(elevDeg * DEG)) / (2 * s.orthoSize);
      const target = 1 - ORTHO_GROUND_CONTENT_CAP + groundDrop; // pivot that lands ground at the cap
      if (target < base) {
        const x = clamp((ORTHO_GROUND_EASE_DEG - elevDeg) / ORTHO_GROUND_EASE_DEG, 0, 1);
        const k = x * x * (3 - 2 * x) * blend; // smoothstep, faded out toward perspective
        corrTarget = (target - base) * k; // negative — only ever pulls the pin DOWN
      }
    }
  }
  // Damp the applied pull over time (frame-rate independent) so the slide is smooth at any tilt
  // speed. Per-frame callers pass dt; one-shot re-parks (post-zoom) omit it and reuse the last value.
  if (dt && dt > 0) _groundCorr = THREE.MathUtils.damp(_groundCorr, corrTarget, ORTHO_GROUND_DAMP, dt);
  const frac = base + _groundCorr - 0.5; // 0 = centre, < 0 below centre, > 0 above
  // Half-height the morph frames at the focal plane — the SAME bridge ProjectionBlender
  // uses (perspK at blend 0 → orthoSize at blend 1), so the parked pin tracks the framing
  // through a projection morph instead of popping when projection flips but blend hasn't.
  const perspK = c.distance * Math.tan(((camera as THREE.PerspectiveCamera).fov * DEG) / 2);
  const halfH = perspK + (s.orthoSize - perspK) * blend;
  const offY = frac * 2 * halfH;
  if (Math.abs(offY - c.getFocalOffset(_focalOff).y) > 0.5) c.setFocalOffset(0, offY, 0, false);
}

// Keep the camera above ground WITHOUT capping the zoom: if a zoom-out drops it below
// y=0 (looking up at the focal, pushed far back), KEEP the new radius and raise the
// elevation to ground level (smaller polar) — the rig moves back AND tilts up to fit.
function liftAboveGround(c: CameraControlsImpl): void {
  c.getTarget(_tgt);
  const groundCos = clamp(-_tgt.y / Math.max(1, c.distance), -1, 1); // cos(polar) at cameraY = 0
  if (Math.cos(c.polarAngle) < groundCos) {
    void c.rotateTo(c.azimuthAngle, Math.acos(groundCos), false);
  }
}

// Free-look (LMB + RMB): rotate the view around the camera's OWN position — look
// around in place. The focal rides a FIXED distance along the new view ray, so its
// height (Focal Y) follows the pitch (you can look up), while applyScreenFocus keeps
// it parked at the screen-focus position. Distance held = "mode B".
const _quat = new THREE.Quaternion();
const _look = new THREE.Vector3();
function freeLookAim(c: CameraControlsImpl, dx: number, dy: number): void {
  c.getPosition(_camPos);
  c.getTarget(_tgt);
  _camFwd.subVectors(_tgt, _camPos);
  const d = _camFwd.length();
  if (d < 1e-3) return;
  _camFwd.multiplyScalar(1 / d); // unit view direction
  _quat.setFromAxisAngle(_UP, -dx * FREE_LOOK_SENS); // yaw around world up
  _camFwd.applyQuaternion(_quat);
  _camRight.crossVectors(_camFwd, _UP).normalize(); // camera right
  _quat.setFromAxisAngle(_camRight, -dy * FREE_LOOK_SENS); // pitch
  _look.copy(_camFwd).applyQuaternion(_quat);
  if (Math.abs(_look.y) < 0.996) _camFwd.copy(_look); // clamp short of vertical (no flip)
  // re-aim from the SAME position at distance d → rotate in place; the new target's Y
  // becomes Focal Y. setLookAt keeps the position and re-derives the orbit.
  void c.setLookAt(
    _camPos.x,
    _camPos.y,
    _camPos.z,
    _camPos.x + _camFwd.x * d,
    _camPos.y + _camFwd.y * d,
    _camPos.z + _camFwd.z * d,
    false,
  );
}

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

// Is the cursor over the focal pin? Project the (logical) orbit target — which renders at the
// screen-focus % via focalOffset, so projecting it with the offset camera gives its on-screen
// spot — and test a small box around the pin icon (tip on that point, body extending upward).
// Under faked ortho camera.project takes the perspective branch (wrong spot), so project via the
// parallel ortho frustum ourselves (the forward of groundHit's ortho ray).
function pinScreenHit(
  camera: THREE.Camera,
  dom: HTMLCanvasElement,
  focal: THREE.Vector3,
  clientX: number,
  clientY: number,
): boolean {
  const r = dom.getBoundingClientRect();
  let sx: number;
  let sy: number;
  if (useSceneStore.getState().projectionBlend >= 0.9999) {
    const aspect = r.width / Math.max(1, r.height);
    const halfH = useSceneStore.getState().orthoSize;
    camera.updateMatrixWorld();
    _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.getWorldDirection(_camFwd);
    camera.getWorldPosition(_camWorld);
    _rel.subVectors(focal, _camWorld);
    if (_rel.dot(_camFwd) <= 0) return false; // behind the camera
    sx = (_rel.dot(_camRight) / (halfH * aspect)) * 0.5 * r.width + 0.5 * r.width + r.left;
    sy = -(_rel.dot(_camUp) / halfH) * 0.5 * r.height + 0.5 * r.height + r.top;
  } else {
    _proj.copy(focal).project(camera);
    if (_proj.z > 1) return false; // behind the camera
    sx = (_proj.x * 0.5 + 0.5) * r.width + r.left;
    sy = (-_proj.y * 0.5 + 0.5) * r.height + r.top;
  }
  const dx = clientX - sx;
  const dy = clientY - sy;
  // Below ground the pin icon is flipped (scaleY(-1)), so its body extends DOWN from the tip —
  // mirror the hit box, else the focal can't be re-grabbed once it's dragged below the horizon.
  const above = focal.y >= 0 ? PIN_HIT_TOP : PIN_HIT_BOT;
  const below = focal.y >= 0 ? PIN_HIT_BOT : PIN_HIT_TOP;
  return Math.abs(dx) <= PIN_HIT_HALF_W && dy >= -above && dy <= below;
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
  // dollyTo / orthoSize only set goals. Re-park the pivot for the new distance/size and
  // flush — so the dolly AND the focal-offset shift are both baked into the camera before
  // we re-pin the cursor's ground point (otherwise the offset change drifts it next frame).
  applyScreenFocus(c, camera);
  c.update(0);
  if (had && groundHit(camera, dom, sx, sy, 0, _hit)) {
    _delta.subVectors(_anchor, _hit);
    panRig(c, _delta.x, _delta.z); // truck to re-pin the cursor's ground point (clamped to bounds)
  }
}

// orbit config → drei setLookAt. azimuthDeg and camera-controls azimuthAngle are
// both atan2(x,z); elevation above horizon → polar from +Y is (90 − elevation).
function applyOrbit(c: CameraControlsImpl, o: OrbitConfig, transition: boolean): Promise<void> {
  // Clamp polar so the camera stays at/above the ground: cameraY = lookAtY +
  // radius·cos(polar) >= 0 → polar <= acos(-lookAtY/radius). Lets the camera orbit
  // BELOW the focal's level when Focal Y is high enough, but never underground.
  const maxPolar = Math.acos(clamp(-o.lookAtY / Math.max(1, o.radius), -1, 1));
  const polar = clamp((90 - o.elevationDeg) * DEG, 0.01, maxPolar);
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

// Write the live pose back to the store, flagged so the store→camera sync ignores
// it — only slider / preset edits (not our own readback) should drive the camera.
function writeBack(c: CameraControlsImpl, syncing: { current: boolean }) {
  syncing.current = true;
  useSceneStore.getState().setOrbit(readOrbit(c));
  syncing.current = false;
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
  const syncingFromCamera = useRef(false); // true while writing readback → store
  // Show the markers when the indicator is toggled on OR while a panel slider (Focal Y /
  // Screen Y) is being adjusted (transient focalAdjust flag).
  const showFocal = useSceneStore((s) => s.showFocalIndicator || s.focalAdjust !== "");
  const pinRef = useRef<THREE.Group>(null); // map-pin marker AT the focal point (camera aim)
  const ringRef = useRef<THREE.Group>(null); // ground beacon ring below the focal
  const plumbRef = useRef<ComponentRef<typeof Line>>(null); // plumbline: focal → ground
  const dotRef = useRef<THREE.Group>(null); // dot on the ground below the focal
  const pinIconRef = useRef<HTMLDivElement>(null); // the pin's DOM icon (flipped when below ground)
  const dotElRef = useRef<HTMLDivElement>(null); // the ground dot's DOM node (recoloured below ground)
  const ringLineRef = useRef<ComponentRef<typeof Line>>(null); // the beacon ring Line (recoloured below)

  // On entry: pin the perspective lens to the default fov (Google-like; zoom is dolly,
  // not FOV), and HONOR the default / persisted projection (orthographic by default,
  // 2026-06-14) rather than forcing perspective — so a fresh launch lands exactly
  // where Reset does. Snap the transient projectionBlend to match the projection so
  // there's no boot morph. `p` still toggles perspective↔ortho within the session.
  useEffect(() => {
    const s = useSceneStore.getState();
    // THROWAWAY camera-tuning override (2026-06-14): dial the default framing from the
    // URL to A/B perspective FOV against ortho size/distance without editing constants.
    // Remove once the defaults are dialed in.
    //   ?projection=perspective|orthographic  ?fov=N  ?orthoSize=N  ?radius=N
    // Note: in ortho the live radius is auto-parked below, so ?radius mainly bites in
    // perspective. Runs in orbit mode (interactive) — not in headless ?capture stills.
    const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const qProjection = q?.get("projection");
    const projectionOverride =
      qProjection === "perspective" || qProjection === "orthographic" ? qProjection : null;
    if (projectionOverride) s.setProjection(projectionOverride);

    const qFov = Number(q?.get("fov"));
    if (q?.has("fov") && Number.isFinite(qFov)) s.setCameraIntent({ fov: qFov });
    else if (s.cameraIntent.fov !== DEFAULT_INTENT.fov)
      s.setCameraIntent({ fov: DEFAULT_INTENT.fov });

    const qOrthoSize = Number(q?.get("orthoSize"));
    if (q?.has("orthoSize") && Number.isFinite(qOrthoSize) && qOrthoSize > 0)
      s.setOrthoSize(qOrthoSize);

    const qRadius = Number(q?.get("radius"));
    if (q?.has("radius") && Number.isFinite(qRadius) && qRadius > 0) s.setOrbit({ radius: qRadius });

    if (q?.get("pinPlane") === "1") s.setShowPinPlane(true);

    const effectiveProjection = projectionOverride ?? s.projection;
    s.setProjectionBlend(effectiveProjection === "orthographic" ? 1 : 0);
  }, []);

  // Button map: LMB = pan (custom anchored pan below), RMB = rotate/tilt. Touch
  // keeps the Google model (1-finger pan / 2-finger pinch+twist).
  useEffect(() => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const A = CameraControlsImpl.ACTION;
    c.mouseButtons.left = A.NONE; // pan handled by the custom anchored-pan effect (LMB)
    c.mouseButtons.right = A.ROTATE; // rotate (horizontal) + tilt (vertical)
    c.mouseButtons.wheel = A.NONE; // wheel handled by the custom zoom-to-cursor effect (both projections)
    c.dollyToCursor = false; // we pin the cursor's GROUND point ourselves (zoomToPoint), no camera-controls dolly
    c.touches.one = A.NONE; // all touch gestures handled custom below (ortho-correct)
    c.touches.two = A.NONE;
    c.minPolarAngle = 0.01; // overhead-ish at most
    // maxPolarAngle is set live per-frame (ground clamp derived from Focal Y + radius)
    // Distance band (matches the old controller). Keeps the camera→centre distance
    // sane so the city-anchored fog (FogTicker, distance-driven) doesn't collapse
    // to a white-out when dollied in or vanish when dollied way out.
    c.minDistance = MIN_DIST;
    c.maxDistance = MAX_DIST;
  }, [projection, mode]);

  // Shift = rotate modifier on LMB — the trackpad / one-button twin of the RMB rotate
  // (mirrors Google/Mapbox's Ctrl/Shift+drag fallback). While Shift is held, hand LMB
  // to camera-controls as ROTATE; releasing restores it to NONE so the custom
  // ground-anchored pan resumes. camera-controls recomputes its action from
  // (buttons & mouseButtons) on every pointermove, so a mid-drag Shift press/release
  // switches cleanly; the custom pan effect bails on shiftKey so the two never fight.
  // No cleanup reset needed: the button-map effect re-baselines left = NONE on every
  // orbit (re)entry, and within a session this effect never tears down.
  useEffect(() => {
    if (mode !== "orbit") return;
    const A = CameraControlsImpl.ACTION;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      const c = controls.current;
      if (!c) return;
      c.mouseButtons.left = e.type === "keydown" ? A.ROTATE : A.NONE;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [mode]);

  useEffect(() => {
    const dom = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      const s = useSceneStore.getState();
      if (s.cameraMode !== "orbit") return;
      wheelFrames.current = 10; // mark a wheel as "controlling" so readback tracks
      e.preventDefault();
      const c = controls.current;
      if (!c) return;
      const factor = e.deltaY < 0 ? 1 / WHEEL_STEP : WHEEL_STEP;
      if (s.orbitZoomToPin) {
        // "z" mode: zoom toward the PIN (orbit target) — pure dolly, the focal stays put.
        if (s.projection === "orthographic") {
          s.setOrthoSize(clamp(s.orthoSize * factor, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
        } else {
          void c.dollyTo(c.distance * factor, false);
          applyScreenFocus(c, camera); // re-park the pin for the new distance NOW (no hiccup)
          c.update(0);
        }
      } else {
        // default: zoom toward the CURSOR's ground point (zoomToPoint pins it in one step;
        // the focal trucks to follow). Ortho → orthoSize, persp → dolly.
        zoomToPoint(c, camera, dom, e.clientX, e.clientY, factor);
      }
      // Don't cap zoom-out at the ground — keep the new radius and raise the elevation so
      // the camera stays above ground (pushed back + tilted up to fit).
      if (s.projection !== "orthographic") liftAboveGround(c);
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
      if (e.pointerType !== "mouse" || e.button !== 0 || e.shiftKey) return; // Shift+LMB = rotate
      const c = controls.current;
      if (!c) return;
      // A press on the pin belongs to the Focal-Y scrub, not pan (hit-test here so the
      // bail is independent of listener order). Scrub needs the indicator shown.
      const s = useSceneStore.getState();
      if (s.showFocalIndicator) {
        c.getTarget(_tgt);
        if (pinScreenHit(camera, dom, _tgt, e.clientX, e.clientY)) return;
      }
      if (!groundHit(camera, dom, e.clientX, e.clientY, 0, _anchor)) return;
      panning.current = true; // the drag-threshold tracker handles pause + readback
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!panning.current) return;
      if ((e.buttons & 0b11) === 0b11) {
        panning.current = false; // both buttons down → free-look owns the gesture
        return;
      }
      if (e.shiftKey) {
        panning.current = false; // Shift pressed mid-drag → hand the LMB to rotate
        return;
      }
      const c = controls.current;
      if (!c) return;
      if (!groundHit(camera, dom, e.clientX, e.clientY, 0, _hit)) return;
      _delta.subVectors(_anchor, _hit); // world shift to bring the anchor back under cursor
      panRig(c, _delta.x, _delta.z); // clamped to the ground disc → no rocketing off-map
    };
    const onUp = (e: PointerEvent) => {
      if (!panning.current) return;
      panning.current = false;
      dom.releasePointerCapture?.(e.pointerId);
      const c = controls.current;
      if (c) writeBack(c, syncingFromCamera);
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

  // Pin-scrub (LMB on the focal pin): set Focal Y by a CURSOR-LOCKED RELATIVE drag. A positional
  // drag can't work — the pin is parked at the screen-focus % (applyScreenFocus), so it can't
  // also follow the cursor up the screen. So we hide the cursor and read movementY: the pin holds
  // its screen spot, the camera re-aims (tilts) at the new Focal Y. A 3D scrubby-slider. Lighter
  // than the Pointer Lock API (no "press Esc" overlay): cursor:none + pointer capture + relative
  // movement, restored on release. Indicator-on only; works in both projections (pinScreenHit
  // projects ortho-correctly); touch keeps the Focal Y slider. See
  // wiki/research/camera-interaction-models. Camera position never moves here (only the aim
  // tilts), so the scrub can't push the rig through the ground.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    let scrubbing = false;
    let focalY = 0;
    let lastHover = false;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || e.shiftKey) return;
      const s = useSceneStore.getState();
      if (!s.showFocalIndicator) return;
      const c = controls.current;
      if (!c) return;
      c.getTarget(_tgt);
      if (!pinScreenHit(camera, dom, _tgt, e.clientX, e.clientY)) return;
      e.preventDefault();
      scrubbing = true;
      dragging.current = true; // hold the auto-revolution sweep + drive live writeBack
      panning.current = false; // pan must not co-own this press
      focalY = _tgt.y;
      dom.style.cursor = "none";
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!scrubbing) {
        // hover affordance (discoverability): ns-resize over the pin, default elsewhere — only
        // when idle (no button down) so it doesn't fight pan / rotate.
        if (e.buttons !== 0) return;
        const s = useSceneStore.getState();
        const c = controls.current;
        let over = false;
        if (c && s.showFocalIndicator) {
          c.getTarget(_tgt);
          over = pinScreenHit(camera, dom, _tgt, e.clientX, e.clientY);
        }
        if (over !== lastHover) {
          dom.style.cursor = over ? "ns-resize" : "";
          lastHover = over;
        }
        return;
      }
      // Only LMB drives the scrub — if another button joins (RMB → free-look), hand it off so
      // the two don't both re-aim the camera.
      if (e.buttons !== 1) {
        finish(e.pointerId);
        return;
      }
      const c = controls.current;
      if (!c) return;
      c.getTarget(_tgt);
      c.getPosition(_camPos);
      focalY = clamp(focalY - e.movementY * c.distance * FOCAL_SCRUB_K, FOCAL_Y_MIN, FOCAL_Y_MAX);
      // re-aim at the new Focal Y from the SAME camera position → the view tilts; applyScreenFocus
      // (main frame) keeps the pin parked at the screen-focus %.
      void c.setLookAt(_camPos.x, _camPos.y, _camPos.z, _tgt.x, focalY, _tgt.z, false);
    };
    const finish = (pointerId: number) => {
      if (!scrubbing) return;
      scrubbing = false;
      dragging.current = false;
      lastHover = false;
      dom.style.cursor = "";
      dom.releasePointerCapture?.(pointerId);
      const c = controls.current;
      if (c) writeBack(c, syncingFromCamera);
    };
    const onUp = (e: PointerEvent) => finish(e.pointerId);
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dom.style.cursor = "";
    };
  }, [mode, gl, camera]);

  // Free-look (hold LMB + RMB): look around IN PLACE. While both are held it suppresses
  // the custom pan + camera-controls rotate, shows the focal pin, and re-aims via
  // freeLookAim; on release it commits the new aim and restores the prior pin state.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const A = CameraControlsImpl.ACTION;
    const BOTH = 0b11; // LMB(1) | RMB(2)
    let active = false;
    let lastX = 0;
    let lastY = 0;
    let priorPin = false;
    const engage = (e: PointerEvent) => {
      const c = controls.current;
      if (!c) return;
      active = true;
      panning.current = false; // kill the custom LMB pan
      c.mouseButtons.right = A.NONE; // kill camera-controls rotate (recomputed each move)
      const st = useSceneStore.getState();
      priorPin = st.showFocalIndicator;
      if (!priorPin) st.setShowFocalIndicator(true);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const disengage = () => {
      if (!active) return;
      active = false;
      const c = controls.current;
      if (c) c.mouseButtons.right = A.ROTATE; // restore rotate
      if (!priorPin) useSceneStore.getState().setShowFocalIndicator(false);
      if (c) writeBack(c, syncingFromCamera); // commit the new aim
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (!active && (e.buttons & BOTH) === BOTH) engage(e);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (!active) {
        if ((e.buttons & BOTH) === BOTH) engage(e);
        return;
      }
      if ((e.buttons & BOTH) !== BOTH) {
        disengage();
        return;
      }
      const c = controls.current;
      if (!c) return;
      freeLookAim(c, e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      if (active) disengage();
    };
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      disengage();
    };
  }, [mode, gl]);

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
        panRig(c, _delta.x, _delta.z); // clamped to the ground disc
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
                c.setOrbitPoint(_hit.x, useSceneStore.getState().orbit.lookAtY, _hit.z);
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
            c.update(0); // flush the dolly so the re-pin truck below isn't a no-op
            if (groundHit(camera, dom, midX, midY, 0, _hit)) {
              _delta.subVectors(_anchor, _hit);
              panRig(c, _delta.x, _delta.z); // truck so the pressed point stays centred (clamped)
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
        if (c) writeBack(c, syncingFromCamera);
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
      const ty = useSceneStore.getState().orbit.lookAtY; // focus at the current focal height
      void c.setLookAt(_delta.x, _delta.y, _delta.z, _hit.x, ty, _hit.z, true).then(() => {
        dragging.current = false;
        writeBack(c, syncingFromCamera);
      });
      if (s.projection === "orthographic") {
        s.setOrthoSize(clamp(s.orthoSize * DBLCLICK_ZOOM, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
      }
    };
    dom.addEventListener("dblclick", onDbl);
    return () => dom.removeEventListener("dblclick", onDbl);
  }, [mode, gl, camera]);

  // RMB rotates around the focal/pin directly: camera-controls ROTATE orbits the
  // current target, and the focal offset (applyScreenFocus) keeps that target parked
  // at the screen-focus position — so the pin stays put on screen while you rotate.
  // No pivot re-capture, so rotating can't move the focal. (LMB+RMB slot stays open
  // for free-look.)

  // LMB + RMB (both held): reserved. Was a tween-to-default reset — stripped
  // 2026-06-09 (the chord was a no-op in practice and the gesture is better kept
  // free for a future binding). Leave this slot open.

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
      if (c) writeBack(c, syncingFromCamera);
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

  // Store → camera: apply orbit slider / preset edits (the camera owns the pose,
  // so push changes to it). Skips our own readback writes (flagged) and anything
  // mid-gesture, and only re-applies when a POSE field changed (not speed).
  useEffect(() => {
    const unsub = useSceneStore.subscribe((state, prev) => {
      if (state.orbit === prev.orbit || syncingFromCamera.current || dragging.current) return;
      const o = state.orbit;
      const p = prev.orbit;
      if (
        o.azimuthDeg === p.azimuthDeg &&
        o.elevationDeg === p.elevationDeg &&
        o.radius === p.radius &&
        o.centerX === p.centerX &&
        o.lookAtY === p.lookAtY &&
        o.centerZ === p.centerZ
      ) {
        return; // only periodSec (speed) or similar changed — no camera move
      }
      const c = controls.current;
      if (!c || state.cameraMode !== "orbit") return;
      // Focal Y is the AIM HEIGHT. A lookAtY-only edit re-aims the camera at
      // (centerX, lookAtY, centerZ) WITHOUT moving it, so raising it tilts the view up
      // instead of lifting the rig. camera-controls re-derives distance/elevation off
      // the new target — sync the live pose back (microtask avoids re-entrant setState).
      const focalYOnly =
        o.lookAtY !== p.lookAtY &&
        o.azimuthDeg === p.azimuthDeg &&
        o.elevationDeg === p.elevationDeg &&
        o.radius === p.radius &&
        o.centerX === p.centerX &&
        o.centerZ === p.centerZ;
      if (focalYOnly) {
        c.getPosition(_camPos);
        void c.setLookAt(_camPos.x, _camPos.y, _camPos.z, o.centerX, o.lookAtY, o.centerZ, false);
        queueMicrotask(() => writeBack(c, syncingFromCamera));
      } else {
        void applyOrbit(c, o, false);
      }
    });
    return unsub;
  }, []);

  // Hotkeys (orbit only): Space = pause sweep, "i" = focal indicator, "z" = zoom mode
  // (cursor ↔ pin), "u" = allow underview (the intentional under-the-ground gate). F / P are
  // taken (fly / perspective).
  useEffect(() => {
    if (mode !== "orbit") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const s = useSceneStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        s.setOrbitPaused(!s.orbitPaused);
      } else if (e.code === "KeyI") {
        e.preventDefault();
        s.setShowFocalIndicator(!s.showFocalIndicator);
      } else if (e.code === "KeyZ") {
        e.preventDefault();
        s.setOrbitZoomToPin(!s.orbitZoomToPin); // toggle zoom-to-cursor ↔ zoom-to-pin
      } else if (e.code === "KeyU") {
        e.preventDefault();
        s.setAllowUnderview(!s.allowUnderview); // gate the intentional under-the-ground view
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // Focal markers — priority -1, so they update AFTER camera-controls' own update
  // (also -1) but BEFORE drei <Html>'s projection (priority 0). That keeps the Html
  // pin in lockstep with the 3D plumbline / dot / ring — no 1-frame lag during fast
  // free-look. Pin sits ON the orbit target (the camera's aim); dot + beacon ring on
  // the ground directly below it; the plumbline connects them.
  useFrame(() => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    if (!(pinRef.current || ringRef.current || plumbRef.current || dotRef.current)) return;
    c.getTarget(_focal);
    // below ground → recolour every focal asset earthy brown (sky-blue above) and flip
    // the pin (pivoting on its tip). A clear "looking into the soil" cue.
    const below = _focal.y < 0;
    const col = below ? COLOR_BELOW : COLOR_ABOVE;
    if (pinRef.current) {
      pinRef.current.position.copy(_focal);
      pinRef.current.updateMatrixWorld();
      if (pinIconRef.current) {
        pinIconRef.current.style.transform = below
          ? "translate(-50%, -100%) scaleY(-1)"
          : "translate(-50%, -100%)";
        pinIconRef.current.style.color = col;
      }
    }
    if (dotRef.current) {
      dotRef.current.position.set(_focal.x, 0, _focal.z);
      dotRef.current.updateMatrixWorld();
      if (dotElRef.current) dotElRef.current.style.background = col;
    }
    if (ringRef.current) ringRef.current.position.set(_focal.x, RING_Y, _focal.z);
    if (ringLineRef.current) ringLineRef.current.material.color.set(col);
    if (plumbRef.current) {
      plumbRef.current.geometry.setPositions([_focal.x, _focal.y, _focal.z, _focal.x, 0, _focal.z]);
      plumbRef.current.computeLineDistances();
      plumbRef.current.material.color.set(col);
    }
  }, -1);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const s = useSceneStore.getState();

    // seed the camera from the stored orbit pose on the first orbit frame
    if (!seeded.current) {
      void applyOrbit(c, s.orbit, false);
      seeded.current = true;
    }

    // park the orbit pivot at the screen-focus position (focal offset; scales w/ zoom)
    applyScreenFocus(c, camera, dt);

    const ortho = s.projection === "orthographic";
    const allowUnder = s.allowUnderview;

    // Distance band. Perspective: the fog-sane band (MIN_DIST). Ortho: hold the radius out
    // past the scene so the faked-ortho near plane never clips the city's near half — invisible
    // since orthoSize sets the apparent size, and it makes the elevation clamp below resolve to
    // "above the horizon" naturally. (camera-controls clamps distance to [min,max] each update.)
    // Gated on the BLEND, not the projection flag: during a projection morph the distance tweens
    // between the two modes' radii (tweenProjectionTo), and clamping to the ortho park mid-morph
    // would yank the camera off the tweened radius and pop the perspective-side framing. Only
    // enforce the park once the morph has essentially arrived (blend ≈ 1).
    c.minDistance = s.projectionBlend >= 0.999 ? orthoMinRadius() : MIN_DIST;

    // Ground clamp for orbit elevation: let the camera drop BELOW the focal's level
    // (negative elevation) but never below y=0. cameraY = focalY + radius·cos(polar) ≥ 0
    // → maxPolar = acos(-focalY/radius), so a higher Focal Y allows more below-orbit.
    // Recomputed live since Focal Y and radius both move (zoom / free-look / slider).
    c.getTarget(_tgt);
    let maxPolar = Math.acos(clamp(-_tgt.y / Math.max(1, c.distance), -1, 1));
    if (allowUnder) {
      // Intentional underview (the "explore later" gate): relax the ground clamp so the camera
      // can drop below the ground and look up at the world from underneath.
      maxPolar = Math.PI * 0.98;
    } else if (ortho) {
      // Ortho: cap at the horizon (elevation ≥ ORTHO_ELEV_FLOOR_DEG, now 0). The camera can tilt
      // fully parallel; the ground-framing ease in applyScreenFocus pulls the pivot down at low
      // elevation so the parallel view doesn't leave below-ground void at the bottom.
      maxPolar = Math.min(maxPolar, (90 - ORTHO_ELEV_FLOOR_DEG) * DEG);
    }
    c.maxPolarAngle = maxPolar;

    // (Focal markers update in a dedicated priority -1 useFrame above, so the Html pin
    // and the 3D plumbline stay in lockstep — see the comment there.)

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
      if (controlling) writeBack(c, syncingFromCamera);
    }
  });

  // sub-step A: orbit only. Fly / still stay on the old controller (flag off).
  if (mode !== "orbit") return null;
  return (
    <>
      <CameraControls ref={controls} />
      {/* Focal markers stay MOUNTED and toggle visibility (3D `visible`, Html `display`),
          never conditional-render: drei <Html> flashes at the world origin on mount, so a
          show/hide on a gesture flickers. The priority -1 frame keeps them parked on the
          focal point even while hidden, so revealing them is flash-free (#80). */}
      {/* plumbline focal → ground + ground radius ring, drawn on top of terrain */}
      <Line
        ref={plumbRef}
        visible={showFocal}
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
      <group ref={ringRef} visible={showFocal}>
        <Line
          ref={ringLineRef}
          points={RING_POINTS}
          color="#7dd3fc"
          lineWidth={1.5}
          transparent
          opacity={0.7}
          depthTest={false}
        />
      </group>
      {/* small dot at the plumbline's ground end (≈ map-pin stroke width) */}
      <group ref={dotRef}>
        {/* pointer-events via style, NOT the pointerEvents prop: drei ignores
            that prop in its non-transform branch, so the marker would capture
            the wheel and create a zoom dead-zone right over the focal point. */}
        <Html center style={{ pointerEvents: "none" }} zIndexRange={[100, 0]}>
          <div
            ref={dotElRef}
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "#7dd3fc",
              filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6))",
              display: showFocal ? undefined : "none",
            }}
          />
        </Html>
      </group>
      {/* map pin (DOM → always on top); tip anchored on the focal point */}
      <group ref={pinRef}>
        <Html center={false} style={{ pointerEvents: "none" }} zIndexRange={[100, 0]}>
          <div
            ref={pinIconRef}
            style={{
              transform: "translate(-50%, -100%)",
              transformOrigin: "50% 100%", // tip (bottom centre) — the flip pivots on the focal point
              color: "#7dd3fc",
              filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
              display: showFocal ? undefined : "none",
            }}
          >
            <MapPin size={28} strokeWidth={2.5} />
          </div>
        </Html>
      </group>
    </>
  );
}
