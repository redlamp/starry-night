"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { uiObstructionInsetLeft } from "@/lib/scene/focusBuilding";
import { CameraControls, Html } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { Cone, MapPin } from "lucide-react";
import * as THREE from "three";
import { useSceneStore, DEFAULT_INTENT, DEFAULT_PROJECTION } from "@/lib/state/sceneStore";
import { orbitFramingFactor } from "@/lib/scene/aspectFraming";
import { markCameraActivity } from "@/lib/scene/cameraActivity";
import { cameraCommand } from "@/lib/scene/cameraCommand";
import { tweenProjectionTo, cropFollowScale } from "@/lib/scene/cameraView";
import { isTypingTarget } from "@/lib/utils";
import { CITY_SCALE, CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { displayedRadius, resolveCityShape } from "@/lib/seed/cityShape";
import { GROUND_APRON_M } from "../Ground";
import { writeOrbitPose } from "./orbitWriteback";

// "Starry Night Cam v3" — v2's drone rig with the parallel camera MODES folded in as
// in-camera behaviours instead of model swaps (one continuous camera, no handoffs):
//
//   1. TOP-DOWN as a flight, not a model: `t` glides THIS camera overhead (whole-city plan
//      framing) and every control keeps working up there — pan, zoom, WASD, even tilt.
//      `t` again returns to the exact pre-top-down pose, UNLESS the view was manually
//      tilted away from overhead (past TD_STILL_ELEV_DEG), in which case `t` re-squares
//      to top-down instead; the original return pose stays banked for the next `t`.
//   2. DRIFT (reworked 2026-07-16): the Drift model's motion — azimuth revolve + focal
//      wander + a gentle elevation bob — flying from wherever the camera sits (current
//      radius/elevation, not the Drift model's establishing distance). Two ways in:
//      drift MODE (runtime store.driftMode; Space / helicopter button / Drift header
//      switch) flies until told otherwise — manual adjustments pause it and it eases
//      back in after release; IDLE drift (snv3.idleDrift + idleDelaySec) takes off by
//      itself after the delay, and any input stops it until the timer runs down again.
//      Feel knobs reuse the Drift sliders (store.drift): revolve/wander/bob/breathe.
//   3. CONE-VIEW FRAMING: a focusRequest may carry viewAzimuthDeg (the arc-perpendicular
//      bearing EntityColumns computes) — the focus glide rotates there the SHORT way, so
//      commute/connection arcs present broadside. While LMB-orbiting a cone-view pivot,
//      a pin + cone glyph marks the arcs' centre point the view is revolving around.
//   4. TOUCH, hand-rolled (v2 left camera-controls' native touch on; it reads wrong on
//      phones): 1-finger orbits + tilts around the touched ground point, 2-finger pans
//      (ground-anchored midpoint) + pinch-zooms toward the pinch centre, double-tap
//      zooms in. Same math as the mouse gestures, same clamps.
//
//   Desktop   LMB drag         Orbit + Tilt around the CLICKED point (a pin marks it; cleared on release)
//             RMB / Shift+LMB  Move — grab the ground (grabbing cursor); it stays under the cursor
//             Ctrl/⌘ + LMB     Aim — grab a map point and swing the view in place (free-look)
//             wheel            Zoom toward the cursor  ·  double-click  Zoom in
//             t                Top-down toggle (in-camera flight, see above)
//   Touch     1-finger         Orbit + Tilt  ·  2-finger  pan + pinch-zoom  ·  double-tap  Zoom in
//
// Perspective + faked-ortho (via ProjectionBlender), same as v2: parallel-ray picks at
// full ortho, orthoSize-based zoom, frame-on-mount + ~10/s pose write-back. Self-gates
// to orbit. Forked from StarryNightV2Model 2026-07-15 (the registry's models are
// deliberately self-contained; v2 stays untouched as the fallback).

const DEG = Math.PI / 180;
const ORBIT_RATE = 0.006; // rad per pixel of Shift orbit (~0.34°/px; a ~500px drag ≈ 170°)
const MIN_EYE_Y = 1; // floor the camera ~1m above the ground while orbiting / tilting / reframing
const MAX_VERT = 0.98; // clamp free-look short of straight up/down (no flip)
const MAX_ORBIT_EL = 89.9 * DEG; // orbit look-down cap: 0.1° short of straight-down; never crosses (no flip)
const MAX_STEP = 0.15; // per-move cap on the free-look servo (rad), guards against big jumps
const PAN_EYE_REACH_MULT = 2.0; // how far past the ground disc the EYE may travel when panning, as a
// multiple of the ground-disc radius — keeps the aim on the ground but lets the camera back out to
// view the "snow globe" from outside. At LARGE view distances (a zoomed-out cone view) the pan
// handler grows this ring to groundR + the eye's current horizontal offset, so the eye never pins
// on its rim while the focal is still travelling (pinning changed the eye→focal distance, which
// read as a stuck camera + an RMB "zoom" — test round 3.21/5.30)
const WHEEL_ZOOM_SPEED = 1.6; // GE/OrbitControls wheel curve: ~5% dolly per notch at speed 1.
// Raised from 1.0 + the perspective step now rides camera-controls' smoothTime easing
// (smooth=true) instead of landing instantly — faster AND softer (test round 5.30).
// Focused building's apparent size (user 2026-07-08): its bounding sphere
// should span ~a third of the DISPLAY HEIGHT — a comfortable subject-in-scene
// framing rather than filling the frame.
const FOCUS_HEIGHT_FRACTION = 0.4; // 0.33 read as too zoomed-out (user 2026-07-08)
const FOCUS_MIN_DIST = 60 * CITY_SCALE; // don't dolly closer than this on focus (keeps small houses at a sane size)
const FOCUS_SMOOTH_TIME = 0.45; // camera-controls smoothTime DURING a focus. 0.18 (v2's snappy
// value) read as too quick (test round 5.31) — 0.45 settles in ~1.5 s, a deliberate glide.
const ORTHO_FOCUS_DURATION = 1.2; // seconds for the ortho size ramp; > the pan settle so the zoom trails it
const TAP_ZOOM_SMOOTH_TIME = 0.4; // smoothTime for the double-tap / double-click zoom-in glide (4.27)
const TAP_ZOOM_ORTHO_SEC = 0.7; // matching ortho size-ramp duration for that glide
const ORTHO_FOCUS_EASE = (t: number) => t * t * (3 - 2 * t); // smoothstep — flat start so the zoom lags the pan
// WASD/QE fly-through (SNCv2). Speed scales with on-screen scale so the glide is
// zoom-constant (Google-Earth style): altitude in perspective, orthoSize × framing in
// ortho. Tuned so a held key crosses ~1 viewport/sec; snv2.moveSpeed multiplies it.
const MOVE_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const MOVE_ALT_K = 0.6; // perspective: world units/sec per unit of altitude
const MOVE_ORTHO_K = 1.3; // ortho: world units/sec per unit of (orthoSize × framing)
const MOVE_MIN_ALT = 20; // floor the altitude used for speed so near-ground isn't frozen
const _mvEye = new THREE.Vector3();
const _mvTgt = new THREE.Vector3();
const _mvFwd = new THREE.Vector3();
const _mvRight = new THREE.Vector3();
const _mvDelta = new THREE.Vector3();
const ORTHO_SIZE_MIN = 5 * CITY_SCALE; // faked-ortho zoom band (frustum half-height); matches Map
const ORTHO_SIZE_MAX = 2000 * CITY_SCALE;
// "Skyline Mode": aim within 2° of flat (EITHER projection) — looking at the city edge-on, like an
// architectural elevation. In this regime (a) the ground pick is degenerate (near-parallel ray) so the
// orbit/pan pivot is synthesized at the mid-map point under the cursor, and (b) RMB-vertical drag
// reframes the city vertically: ORTHO shifts a focal-offset lens (the eye is invisible there, so it
// reads as a pure frame shift); PERSPECTIVE pedestals the coupled eye + focal (a real altitude move,
// floored at MIN_EYE_Y) — "reframing the camera". Both push the empty ground off the bottom, no re-tilt.
const SKYLINE_TILT_SIN = Math.sin(2 * DEG);
const SKYLINE_SCREEN_Y_MIN = 0.05; // v3-local Skyline framing (fraction of the city's rest point up from bottom)
const SKYLINE_SCREEN_Y_MAX = 0.95;

// ---- Top-down flight (v3 behaviour 1) -------------------------------------------------
const TOP_DOWN_MARGIN = 1.15; // same whole-city fit margin the Top-Down model uses
// Still "in top-down" while the look-down elevation stays above this; drop below it (a
// manual tilt away) and the next `t` re-squares to overhead instead of restoring. Pan /
// zoom / WASD keep the elevation at ~90°, so they do NOT count as leaving top-down.
const TD_STILL_ELEV_DEG = 65;
// Overhead polar: a hair off exactly-vertical so camera-controls' azimuth stays
// well-defined at the pole (kept azimuth = the current heading through the dive).
const TD_POLAR = 0.001; // rad from zenith
const TD_SMOOTH_TIME = 0.55; // camera-controls smoothTime during the top-down dive/return

// ---- Idle drift (v3 behaviour 2) -------------------------------------------------------
// Shape constants match DriftModel's; the feel knobs (wander reach/speed, bob, revolve,
// breathe) are read live from store.drift so the Drift sliders tune this too.
const DRIFT_RADIUS_FREQ = 0.02; // rad/s — dolly-breathe period ~5 min
const DRIFT_EL_FREQ = 0.035; // rad/s — elevation-bob period ~3 min
const DRIFT_WANDER_W = [0.013, 0.029, 0.047] as const; // rad/s, incommensurate wander freqs
// The drift is VELOCITY-shaped, not pose-lerped (user 2026-07-15 round 4: blending the
// focal toward the absolute wander path glided it kilometres at engage). Everything
// starts at ZERO rate at the current pose and builds to full speed over the ramp; the
// focal follows the wander's VELOCITY from wherever it starts. The city centre is a
// BOUND, not an attractor (round 5): the focal may roam anywhere inside a disc of
// wanderRadius × tier around CITY_CENTER — it is never pulled toward the centre, it
// just can't wander off the city. (Engaging OUTSIDE that disc widens the bound to the
// start distance so there's no clamp jump; the wander then works its way back in.)
const DRIFT_RAMP_SEC = 10; // seconds to build from standstill to full drift speed (idle takeoff)
const DRIFT_RESUME_RAMP_SEC = 5; // quicker build for a commanded takeoff / post-adjust resume
const DRIFT_RESUME_SEC = 1.6; // in drift MODE: seconds after the last input before easing back in
const DRIFT_AIM_SETTLE = 0.1; // s⁻¹ — the aim height eases to ground level at this gentle rate
const DRIFT_EL_MIN = 3; // deg — the bob band's floor (never grazes the ground)
const DRIFT_EL_MAX = 55; // deg — cap the band centre so drift never reads as top-down
// Clip avoidance: the drifting EYE cruises above the tallest possible building so a
// wander through downtown can't clip through towers on any seed. Worst-case skyline =
// spire 220 m × height jitter 1.22 × outlier 1.5 × silhouette multiplier ≈ ~480 m
// (heights don't scale with the size tier); 520 clears it with margin. The elevation
// band's floor is raised (smoothly, on the ramp) until the eye sits at this altitude —
// at typical drift radii that is still a near-horizon ~6–10°.
const DRIFT_CRUISE_ALT = 520; // m — minimum drifting eye height
// A stable [0,1) phase from the seed (FNV-1a), matching DriftModel.seedPhase — so v3's
// idle drift opens on the same bearing character as the Drift model for the same city.
function driftSeedPhase(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
// One axis of the brownian-like wander, normalised to ~[-1,1] (weights sum to 1).
function driftWander1(t: number, seedPh: number, axisPh: number): number {
  return (
    0.55 * Math.sin(t * DRIFT_WANDER_W[0] + seedPh + axisPh) +
    0.3 * Math.sin(t * DRIFT_WANDER_W[1] + seedPh * 1.7 + axisPh) +
    0.15 * Math.sin(t * DRIFT_WANDER_W[2] + seedPh * 2.3 + axisPh)
  );
}

// ---- Touch gestures (v3 behaviour 4) ---------------------------------------------------
const TOUCH_DOUBLE_TAP_MS = 320; // two taps within this window …
const TOUCH_DOUBLE_TAP_PX = 40; // … and this radius = double-tap zoom-in
const TOUCH_TAP_MAX_MS = 250; // a tap must release within this to count as one

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
const _focalOff = new THREE.Vector3(); // Skyline Mode: live camera-controls focal offset (read-back)
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
  const st = useSceneStore.getState();
  const ortho = st.projectionBlend >= 0.9999;
  const aspect = r.width / Math.max(1, r.height);
  cam.updateMatrixWorld();
  cam.getWorldDirection(_fwd);
  // SKYLINE MODE (flat aim, EITHER projection): the cursor ray grazes the ground, so a true hit is far
  // and unstable — the pivot flings around near the horizon (and in perspective the pan ray misses
  // entirely). The cursor carries no depth signal when flat (screen-vertical maps to world height, not
  // ground depth), so synthesize the pick: CITY_CENTER's forward depth (the "midway point of the ground"),
  // slid along the horizontal right-axis to stay under the cursor. Lateral scale differs by projection —
  // ortho uses the fixed frustum half-width; perspective uses the half-width at that depth (f·tan(fov/2)).
  // Callers' clampToCity keeps it on the disc.
  if (Math.abs(_fwd.y) <= SKYLINE_TILT_SIN) {
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    cam.getWorldPosition(_camWorld);
    const fhLen = Math.hypot(_fwd.x, _fwd.z) || 1e-6;
    const rhLen = Math.hypot(_right.x, _right.z) || 1e-6;
    const fhx = _fwd.x / fhLen;
    const fhz = _fwd.z / fhLen;
    const rhx = _right.x / rhLen;
    const rhz = _right.z / rhLen;
    const f = (CITY_CENTER.x - _camWorld.x) * fhx + (CITY_CENTER.z - _camWorld.z) * fhz; // fwd depth of city centre
    const halfW = ortho
      ? st.orthoSize * orbitFramingFactor(aspect) * aspect
      : Math.max(0, f) * Math.tan(((cam as THREE.PerspectiveCamera).fov * DEG) / 2) * aspect;
    const lat = nx * halfW; // lateral offset under the cursor
    out.set(_camWorld.x + fhx * f + rhx * lat, 0, _camWorld.z + fhz * f + rhz * lat);
    return true;
  }
  if (ortho) {
    const halfH = st.orthoSize * orbitFramingFactor(aspect);
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _camUp.setFromMatrixColumn(cam.matrixWorld, 1);
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
// The distance bounds clamp the EYE→PIVOT distance — the thing this zoom actually scales. (It used
// to clamp eye→TARGET, which the uniform scale holds constant once pinned at max — so wheel-out
// compounded UNBOUNDED, the camera receded past the far plane, and the whole city culled away;
// user report 2026-07-16. The pivot is always clamped to the city disc, so bounding the eye against
// it keeps the city renderable at max zoom-out.) This is Google Earth's zoom-toward-cursor (no
// re-aim), shared by the wheel and the double-click zoom-in. Returns the transition promise so
// callers can bracket it (e.g. a smoothTime override).
function zoomAboutPoint(c: CameraControlsImpl, pivot: THREE.Vector3, k: number, smooth: boolean) {
  c.getPosition(_eye);
  c.getTarget(_tgt);
  const oldR = _eye.distanceTo(pivot) || 1e-3;
  const s = THREE.MathUtils.clamp(oldR * k, c.minDistance, c.maxDistance) / oldR;
  return c.setLookAt(
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
// put (re-pin). k < 1 = zoom in. `orthoRamp` (optional): when given with smooth=true, the ortho
// size change is handed to the caller's eased ramp (the orthoFocus mechanism) and the re-pin truck
// glides via camera-controls — a tween instead of the instant snap (double-tap/-click, 4.27); the
// wheel keeps the instant path (small per-notch steps). Returns the transition promise when there
// is one, so callers can bracket it (smoothTime override).
function zoomAtCursor(
  c: CameraControlsImpl,
  cam: THREE.Camera,
  dom: HTMLElement,
  sx: number,
  sy: number,
  k: number,
  smooth: boolean,
  orthoRamp?: (target: number) => void,
) {
  const s = useSceneStore.getState();
  if (s.projection === "orthographic") {
    const target = THREE.MathUtils.clamp(s.orthoSize * k, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX);
    const had = groundHit(cam, dom, sx, sy, _anchor); // pre-zoom ground point under the cursor
    if (smooth && orthoRamp) {
      // Measure the re-pin slide AT the target size (groundHit reads orthoSize from the
      // store, so set → measure → revert), then ease both channels: the size via the
      // caller's ramp, the truck via a camera-controls transition.
      const from = s.orthoSize;
      s.setOrthoSize(target);
      const had2 = had && groundHit(cam, dom, sx, sy, _cur);
      s.setOrthoSize(from);
      orthoRamp(target);
      if (had2) {
        _delta.subVectors(_anchor, _cur);
        c.getPosition(_eye);
        c.getTarget(_tgt);
        return c.setLookAt(
          _eye.x + _delta.x,
          _eye.y,
          _eye.z + _delta.z,
          _tgt.x + _delta.x,
          _tgt.y,
          _tgt.z + _delta.z,
          true,
        );
      }
      return;
    }
    s.setOrthoSize(target);
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
    return zoomAboutPoint(c, _cur, k, smooth);
  } else {
    // Low-angle guard: a cursor near the horizon hits the ground plane way off the map
    // (hit distance grows ~1/sin(tilt)), and zooming about that far pivot lunges the
    // camera across the city. Orbit and pan already clamp their picks to the disc
    // (groundHit's stated contract); zoom was the one caller that didn't.
    const cl = clampToCity(_cur.x, _cur.z);
    _cur.set(cl.x, 0, cl.z);
  }
  return zoomAboutPoint(c, _cur, k, smooth);
}

// Keep a point within a disc of radius R centred on CITY_CENTER (world XZ). clampToCity below is the
// ground-disc-radius convenience most callers use; the pan handler also clamps the EYE independently
// to a larger disc (PAN_EYE_REACH_MULT × the ground radius) so backing the camera up can't dead-stop
// at the same rim the focal is held to.
function clampToDisc(
  x: number,
  z: number,
  R: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const dx = x - CITY_CENTER.x;
  const dz = z - CITY_CENTER.z;
  const d2 = dx * dx + dz * dz;
  if (d2 <= R * R) {
    out.x = x;
    out.z = z;
  } else {
    const k = R / Math.sqrt(d2);
    out.x = CITY_CENTER.x + dx * k;
    out.z = CITY_CENTER.z + dz * k;
  }
  return out;
}

// Keep the focal point within the city's ground disc (centre CITY_CENTER, radius = the current tier
// half-extent + apron) so a pan/orbit pivot/zoom pick can't wander the view off the map into the void.
// Returns the clamped [x, z] in a shared scratch object.
const _cc = { x: 0, z: 0 };
function clampToCity(x: number, z: number): { x: number; z: number } {
  const R = CITY_TIERS[useSceneStore.getState().citySize] + GROUND_APRON_M;
  return clampToDisc(x, z, R, _cc);
}
// Main oblique-pan scratch: the eye and focal clamp to DIFFERENT disc radii (PAN_EYE_REACH_MULT), so
// each needs its own output object — clampToCity's shared _cc can't serve both in the same pan step.
const _panFocal = { x: 0, z: 0 };
const _panEye = { x: 0, z: 0 };
const _driftClamp = { x: 0, z: 0 }; // idle drift's roam-bound clamp output

// Skyline Mode = the aim within 2° of flat (looking at the city edge-on), in EITHER projection. The
// RMB-vertical reframe and the per-frame focal offset key off this; the synthesized ground pick in
// groundHit shares the same flat test. Single source of truth for the threshold.
function isSkylineMode(camera: THREE.Camera): boolean {
  camera.getWorldDirection(_fwd);
  return Math.abs(_fwd.y) <= SKYLINE_TILT_SIN;
}

export function StarryNightV3Model() {
  const controls = useRef<CameraControlsImpl | null>(null);
  const cam = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const mode = useSceneStore((s) => s.cameraMode);
  const bounds = useSceneStore((s) => s.snv3); // user-set min/max distance
  const lastWrite = useRef(0);
  const grabP = useRef(new THREE.Vector3()); // free-look grab handle (a fixed world point)
  const orbitAxis = useRef(new THREE.Vector3(1, 0, 0)); // carried tilt axis (stable through straight-down)
  const skylineScreenY = useRef(0.5); // Skyline Mode framing: city rest point up from bottom (0.5 = centred)
  const orthoFocusTarget = useRef<number | null>(null); // in-flight ortho focus zoom: orthoSize goal (ramped in useFrame)
  const orthoFocusStart = useRef(0); // orthoSize at the moment the focus began
  const orthoFocusT = useRef(0); // ortho focus zoom progress 0..1 (smoothstep-eased)
  const orthoFocusDur = useRef(ORTHO_FOCUS_DURATION); // ramp seconds — focus glide vs tap-zoom (4.27)
  const baseSmoothTime = useRef<number | null>(null); // camera-controls' default smoothTime, restored after a focus
  const moveKeys = useRef<Record<string, boolean>>({}); // WASD/QE held state (by e.code), consumed in useFrame
  // Captured once, at render — BEFORE the handoff-adoption effect below can consume + clear
  // cameraHandoff — so the framing effect further down can tell a restore pose (leaving
  // top-down back to this model, #83) was pending at mount. A live getState() read INSIDE
  // that effect would already see it cleared (the handoff effect runs first) and stomp it.
  const hadHandoffOnMount = useRef(useSceneStore.getState().cameraHandoff !== null);
  // Orbit pivot marker. kind "orbit" = the transient clicked-ground pin (v2 behaviour);
  // kind "cone" = the cone-view arcs' centre point — pin + cone glyph, so it reads as
  // "the view is revolving around the middle of these arcs".
  const [pin, setPin] = useState<{ pos: [number, number, number]; kind: "orbit" | "cone" } | null>(
    null,
  );
  // Top-down flight (behaviour 1): the banked return pose. Non-null = "in top-down".
  const tdReturn = useRef<{ eye: THREE.Vector3; tgt: THREE.Vector3; orthoSize: number } | null>(
    null,
  );
  // Idle drift (behaviour 2): clock bookkeeping. clockNow mirrors the R3F clock so DOM
  // handlers (which live outside useFrame) can stamp lastInput in the same timebase.
  const clockNow = useRef(0);
  const lastInput = useRef(0);
  const driftOn = useRef(false);
  const driftT = useRef(0); // seconds since the drift engaged
  const driftAnchor = useRef({ az: 0, el: 0, r: 0, fx: 0, fy: 0, fz: 0, ph: 0, startDist: 0 });
  // Azimuth + wander clock are INTEGRATED (+= rate·dt), not computed as rate·t: with
  // the closed form, dragging the Revolve/Speed sliders mid-drift rescales the whole
  // accumulated phase and the camera JUMPS (test round 2.15). Integration makes a knob
  // change purely a speed change from here on.
  const driftAz = useRef(0); // accumulated azimuth (rad)
  const driftWt = useRef(0); // accumulated wander clock (s × wanderSpeed)
  const driftF = useRef({ x: 0, y: 0, z: 0 }); // the drifting focal (follows the wander path's velocity)
  const driftPrevW = useRef({ x: 0, z: 0 }); // last frame's wander-path position (for its velocity)
  const driftRampSec = useRef(DRIFT_RAMP_SEC); // this flight's speed-ramp length (idle vs commanded)
  const prevDriftMode = useRef(false); // edge detection for the manual drift mode
  const wasInspecting = useRef(false); // for the leave-inspect timer re-arm (2.14)
  // Every gesture / key / wheel / programmatic flight stamps this: it re-arms the idle
  // timer and cancels an in-flight drift (the drift hands the pose back wherever it is).
  const markInput = useCallback(() => {
    lastInput.current = clockNow.current;
    driftOn.current = false;
  }, []);

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

  // Adopt a camera handoff on the still→orbit transition (release-in-place from
  // a parked ?cam= view): camera-controls keeps the eye on takeover but
  // re-derives its target, which yanks the aim off the shared view (measured
  // 12.8dB PSNR vs the parked frame). setLookAt with the handed-off pose keeps
  // the exact framing; ortho matches its size to the pose so the faked-ortho
  // zoom doesn't jump (same continuity as the mount framing below).
  useEffect(() => {
    if (mode !== "orbit") return;
    const s = useSceneStore.getState();
    const h = s.cameraHandoff;
    const c = controls.current;
    if (!h || !c) return;
    void c.setLookAt(
      h.position[0],
      h.position[1],
      h.position[2],
      h.lookAt[0],
      h.lookAt[1],
      h.lookAt[2],
      false,
    );
    s.setCameraHandoff(null);
    if (s.projection === "orthographic") {
      // A handoff may carry the exact orthoSize to restore (leaving top-down back to a prior ortho
      // zoom, #83) — use it verbatim so the zoom doesn't POP on takeover. Otherwise (still->orbit
      // release-in-place) derive it from the pose distance so the faked-ortho zoom matches the frame.
      let half = h.orthoSize;
      if (half == null) {
        const dist = Math.hypot(
          h.position[0] - h.lookAt[0],
          h.position[1] - h.lookAt[1],
          h.position[2] - h.lookAt[2],
        );
        half = dist * Math.tan((s.cameraIntent.fov * DEG) / 2);
      }
      s.setOrthoSize(THREE.MathUtils.clamp(half, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
    }
  }, [mode]);

  // #87 focus: glide the pivot onto a focus request's target (a building's 3D
  // centre) and frame the whole building, keeping the current viewing direction.
  //
  // We PAN the pivot (moveTo) and dolly to the fit distance, but never touch the
  // azimuth/polar. setLookAt would tween the azimuth NUMERICALLY from the current
  // theta — which drag accumulates into whole extra turns — to atan2's (-pi, pi]
  // home value, so a focus after some orbiting revolves the camera the long way
  // round the city. Keeping the angle (moveTo + dollyTo) is the shortest route:
  // zero rotation. Distance fits the request's bounding SPHERE to the narrower of
  // the live vertical/horizontal fov (so the whole building stays on screen at
  // any orbit angle, in any aspect bucket). Consumed once; focusPivot then keeps
  // LMB-orbit pivoting on this centre (see the orbit branch below).
  useEffect(() => {
    // Runs one rAF after the request lands: a click that pushes a column AND
    // focuses (address links) has its new card in the DOM by then, so the
    // obstruction measurement below sees the row's REAL width (user
    // 2026-07-11: fly-tos center in the space right of directory + cards).
    const frameRequest = (f: NonNullable<ReturnType<typeof useSceneStore.getState>["focusRequest"]>) => {
      const c = controls.current;
      const s = useSceneStore.getState();
      if (!c || s.cameraMode !== "orbit") return;
      const pc = c.camera as THREE.PerspectiveCamera;
      const vFov = (pc.fov * DEG) / 2; // vertical half-fov
      // Two framings: "fill" fits the sphere to the limiting fov (the cone's
      // multi-location sets should use the whole frame); the default frames
      // it at FOCUS_HEIGHT_FRACTION of display height (single buildings).
      const hFov = Math.atan(Math.tan(vFov) * (pc.aspect || 1));
      // Obstruction-aware framing (user 2026-07-11): fit the sphere into the
      // width the directory + card columns leave free (`avail`) and, below,
      // bias the target into that region's center with a screen-parallel
      // focal offset — focus centers on the free area, not the canvas.
      const viewW = gl.domElement.clientWidth || 1;
      const inset = Math.max(0, Math.min(uiObstructionInsetLeft(), viewW * 0.6));
      const avail = 1 - inset / viewW;
      const hFovAvail = Math.atan(Math.tan(hFov) * avail);
      let dist =
        f.fit === "fill"
          ? Math.max(
              (f.radius / Math.sin(Math.max(1e-3, Math.min(vFov, hFovAvail)))) * 1.08,
              FOCUS_MIN_DIST,
            )
          : Math.max(f.radius / (Math.max(1e-3, Math.tan(vFov)) * FOCUS_HEIGHT_FRACTION), FOCUS_MIN_DIST);
      if (inset > 0 && f.fit !== "fill") {
        // Height-framed targets must still FIT the reduced width once offset.
        dist = Math.max(dist, (f.radius / Math.sin(Math.max(1e-3, hFovAvail))) * 1.02);
      }
      // Target appears at the available region's center: offset the camera
      // screen-left by half the inset's world width at the fit distance
      // (negative x shifts the camera left, so the subject reads right).
      const focalX = inset > 0 ? -((inset / 2 / viewW) * 2 * dist * Math.tan(hFov)) : 0;
      // POSITION/rotation get a stronger ease-out: run this transition at a shorter
      // smoothTime so the pivot zeroes in decisively, then restore the default.
      // (camera-controls' smoothTime is global to transitions, so save/restore it.)
      if (baseSmoothTime.current === null) baseSmoothTime.current = c.smoothTime;
      const base = baseSmoothTime.current;
      c.smoothTime = FOCUS_SMOOTH_TIME;
      // Elevated vantage (user 2026-07-08): settle at a 45-degree look-down on
      // the target. Azimuth: normally stays put (the no-long-revolve guarantee) —
      // UNLESS the request carries viewAzimuthDeg (the cone view's arc-perpendicular
      // bearing), in which case rotate there by the SHORTEST arc: the target theta is
      // unwrapped to the winding nearest the current (drag-accumulated) azimuth, and
      // since the bearing itself was already chosen as the nearer of the two
      // perpendicular headings, the swing is at most a quarter turn.
      let theta = c.azimuthAngle;
      if (f.viewAzimuthDeg != null) {
        const t0 = f.viewAzimuthDeg * DEG;
        const TWO_PI = Math.PI * 2;
        theta = t0 + Math.round((c.azimuthAngle - t0) / TWO_PI) * TWO_PI;
      }
      void Promise.all([
        c.moveTo(f.x, f.y, f.z, true),
        c.dollyTo(dist, true),
        c.rotateTo(theta, Math.PI / 4, true),
        c.setFocalOffset(focalX, 0, 0, true),
      ]).finally(() => {
        c.smoothTime = base;
      });
      // In ORTHO, apparent size is orthoSize (not distance), so dollyTo doesn't
      // zoom — ramp orthoSize so the building's bounding sphere fills ~half the
      // viewport HEIGHT (oeff = orthoSize·framingFactor, full height = 2·oeff, so a
      // sphere of diameter 2·radius fills half when oeff = 2·radius). The ramp is a
      // slow-start smoothstep over ORTHO_FOCUS_DURATION (see useFrame), longer than
      // the snappy pan, so we settle on position BEFORE the zoom really ramps.
      if (s.projection === "orthographic") {
        orthoFocusStart.current = s.orthoSize;
        orthoFocusT.current = 0;
        orthoFocusDur.current = ORTHO_FOCUS_DURATION;
        // Ortho mirrors the two framings: fill -> sphere spans the frame
        // (oeff = r, small margin); height -> the 33% rule (oeff = r/fraction).
        // The avail divide mirrors the perspective inset fit: the sphere gets
        // the REMAINING width; the focal offset above re-centers it there
        // (screen-parallel offsets apply to ortho identically).
        orthoFocusTarget.current = THREE.MathUtils.clamp(
          (f.fit === "fill" ? f.radius * 1.08 : f.radius / FOCUS_HEIGHT_FRACTION) /
            orbitFramingFactor(pc.aspect || 1) /
            Math.max(0.4, avail),
          ORTHO_SIZE_MIN,
          ORTHO_SIZE_MAX,
        );
      } else {
        orthoFocusTarget.current = null;
      }
    };

    const unsub = useSceneStore.subscribe((s, p) => {
      const c = controls.current;
      // Closing the card columns retires any framing bias a fly-to applied —
      // the next plain focus recenters anyway, but don't leave the view
      // shifted once the obstruction is gone (user 2026-07-11).
      if (c && s.columnCursor < 0 && p.columnCursor >= 0) {
        void c.setFocalOffset(0, 0, 0, true);
      }
      const f = s.focusRequest;
      if (f === p.focusRequest || !f) return;
      // Consume NOW (re-entrant subscribe sees null), frame next frame.
      useSceneStore.getState().setFocusRequest(null);
      markInput(); // a fly-to is user intent: cancel a drift, re-arm the idle timer
      requestAnimationFrame(() => frameRequest(f));
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame the city + control config. ALL mouse input is custom (below) — including the wheel, so
  // its zoom curve matches Google Earth; native touch is left on for the mobile gestures.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (!hadHandoffOnMount.current) {
      // Open to the curated default pose (DEFAULT_INTENT) — the hero establishing shot. v2 opens
      // here on mount UNLESS a restore handoff (leaving top-down back to this model, #83) was
      // already pending — the effect above adopts that pose instead, and this step must not
      // stomp it. Absent a handoff, it doesn't restore a saved pose either (the old computed
      // framing didn't).
      // #56 crop-follow: scale the hero shot's horizontal offset from CITY_CENTER by the
      // displayed radius vs. the tier DEFAULT_INTENT was authored at — read ONCE here (mount
      // is a framing-time event), never reactively. Y is untouched (#47 vertical invariance).
      const k = cropFollowScale();
      const px = CITY_CENTER.x + (DEFAULT_INTENT.position[0] - CITY_CENTER.x) * k;
      const py = DEFAULT_INTENT.position[1];
      const pz = CITY_CENTER.z + (DEFAULT_INTENT.position[2] - CITY_CENTER.z) * k;
      const tx = CITY_CENTER.x + (DEFAULT_INTENT.lookAt[0] - CITY_CENTER.x) * k;
      const ty = DEFAULT_INTENT.lookAt[1];
      const tz = CITY_CENTER.z + (DEFAULT_INTENT.lookAt[2] - CITY_CENTER.z) * k;
      void c.setLookAt(px, py, pz, tx, ty, tz, false);
      // Ortho continuity: if we boot in ortho, match orthoSize to this pose's framing so the faked-
      // ortho render shows the same content the perspective pose would (no zoom mismatch on entry).
      const st = useSceneStore.getState();
      if (st.projection === "orthographic") {
        const dist = Math.hypot(px - tx, py - ty, pz - tz);
        const half = dist * Math.tan((st.cameraIntent.fov * DEG) / 2);
        st.setOrthoSize(THREE.MathUtils.clamp(half, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX));
      }
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
    // Touch is hand-rolled in v3 (behaviour 4) — native actions off so the custom
    // gestures below fully own it (v2 left one=TRUCK / two=ZOOM_ROTATE on; on phones
    // 1-finger-pan reads wrong-way-round and there's no orbit at all).
    c.touches.one = A.NONE;
    c.touches.two = A.NONE;
    c.touches.three = A.NONE;
  }, []);

  // Distance bounds (the user range slider) — applied live; clamp the current distance in on change.
  // `mode` is a dep on purpose: the CameraControls instance only exists while this model drives
  // orbit. Mounting in another mode (a ?cam= still link, fly, capture) left this effect's early
  // return permanent — camera-controls kept its default maxDistance of INFINITY, so wheel-out
  // compounded forever and the city receded past the far plane (user 2026-07-16).
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const lo = Math.max(1, bounds.minDist);
    const hi = Math.max(lo + 1, bounds.maxDist);
    c.minDistance = lo;
    c.maxDistance = hi;
    void c.dollyTo(THREE.MathUtils.clamp(c.distance, lo, hi), false);
  }, [bounds, mode]);

  // `t` — the top-down FLIGHT (behaviour 1; see the module doc). Registered on the
  // shared command channel while this model drives orbit; cameraView.toggleTopDown
  // dispatches here instead of swapping to the Top-Down model, so top-down is a pose
  // this camera flies to, with every control still live. The state machine is just
  // tdReturn: null = normal; set = "in top-down, this is the banked return pose".
  useEffect(() => {
    if (mode !== "orbit") return;
    const flyOverhead = (c: CameraControlsImpl) => {
      const s = useSceneStore.getState();
      const dom = gl.domElement;
      const aspect = dom.clientWidth / Math.max(1, dom.clientHeight);
      const tier =
        displayedRadius(
          resolveCityShape(s.cityShape, s.masterSeed),
          s.cityShapeScale,
          CITY_TIERS[s.citySize],
        ) + GROUND_APRON_M;
      // Whole-city plan framing — the same fit the Top-Down model uses (fit the limiting
      // screen axis + margin; clip-safe perspective height from the same extent).
      const fitOrtho = (tier * TOP_DOWN_MARGIN) / Math.min(1, aspect);
      const tan = Math.tan((s.cameraIntent.fov * DEG) / 2) || 0.2217;
      const height = Math.min(10000 * CITY_SCALE, Math.max(50 * CITY_SCALE, fitOrtho / tan));
      // rotateTo with the CURRENT (unbounded) azimuthAngle = ZERO azimuth motion, a pure
      // gimbal dive — and the heading survives to the pole (TD_POLAR keeps it defined).
      flyPose(c, CITY_CENTER.x, 0, CITY_CENTER.z, c.azimuthAngle, TD_POLAR, height, fitOrtho);
    };
    // Smooth pose flight shared by the dive and the return, DECOMPOSED into moveTo /
    // rotateTo / dollyTo rather than setLookAt: setLookAt tweens the spherical theta
    // NUMERICALLY from the drag-accumulated current value to atan2's normalized (-pi,
    // pi] one, so after some orbiting the flight revolves the camera the long way round
    // (test round 1.1 — the same lesson as the v2 focus glide / R reset). Callers pass a
    // theta already unwrapped to the winding nearest the current azimuth. Runs at a
    // temporarily slower smoothTime (the focus glide's save/restore pattern), plus the
    // ortho zoom ramp — in ortho apparent size is orthoSize, so the flight's "zoom" is
    // that ramp.
    const flyPose = (
      c: CameraControlsImpl,
      tx: number,
      ty: number,
      tz: number,
      theta: number,
      polar: number,
      dist: number,
      orthoSize: number,
    ) => {
      const s = useSceneStore.getState();
      if (baseSmoothTime.current === null) baseSmoothTime.current = c.smoothTime;
      const base = baseSmoothTime.current;
      c.smoothTime = TD_SMOOTH_TIME;
      void Promise.all([
        c.moveTo(tx, ty, tz, true),
        c.rotateTo(theta, polar, true),
        c.dollyTo(dist, true),
      ]).finally(() => {
        c.smoothTime = base;
      });
      if (s.projection === "orthographic") {
        orthoFocusStart.current = s.orthoSize;
        orthoFocusT.current = 0;
        orthoFocusDur.current = ORTHO_FOCUS_DURATION;
        orthoFocusTarget.current = THREE.MathUtils.clamp(orthoSize, ORTHO_SIZE_MIN, ORTHO_SIZE_MAX);
      }
    };
    cameraCommand.toggleTopDownInModel = () => {
      const c = controls.current;
      if (!c) return false; // not driving — fall through to the model-swap path
      markInput();
      c.getPosition(_eye);
      c.getTarget(_tgt);
      if (!tdReturn.current) {
        // ENTER: bank the return pose, dive overhead.
        tdReturn.current = {
          eye: _eye.clone(),
          tgt: _tgt.clone(),
          orthoSize: useSceneStore.getState().orthoSize,
        };
        flyOverhead(c);
        return true;
      }
      // IN top-down already. Manually tilted away from overhead? Re-square instead of
      // returning (the banked pose stays for the next `t`). Pan/zoom/WASD hold the
      // elevation at ~90°, so they don't count as leaving.
      const d = _eye.distanceTo(_tgt) || 1e-3;
      const elevDeg = Math.asin(THREE.MathUtils.clamp((_eye.y - _tgt.y) / d, -1, 1)) / DEG;
      if (elevDeg < TD_STILL_ELEV_DEG) {
        flyOverhead(c);
        return true;
      }
      // RETURN: fly back to the banked pose — as spherical-about-target so the azimuth
      // leg can be unwrapped to the winding nearest the current heading (short way).
      const r = tdReturn.current;
      tdReturn.current = null;
      const rdx = r.eye.x - r.tgt.x;
      const rdy = r.eye.y - r.tgt.y;
      const rdz = r.eye.z - r.tgt.z;
      const rr = Math.hypot(rdx, rdy, rdz) || 1e-3;
      const theta0 = Math.atan2(rdx, rdz);
      const TWO_PI = Math.PI * 2;
      const nearTheta = theta0 + Math.round((c.azimuthAngle - theta0) / TWO_PI) * TWO_PI;
      const polar = Math.acos(THREE.MathUtils.clamp(rdy / rr, -1, 1));
      flyPose(c, r.tgt.x, r.tgt.y, r.tgt.z, nearTheta, polar, rr, r.orthoSize);
      return true;
    };
    // Projection toggles must not dolly while v3 parks a pose the radius slide would
    // fight: the in-model top-down (pinned overhead, K-matched radius) and an in-flight
    // idle drift (which re-writes the pose per frame). Same #84 rule the Top-Down MODEL
    // gets from its cameraModel check — v3 signals it here instead (5.32).
    cameraCommand.projectionRadiusHold = () => tdReturn.current !== null || driftOn.current;
    // The drift transport (Space / helicopter button / Orbit header): three-way.
    // Drift mode ON → off, hold the pose. Mode OFF but an IDLE flight is up → stop
    // that flight + restart the idle timer (pressing "stop" during an idle drift must
    // not flip the mode on). Otherwise → mode ON (immediate ramped takeoff, handled by
    // the useFrame edge).
    cameraCommand.toggleDrift = () => {
      const s = useSceneStore.getState();
      if (s.driftMode) {
        s.setDriftMode(false);
      } else if (driftOn.current) {
        driftOn.current = false;
        lastInput.current = clockNow.current;
        s.setDriftFlying(false);
      } else {
        s.setDriftMode(true);
      }
    };
    // The compass rose's click affordance (#95): spin the azimuth to north-up (theta =
    // 180deg, i.e. the eye south of target looking north — see TopDownCompassRose's
    // bearing math), the shortest way round, keeping elevation/target/distance exactly
    // where top-down parked them. A pure rotateTo, same decomposed-tween shape as the
    // dive/return above (never setLookAt's numeric theta tween, which can go the long
    // way after some orbiting).
    cameraCommand.rotateNorthUp = () => {
      const c2 = controls.current;
      if (!c2) return;
      markInput();
      const TWO_PI = Math.PI * 2;
      const theta0 = Math.PI; // azimuthDeg 180
      const nearTheta = theta0 + Math.round((c2.azimuthAngle - theta0) / TWO_PI) * TWO_PI;
      void c2.rotateTo(nearTheta, c2.polarAngle, true);
    };
    return () => {
      cameraCommand.toggleTopDownInModel = null;
      cameraCommand.projectionRadiusHold = null;
      cameraCommand.toggleDrift = null;
      cameraCommand.rotateNorthUp = null;
    };
  }, [mode, gl, markInput]);

  // Custom mouse gestures (guarded to pointerType "mouse"; touch uses the native actions above).
  useEffect(() => {
    const dom = gl.domElement;
    let drag: "pan" | "orbit" | "look" | null = null;
    let lastX = 0;
    let lastY = 0;
    let ctrlHeld = false;
    let shiftHeld = false;
    // Deferred drag affordances: on press we record the down point and mark the drag "not yet moved";
    // the grabbing cursor and the orbit pivot pin appear only once the pointer crosses a small
    // threshold, so a click or double-click (zoom-in) never flashes them. Reset on release.
    let dragMoved = false;
    let dragDownX = 0;
    let dragDownY = 0;
    let orbitPinPending: { pos: [number, number, number]; kind: "orbit" | "cone" } | null = null;
    let hoverX = 0; // last mouse position over the canvas — anchors the armed-modifier glyph
    let hoverY = 0;
    let overCanvas = false;

    // Drag affordance glyph shown ALONGSIDE the hand cursor: a lucide eye (free-look) / move (move),
    // as a fixed DOM overlay offset down-right of the pointer, updated in the pointer handlers. It
    // rides next to the OS cursor rather than replacing it — the cursor stays browser-standard.
    const EYE_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
    const MOVE_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/></svg>';
    // Up/down arrows (lucide move-vertical): shown for the move gesture in Skyline Mode, where a
    // vertical RMB / Shift+LMB drag reframes the city up/down (a pure vertical move), not a free
    // ground pan — so the 4-way move glyph would misread the affordance.
    const MOVE_V_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m8 6 4-4 4 4"/><path d="m8 18 4 4 4-4"/></svg>';
    const glyph = document.createElement("div");
    glyph.setAttribute("aria-hidden", "true");
    glyph.style.cssText =
      "position:fixed;left:0;top:0;z-index:9999;pointer-events:none;display:none;color:#7dd3fc;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.85))";
    document.body.appendChild(glyph);
    let glyphKind: "look" | "pan" | "pan-v" | null = null; // current SVG — reset innerHTML only when it changes
    const moveGlyph = (x: number, y: number) => {
      glyph.style.transform = `translate3d(${x + 16}px, ${y + 14}px, 0)`; // just down-right of the cursor
    };
    const showGlyph = (kind: "look" | "pan" | "pan-v", x: number, y: number) => {
      if (glyphKind !== kind) {
        glyph.innerHTML = kind === "look" ? EYE_SVG : kind === "pan-v" ? MOVE_V_SVG : MOVE_SVG;
        glyphKind = kind;
      }
      glyph.style.display = "block";
      moveGlyph(x, y);
    };
    const hideGlyph = () => {
      glyph.style.display = "none";
    };
    // While a modifier arms a gesture but no button is down, ride its affordance glyph next to the
    // cursor — mirroring the mouse-down options: Ctrl/⌘ = free-look (eye), Shift = move (move). A drag
    // owns the glyph; off-canvas or unmodified, nothing shows.
    const applyModifierGlyph = () => {
      if (drag) return;
      if (overCanvas && ctrlHeld) showGlyph("look", hoverX, hoverY);
      else if (overCanvas && shiftHeld) showGlyph(isSkylineMode(cam) ? "pan-v" : "pan", hoverX, hoverY);
      else hideGlyph();
    };

    // Cursor: browser-standard hand — grabbing (closed) while moving / free-looking, grab (open) while
    // Ctrl/⌘ is armed pre-drag; default otherwise. The eye / move glyph rides alongside (above).
    const applyCursor = () => {
      dom.style.cursor =
        drag && dragMoved
          ? "grabbing" // closed hand only once a drag is actually under way (not on bare press)
          : shiftHeld || ctrlHeld
            ? "grab" // open hand: a modified drag is armed (Shift = move, Ctrl/⌘ = free-look)
            : "pointer"; // default affordance: pointer finger
    };
    // R: reset to the default camera pose + projection + fov (the old double-click "home"), tweened.
    const resetToDefault = () => {
      const c = controls.current;
      if (!c) return;
      markInput();
      tdReturn.current = null; // R lands home — a banked top-down return pose is stale now
      const s = useSceneStore.getState();
      if (s.projection !== DEFAULT_PROJECTION) tweenProjectionTo(DEFAULT_PROJECTION); // default mode
      if (s.cameraIntent.fov !== DEFAULT_INTENT.fov) s.setCameraIntent({ fov: DEFAULT_INTENT.fov });
      drag = null;
      setPin(null);
      hideGlyph();
      // #56 crop-follow: same horizontal-only, CITY_CENTER-relative scale as the mount
      // effect above — Reset is a resting-pose framing event too, read once here.
      const k = cropFollowScale();
      const px = CITY_CENTER.x + (DEFAULT_INTENT.position[0] - CITY_CENTER.x) * k;
      const py = DEFAULT_INTENT.position[1];
      const pz = CITY_CENTER.z + (DEFAULT_INTENT.position[2] - CITY_CENTER.z) * k;
      const tx = CITY_CENTER.x + (DEFAULT_INTENT.lookAt[0] - CITY_CENTER.x) * k;
      const ty = DEFAULT_INTENT.lookAt[1];
      const tz = CITY_CENTER.z + (DEFAULT_INTENT.lookAt[2] - CITY_CENTER.z) * k;
      // setLookAt would tween the azimuth numerically from the CURRENT theta
      // (unbounded — drag accumulates whole turns) to atan2's (-pi, pi] home
      // value, which often reads as the camera revolving the long way round.
      // Rebuild the same transition from moveTo/rotateTo/dollyTo with the home
      // azimuth unwrapped to the winding nearest the current one, so R always
      // takes the short arc.
      _e2.set(px - tx, py - ty, pz - tz);
      const homeRadius = _e2.length();
      const homeTheta = Math.atan2(_e2.x, _e2.z);
      const homePhi = Math.acos(THREE.MathUtils.clamp(_e2.y / homeRadius, -1, 1));
      const TWO_PI = Math.PI * 2;
      const nearTheta = homeTheta + Math.round((c.azimuthAngle - homeTheta) / TWO_PI) * TWO_PI;
      // Smooth return to the hero pose, short way round. Keep the guide's
      // "Reset Camera" row lit for the whole flight: the transitions resolve
      // on rest, so pulse the activity signal until then (the guide clears
      // ~260ms after the last mark).
      const settled = Promise.all([
        c.moveTo(tx, ty, tz, true),
        c.rotateTo(nearTheta, homePhi, true),
        c.dollyTo(homeRadius, true),
      ]);
      let resetting = true;
      void settled.finally(() => (resetting = false));
      const pulse = () => {
        if (!resetting) return;
        markCameraActivity("reset");
        requestAnimationFrame(pulse);
      };
      pulse();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // WASD/QE fly-through — track by e.code (Shift flips e.key case, which would
      // strand held movement); consumed in the useFrame loop below.
      if (MOVE_CODES.has(e.code) && !isTypingTarget(e)) {
        moveKeys.current[e.code] = true;
        markInput();
        return;
      }
      if (e.key === "Control" || e.key === "Meta") {
        ctrlHeld = true;
        applyCursor();
        applyModifierGlyph();
        return;
      }
      if (e.key === "Shift") {
        shiftHeld = true;
        applyCursor();
        applyModifierGlyph();
        return;
      }
      if (
        e.key?.toLowerCase() === "r" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isTypingTarget(e)
      ) {
        resetToDefault();
      }
      // Space = the drift transport (rounds 7–8): the shared three-way toggle — see
      // cameraCommand.toggleDrift (registered above; the helicopter button and the
      // Orbit header transport dispatch there too). NOTE: no markInput() here — a
      // commanded takeoff must not re-arm the very timer it bypasses.
      if (e.code === "Space" && !e.repeat && !isTypingTarget(e)) {
        e.preventDefault(); // keep the page from scrolling
        cameraCommand.toggleDrift?.();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (MOVE_CODES.has(e.code)) moveKeys.current[e.code] = false;
      if (e.key === "Control" || e.key === "Meta") {
        ctrlHeld = false;
        applyCursor();
        applyModifierGlyph();
      } else if (e.key === "Shift") {
        shiftHeld = false;
        applyCursor();
        applyModifierGlyph();
      }
    };

    // Engage free-look: grab the map point under the cursor (or a point along the ray at the focal
    // distance if the cursor is on the sky), then swing the view (onMove) so it stays under the cursor.
    const engageLook = (clientX: number, clientY: number) => {
      const c = controls.current;
      if (!c) return;
      drag = "look";
      setPin(null);
      const hit = groundHit(cam, dom, clientX, clientY, _cur);
      c.getPosition(_eye);
      c.getTarget(_tgt);
      const d = _eye.distanceTo(_tgt);
      if (hit) grabP.current.copy(_cur);
      else grabP.current.copy(_eye).addScaledVector(_ray.ray.direction, d);
      showGlyph("look", clientX, clientY);
    };

    // Arm an orbit + tilt gesture around the point under (clientX, clientY) — shared by
    // bare-LMB (mouse) and the 1-finger touch gesture. Sets the pivot (_grab), the
    // deferred pivot pin, and seeds the carried tilt axis.
    const armOrbit = (clientX: number, clientY: number) => {
      const c = controls.current;
      if (!c) return;
      drag = "orbit";
      hideGlyph(); // orbit uses the pin marker, not a cursor glyph
      const st = useSceneStore.getState();
      // Focus-lock pivots: inspect keeps v2's rule (focused building's centre); cone
      // view extends it — the multi-arc centroid showLocations parked in focusPivot is
      // the pivot even OUTSIDE inspect mode, so orbiting keeps every arc in view.
      const fp = st.inspectMode || st.coneFollow ? st.focusPivot : null;
      if (fp) {
        // Inspect focus-lock: while a building is FOCUSED, orbit around its 3D centre
        // rather than the ground point under the cursor — so LMB-drag keeps circling
        // the building the double-click framed, at any height. A focused BUILDING
        // already wears its selection MapPin (BuildingPin, above the roof) — no
        // transient pin. The CONE pivot is a bare point in space (the arcs' centre),
        // so it DOES get a marker: the pin + cone glyph, raised for the drag.
        _grab.set(fp[0], fp[1], fp[2]);
        orbitPinPending = st.coneFollow ? { pos: [fp[0], fp[1], fp[2]], kind: "cone" } : null;
      } else if (groundHit(cam, dom, clientX, clientY, _cur)) {
        // Pivot must lie within the ground disc — a click near the horizon hits the (infinite)
        // ground plane far off the map, so clamp it to the disc edge; we never orbit around a
        // point outside the city's ground.
        const cl = clampToCity(_cur.x, _cur.z);
        _grab.set(cl.x, 0, cl.z); // reuse _grab as the orbit pivot for the gesture
        orbitPinPending = { pos: [cl.x, 0, cl.z], kind: "orbit" }; // shown once the drag begins (see onMove)
      } else {
        // No ground hit (aimed at the sky) — orbit the current target, kept within the disc.
        c.getTarget(_grab);
        const cl = clampToCity(_grab.x, _grab.z);
        _grab.set(cl.x, _grab.y, cl.z);
        orbitPinPending = null;
      }
      setPin(null); // no pin until the drag begins
      // Seed the carried tilt axis from the current view heading (kept valid through the pole).
      c.getPosition(_eye);
      c.getTarget(_tgt);
      _dir.subVectors(_tgt, _eye);
      const h = Math.hypot(_dir.x, _dir.z);
      if (h > 1e-3) orbitAxis.current.set(-_dir.z, 0, _dir.x).multiplyScalar(1 / h);
    };

    // Pointer capture, throw-safe: set/releasePointerCapture throw NotFoundError for a
    // pointer the browser doesn't consider active (synthetic events — the CDP test
    // harness — and some cancelled-touch races). A throw mid-handler strands the whole
    // gesture state, so both are wrapped; losing capture degrades to element-local
    // events, never to a broken gesture.
    const capturePointer = (id: number) => {
      try {
        dom.setPointerCapture?.(id);
      } catch {
        /* inactive/synthetic pointer — proceed uncaptured */
      }
    };
    const releasePointer = (id: number) => {
      try {
        dom.releasePointerCapture?.(id);
      } catch {
        /* ditto */
      }
    };

    // ---- Touch (behaviour 4): 1-finger orbit + tilt · 2-finger pan + pinch-zoom ·
    // double-tap zoom-in. Hand-rolled on pointer events (native camera-controls touch is
    // off) so the math, pivots, and clamps are EXACTLY the mouse gestures'. Twist-rotate
    // and 3-finger free-look are deliberately out of the first pass.
    const touchPts = new Map<number, { x: number; y: number }>();
    let twoFinger = false; // the 2-finger pan+pinch owns the gesture (drag stays null)
    let touchDownT = 0; // first-finger-down e.timeStamp (tap detection)
    let lastTapT = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const onTouchDown = (e: PointerEvent) => {
      const c = controls.current;
      if (!c) return;
      markInput();
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capturePointer(e.pointerId);
      if (touchPts.size === 1) {
        touchDownT = e.timeStamp;
        lastX = e.clientX;
        lastY = e.clientY;
        dragDownX = e.clientX;
        dragDownY = e.clientY;
        dragMoved = false;
        twoFinger = false;
        armOrbit(e.clientX, e.clientY);
      } else if (touchPts.size === 2) {
        // Second finger down: the gesture becomes pan + pinch; the orbit stands down.
        drag = null;
        setPin(null);
        orbitPinPending = null;
        twoFinger = true;
      } else {
        // 3+ fingers: stand down entirely (no free-look on touch in this pass).
        drag = null;
        setPin(null);
        twoFinger = false;
      }
    };

    // Returns true when the event was consumed (2-finger gesture / stray pointer);
    // false lets a 1-finger move fall through to the shared orbit math in onMove.
    const onTouchMove = (e: PointerEvent): boolean => {
      const c = controls.current;
      const entry = touchPts.get(e.pointerId);
      if (!c || !entry) return true;
      markInput();
      if (twoFinger && touchPts.size >= 2) {
        const pts = [...touchPts.values()];
        const beforeMidX = (pts[0].x + pts[1].x) / 2;
        const beforeMidY = (pts[0].y + pts[1].y) / 2;
        const beforeDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        entry.x = e.clientX;
        entry.y = e.clientY;
        const pts2 = [...touchPts.values()];
        const midX = (pts2[0].x + pts2[1].x) / 2;
        const midY = (pts2[0].y + pts2[1].y) / 2;
        const afterDist = Math.hypot(pts2[0].x - pts2[1].x, pts2[0].y - pts2[1].y) || 1;
        // PAN: ground-anchored midpoint, the mouse pan's incremental prev→curr delta.
        // RIGID in both projections (the perspective snow-globe eye-backout stays a
        // desktop nicety) — focal clamped to the ground disc, eye moved by the same delta.
        markCameraActivity("pan");
        if (
          groundHit(cam, dom, beforeMidX, beforeMidY, _grab) &&
          groundHit(cam, dom, midX, midY, _cur)
        ) {
          _delta.subVectors(_grab, _cur);
          c.getPosition(_eye);
          c.getTarget(_tgt);
          const groundR = CITY_TIERS[useSceneStore.getState().citySize] + GROUND_APRON_M;
          const cl = clampToDisc(_tgt.x + _delta.x, _tgt.z + _delta.z, groundR, _panFocal);
          const adx = cl.x - _tgt.x;
          const adz = cl.z - _tgt.z;
          void c.setLookAt(_eye.x + adx, _eye.y, _eye.z + adz, cl.x, _tgt.y, cl.z, false);
        }
        // PINCH: zoom toward the midpoint (spread = in). zoomAtCursor bridges both
        // projections (perspective dollies about the ground point; ortho scales + re-pins).
        const k = beforeDist / afterDist;
        if (Math.abs(k - 1) > 0.001) {
          markCameraActivity("zoom");
          zoomAtCursor(c, cam, dom, midX, midY, k, false);
        }
        return true;
      }
      entry.x = e.clientX;
      entry.y = e.clientY;
      return false; // 1-finger: the shared orbit path below handles it
    };

    const onTouchUp = (e: PointerEvent) => {
      markInput();
      touchPts.delete(e.pointerId);
      releasePointer(e.pointerId);
      if (twoFinger) {
        if (touchPts.size === 1) {
          // One finger stays down: hand the gesture back to a re-anchored orbit.
          twoFinger = false;
          const p = [...touchPts.values()][0];
          lastX = p.x;
          lastY = p.y;
          dragDownX = p.x;
          dragDownY = p.y;
          dragMoved = false;
          armOrbit(p.x, p.y);
        } else if (touchPts.size === 0) {
          twoFinger = false;
        }
        return;
      }
      if (touchPts.size === 0) {
        // TAP: released quickly without a real drag. Two of them close together =
        // double-tap zoom-in (mirrors double-click, and the same inspect-mode guard:
        // there a double-tap is the building-focus gesture, so the zoom stands down).
        const wasTap = !dragMoved && e.timeStamp - touchDownT < TOUCH_TAP_MAX_MS;
        if (wasTap) {
          if (
            e.timeStamp - lastTapT < TOUCH_DOUBLE_TAP_MS &&
            Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < TOUCH_DOUBLE_TAP_PX
          ) {
            lastTapT = 0; // consumed — a third tap starts a fresh pair
            if (!useSceneStore.getState().inspectMode)
              glideZoomIn(e.clientX, e.clientY, e.timeStamp);
          } else {
            lastTapT = e.timeStamp;
            lastTapX = e.clientX;
            lastTapY = e.clientY;
          }
        }
        if (drag === "orbit") setPin(null);
        orbitPinPending = null;
        dragMoved = false;
        drag = null;
      }
    };

    const onDown = (e: PointerEvent) => {
      const c = controls.current;
      if (!c) return;
      if (e.pointerType !== "mouse") {
        onTouchDown(e);
        return;
      }
      if (e.button !== 0 && e.button !== 2) return; // LMB or RMB only
      markInput();
      lastX = e.clientX;
      lastY = e.clientY;
      dragDownX = e.clientX;
      dragDownY = e.clientY;
      dragMoved = false;
      if ((e.button === 0 && (e.ctrlKey || e.metaKey)) || (e.buttons & 0b11) === 0b11) {
        // Free-look: Ctrl/⌘ + LMB, OR the LMB+RMB chord (both buttons down).
        engageLook(e.clientX, e.clientY);
      } else if (e.button === 2 || e.shiftKey) {
        // Move (RMB or Shift+LMB): grab the ground point under the cursor; keep it under the cursor.
        drag = "pan";
        setPin(null);
        if (!groundHit(cam, dom, e.clientX, e.clientY, _grab)) drag = null;
        else showGlyph(isSkylineMode(cam) ? "pan-v" : "pan", e.clientX, e.clientY);
      } else {
        // Orbit + tilt (bare LMB) around the clicked ground point. The pin marking the pivot is
        // DEFERRED: captured here, revealed in onMove only once the drag actually moves — so a single
        // click or a double-click (zoom-in) never flashes it. The view rotates around it, no re-centre.
        armOrbit(e.clientX, e.clientY);
      }
      if (drag) capturePointer(e.pointerId);
      applyCursor();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") {
        if (onTouchMove(e)) return; // 2-finger pan + pinch consumed it; 1-finger falls through
      } else {
        hoverX = e.clientX;
        hoverY = e.clientY;
        overCanvas = true;
      }
      const c = controls.current;
      if (!c || !drag) {
        if (e.pointerType === "mouse") applyModifierGlyph(); // armed-modifier glyph rides the cursor
        return;
      }
      markInput(); // an active drag is live input — hold the idle drift off
      // LMB+RMB chord → free-look, even if the second button arrives after the first (some browsers
      // report it as a move with buttons updated rather than a fresh pointerdown).
      if (drag !== "look" && (e.buttons & 0b11) === 0b11) {
        engageLook(e.clientX, e.clientY);
        applyCursor();
      }
      // Promote to a "real" drag once the pointer crosses a small jitter threshold: only THEN does the
      // grabbing cursor (and the orbit pivot pin) appear — a click / double-click never gets here.
      if (!dragMoved && Math.abs(e.clientX - dragDownX) + Math.abs(e.clientY - dragDownY) > 3) {
        dragMoved = true;
        applyCursor();
      }
      if (drag === "look" || drag === "pan") moveGlyph(e.clientX, e.clientY);
      markCameraActivity(drag === "orbit" ? "rotate" : drag === "pan" ? "pan" : "look");
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (drag === "pan") {
        const st = useSceneStore.getState();
        // PERSPECTIVE SKYLINE reframe ("reframing the camera"): RMB is a pure translation of the COUPLED
        // rig — vertical drag pedestals the eye AND focal together (an altitude move, floored at
        // MIN_EYE_Y so it never sinks below ~1m); horizontal drag trucks laterally. No tilt change (that
        // is LMB) and no lens-shift — camera and focal move as one, reframing the city in the window.
        // Drag DOWN pulls the world down (grab metaphor) so the eye rises; drag UP lowers you toward
        // street level (removing the empty foreground). Ortho keeps its focal-offset lens-shift below.
        if (isSkylineMode(cam) && st.projection === "perspective") {
          c.getPosition(_eye);
          c.getTarget(_tgt);
          const rect = dom.getBoundingClientRect();
          const pc = cam as THREE.PerspectiveCamera;
          const halfH = _eye.distanceTo(_tgt) * Math.tan((pc.fov * DEG) / 2); // focal-plane half-height
          const wantY = _eye.y + (dy / Math.max(1, rect.height)) * 2 * halfH; // drag down → rise
          const eyeY = Math.max(MIN_EYE_Y, wantY);
          const upDY = eyeY - _eye.y; // applied (floored) vertical shift, shared by eye + focal
          // Lateral truck: the synth ground pick ignores screen-Y when flat, so prev→curr is dx only.
          let latX = 0;
          let latZ = 0;
          if (
            groundHit(cam, dom, e.clientX - dx, e.clientY - dy, _grab) &&
            groundHit(cam, dom, e.clientX, e.clientY, _cur)
          ) {
            _delta.subVectors(_grab, _cur);
            const cl = clampToCity(_tgt.x + _delta.x, _tgt.z + _delta.z);
            latX = cl.x - _tgt.x;
            latZ = cl.z - _tgt.z;
          }
          void c.setLookAt(
            _eye.x + latX,
            eyeY,
            _eye.z + latZ,
            _tgt.x + latX,
            _tgt.y + upDY,
            _tgt.z + latZ,
            false,
          );
          return;
        }
        // ORTHO SKYLINE: vertical drag reframes via the Screen-Y focal-offset lens-shift (applied per-
        // frame in useFrame); horizontal drag pans laterally below. Ortho ignores the eye's along-view
        // position, so a lens-shift reads identically to a camera move — and keeps the full range.
        if (isSkylineMode(cam)) {
          const h = Math.max(1, dom.getBoundingClientRect().height);
          skylineScreenY.current = THREE.MathUtils.clamp(
            skylineScreenY.current - dy / h,
            SKYLINE_SCREEN_Y_MIN,
            SKYLINE_SCREEN_Y_MAX,
          );
        }
        // INCREMENTAL ground-anchored pan: shift eye + focal by the ground delta between the PREVIOUS
        // and CURRENT cursor. The FOCAL clamps to the ground disc (the practical grab limit — the aim
        // stays on the ground); the EYE is decoupled and clamps INDEPENDENTLY to a larger disc
        // (PAN_EYE_REACH_MULT × the ground radius), so backing the camera up past the ground's edge
        // pulls it back to view the "snow globe" from outside instead of dead-stopping (both used to
        // shift by the SAME clamped delta, so the whole rig hit an invisible wall the instant the focal
        // reached the rim). When neither clamp engages this is identical to before: eye and focal both
        // shift by the full raw delta, so the grabbed point stays glued under the cursor. Incremental
        // (vs a fixed grab anchor) so the disc clamps engage gracefully at the boundary — no accumulated
        // dead-zone where the cursor moves but the rig sticks.
        if (
          !groundHit(cam, dom, e.clientX - dx, e.clientY - dy, _grab) ||
          !groundHit(cam, dom, e.clientX, e.clientY, _cur)
        )
          return;
        _delta.subVectors(_grab, _cur); // prev→curr ground delta (horizontal)
        c.getPosition(_eye);
        c.getTarget(_tgt);
        const groundR = CITY_TIERS[useSceneStore.getState().citySize] + GROUND_APRON_M;
        const cl = clampToDisc(_tgt.x + _delta.x, _tgt.z + _delta.z, groundR, _panFocal);
        if (useSceneStore.getState().projection === "orthographic") {
          // Ortho: keep the pan RIGID — shift the eye by the SAME clamped delta as the focal. The
          // eye is only a parallel-projection park value here, so decoupling it (backing it out to
          // the larger disc) would swing the eye->focal DIRECTION and tilt the view instead of doing
          // anything useful. Just stop at the ground edge.
          const adx = cl.x - _tgt.x;
          const adz = cl.z - _tgt.z;
          void c.setLookAt(_eye.x + adx, _eye.y, _eye.z + adz, cl.x, _tgt.y, cl.z, false);
        } else {
          // Perspective: decouple — the eye may back out past the ground disc (to
          // PAN_EYE_REACH_MULT × the radius) to view the "snow globe" from outside, focal pinned.
          // The reach grows with the current eye↔focal horizontal offset so a zoomed-out camera
          // never pins on its ring while the focal still moves (3.21).
          const eyeReach = Math.max(
            groundR * PAN_EYE_REACH_MULT,
            groundR + Math.hypot(_eye.x - _tgt.x, _eye.z - _tgt.z),
          );
          const ce = clampToDisc(_eye.x + _delta.x, _eye.z + _delta.z, eyeReach, _panEye);
          void c.setLookAt(ce.x, _eye.y, ce.z, cl.x, _tgt.y, cl.z, false);
        }
      } else if (drag === "orbit") {
        // Reveal the pivot pin the moment the drag becomes "real" (same threshold as the cursor) — a
        // click or double-click never moves far enough, so the pin never flashes on a zoom-in.
        if (orbitPinPending && dragMoved) {
          setPin(orbitPinPending);
          orbitPinPending = null;
        }
        // Rotate BOTH eye and target around the pivot _grab, so the pivot's screen position holds
        // (no re-centre). Yaw around world-up (stable at any tilt). Tilt around a CARRIED horizontal
        // axis (kept valid through the pole).
        c.getPosition(_eye);
        c.getTarget(_tgt);
        const cfg = useSceneStore.getState().snv3;
        const orbitRate = ORBIT_RATE * cfg.orbitSpeed;
        _q.setFromAxisAngle(_UP, -dx * orbitRate);
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
        const desired = lookDown + dy * orbitRate; // drag down tilts toward straight-down
        // Cap at straight-down; in PERSPECTIVE floor at the user's Min tilt (default 0° = level → no
        // looking up; negative lets the camera drop into a low, upward vantage). ORTHO is hard-capped
        // at 0° (parallel to ground) — never looks up (that would show the ground's underside).
        const floor =
          useSceneStore.getState().projection === "perspective" ? cfg.tiltFloorDeg * DEG : 0;
        const applied = lookDown - THREE.MathUtils.clamp(desired, floor, MAX_ORBIT_EL);
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
        // Cap how far up the aim may go. PERSPECTIVE honours the user's Min tilt (0° = no looking up;
        // negative lets it look up from a low vantage). ORTHO is hard-capped at 0° (parallel to ground)
        // — never looks up (that would show the ground's underside).
        const maxUpY = st.projection === "perspective" ? -Math.sin(st.snv3.tiltFloorDeg * DEG) : 0;
        if (_look.y > maxUpY) {
          _look.y = maxUpY;
          if (_look.lengthSq() > 1e-9) _look.normalize();
        }
        if (Math.abs(_look.y) < MAX_VERT) _dir.copy(_look);
        void c.setTarget(_eye.x + _dir.x * d, _eye.y + _dir.y * d, _eye.z + _dir.z * d, false);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") {
        onTouchUp(e);
        return;
      }
      markInput();
      if (drag === "orbit") setPin(null); // pin only lives for the duration of the orbit drag
      orbitPinPending = null;
      dragMoved = false;
      drag = null;
      releasePointer(e.pointerId);
      applyCursor(); // grabbing → grab (if a modifier is still held) → pointer
      applyModifierGlyph(); // keep the eye / move glyph if Ctrl / Shift is still held, else hide
    };

    // Double-tap / double-click zoom-in as a GLIDE (4.27): a slower smoothTime bracket
    // around the zoom transition, plus the eased ortho size ramp instead of the instant
    // set — a tween in both projections. Also stamps lastTapZoomT so the browser's
    // SYNTHESIZED dblclick after a touch double-tap can't fire the zoom a second time.
    let lastTapZoomT = 0;
    const glideZoomIn = (x: number, y: number, stamp: number) => {
      const c = controls.current;
      if (!c) return;
      lastTapZoomT = stamp;
      markCameraActivity("zoomIn"); // its own guide row (double-click), distinct from wheel Zoom
      if (baseSmoothTime.current === null) baseSmoothTime.current = c.smoothTime;
      const base = baseSmoothTime.current;
      c.smoothTime = TAP_ZOOM_SMOOTH_TIME;
      const p = zoomAtCursor(c, cam, dom, x, y, 0.6, true, (target) => {
        orthoFocusStart.current = useSceneStore.getState().orthoSize;
        orthoFocusT.current = 0;
        orthoFocusDur.current = TAP_ZOOM_ORTHO_SEC;
        orthoFocusTarget.current = target;
      });
      void Promise.resolve(p).finally(() => {
        c.smoothTime = base;
      });
    };

    // Double-click = zoom in toward the clicked point (~40% closer). Perspective: position-only (keeps
    // orientation, holds the point under the cursor). Ortho: scales orthoSize + re-pins. See zoomAtCursor.
    const onDbl = (e: MouseEvent) => {
      const c = controls.current;
      if (!c) return;
      if (e.timeStamp - lastTapZoomT < 700) return; // synthesized from a handled touch double-tap
      // In inspect mode a double-click is the building FOCUS gesture (InstancedCity handles it), so
      // the default zoom-to-cursor must NOT also fire — two camera tweens on one double-click fought
      // and read as a harsh snap. Outside inspect mode, double-click zooms as before.
      if (useSceneStore.getState().inspectMode) return;
      glideZoomIn(e.clientX, e.clientY, e.timeStamp);
      setPin(null);
    };

    // Wheel zoom — Google Earth's curve (a fixed ~5%/notch multiplicative step, applied instantly),
    // zooming toward the cursor in BOTH projections (perspective dollies about the ground point; ortho
    // scales orthoSize + re-pins). See zoomAtCursor.
    const onWheel = (e: WheelEvent) => {
      const c = controls.current;
      if (!c) return;
      markInput();
      orthoFocusTarget.current = null; // a manual zoom cancels an in-flight focus zoom
      e.preventDefault();
      markCameraActivity("zoom");
      const k = Math.pow(
        0.95,
        -e.deltaY * 0.01 * WHEEL_ZOOM_SPEED * useSceneStore.getState().snv3.zoomSpeed,
      );
      // smooth=true: each notch eases via camera-controls' damping rather than snapping —
      // successive notches chain from the in-flight pose, so fast scrolls stay fluid (5.30).
      void zoomAtCursor(c, cam, dom, e.clientX, e.clientY, k, true);
    };

    // Suppress the browser context menu so RMB-drag can pan.
    const onContext = (e: Event) => e.preventDefault();

    // Pointer left the canvas — drop the armed-modifier glyph (a drag keeps its own glyph via capture).
    const onLeave = () => {
      overCanvas = false;
      if (!drag) hideGlyph();
    };

    dom.style.cursor = "pointer"; // default affordance before any interaction
    const clearMoveKeys = () => (moveKeys.current = {}); // drop held keys if focus leaves the window
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearMoveKeys);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointercancel", onUp); // touch interrupted (browser gesture) — same teardown
    dom.addEventListener("dblclick", onDbl);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("contextmenu", onContext);
    dom.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearMoveKeys);
      moveKeys.current = {};
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointercancel", onUp);
      dom.removeEventListener("dblclick", onDbl);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("contextmenu", onContext);
      dom.removeEventListener("pointerleave", onLeave);
      dom.style.cursor = "";
      glyph.remove();
    };
  }, [gl, cam, markInput]);

  // Imperative tilt command (Camera panel → this model). Re-pitch to an absolute look-down angle,
  // keeping azimuth / distance / target, so the panel's "Tilt°" slider can set the pose the drag
  // produces. Clamped to the mode's tilt floor (perspective: Min tilt; ortho: 0 = no looking up).
  // The store's orbit.elevationDeg is updated in step so the slider tracks without waiting for the
  // ~10/s pose write-back. Registered while this model is mounted; cleared on unmount.
  useEffect(() => {
    cameraCommand.setTiltDeg = (deg: number, smooth: boolean) => {
      const c = controls.current;
      if (!c) return;
      c.getPosition(_eye);
      c.getTarget(_tgt);
      _dir.subVectors(_eye, _tgt); // eye offset from the target
      const R = _dir.length() || 1e-3;
      const az = Math.atan2(_dir.x, _dir.z); // preserve heading
      const st = useSceneStore.getState();
      const floorDeg = st.projection === "perspective" ? st.snv3.tiltFloorDeg : 0;
      const elDeg = THREE.MathUtils.clamp(deg, floorDeg, MAX_ORBIT_EL / DEG);
      const el = elDeg * DEG;
      const rh = R * Math.cos(el); // horizontal radius at the new elevation
      void c.setLookAt(
        _tgt.x + rh * Math.sin(az),
        _tgt.y + R * Math.sin(el),
        _tgt.z + rh * Math.cos(az),
        _tgt.x,
        _tgt.y,
        _tgt.z,
        smooth,
      );
      st.setOrbit({ elevationDeg: elDeg });
    };
    return () => {
      cameraCommand.setTiltDeg = null;
    };
  }, []);

  // ~10/s pose write-back so fog / moon-follow / panel readout track the live view.
  useFrame((state, delta) => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    // Mirror the R3F clock for the DOM handlers (markInput stamps lastInput in this
    // timebase), and seed lastInput on the first frame so the idle timer counts from
    // mount, not from the epoch.
    if (clockNow.current === 0) lastInput.current = state.clock.elapsedTime;
    clockNow.current = state.clock.elapsedTime;

    // Skyline framing — ORTHO ONLY (perspective reframes by physically moving the coupled rig; see the
    // pan handler). At full ortho the eye's along-view position is invisible, so a vertical focal-offset
    // lens-shift slides the city up/down on screen without re-aiming — the v2-local "Screen Y". Target =
    // the RMB-set rest point in Skyline, else 0 (centred); eased so entering/leaving glides. Gated on the
    // blend being full ortho (not just projection === ortho) so a mid-morph frame never pedestals a
    // still-perspective view. Doesn't touch the persisted Screen Y.
    const st = useSceneStore.getState();
    const pcam = state.camera as THREE.PerspectiveCamera;
    let targetOffY = 0;
    if (st.projectionBlend >= 0.9999 && isSkylineMode(pcam)) {
      const oeff = st.orthoSize * orbitFramingFactor(pcam.aspect);
      targetOffY = (skylineScreenY.current - 0.5) * 2 * oeff;
    }
    const curOffY = c.getFocalOffset(_focalOff).y;
    const nextOffY = curOffY + (targetOffY - curOffY) * 0.35;
    if (Math.abs(nextOffY - curOffY) > 0.5) c.setFocalOffset(0, nextOffY, 0, false);

    // Ortho focus zoom (#87): advance a slow-start smoothstep ramp on THIS frame
    // clock (the same one camera-controls' pan/dolly runs on). The flat start means
    // the size barely moves while the snappy pan zeroes in, then eases into the
    // target — position leads, zoom trails.
    if (orthoFocusTarget.current !== null) {
      orthoFocusT.current = Math.min(1, orthoFocusT.current + delta / orthoFocusDur.current);
      const e = ORTHO_FOCUS_EASE(orthoFocusT.current);
      st.setOrthoSize(orthoFocusStart.current + (orthoFocusTarget.current - orthoFocusStart.current) * e);
      if (orthoFocusT.current >= 1) orthoFocusTarget.current = null;
    }

    // WASD/QE fly-through (SNCv2): translate the whole rig across the ground plane
    // (WASD along the camera's HORIZONTAL heading, so it glides at any tilt) and
    // vertically (Q down / E up). Speed scales with altitude in perspective and with
    // orthoSize in ortho, so the on-screen glide stays zoom-constant (Google-Earth).
    const mk = moveKeys.current;
    const mvF = (mk.KeyW ? 1 : 0) - (mk.KeyS ? 1 : 0);
    const mvR = (mk.KeyD ? 1 : 0) - (mk.KeyA ? 1 : 0);
    const mvU = (mk.KeyE ? 1 : 0) - (mk.KeyQ ? 1 : 0);
    if (mvF || mvR || mvU) {
      markInput(); // held movement keys are live input — hold the idle drift off
      orthoFocusTarget.current = null; // manual movement cancels an in-flight focus zoom
      c.getPosition(_mvEye);
      c.getTarget(_mvTgt);
      _mvFwd.subVectors(_mvTgt, _mvEye);
      _mvFwd.y = 0;
      if (_mvFwd.lengthSq() < 1e-6) _mvFwd.set(0, 0, -1); // near top-down: pick a default heading
      _mvFwd.normalize();
      _mvRight.crossVectors(_mvFwd, _UP).normalize();
      const speed =
        st.projection === "orthographic"
          ? st.orthoSize * orbitFramingFactor(pcam.aspect) * MOVE_ORTHO_K
          : Math.max(_mvEye.y, MOVE_MIN_ALT) * MOVE_ALT_K;
      const step = speed * st.snv3.moveSpeed * delta;
      _mvDelta.copy(_mvFwd).multiplyScalar(mvF * step).addScaledVector(_mvRight, mvR * step);
      // Keep the focal over the city disc (rigid rig move); Q/E stops at the ground floor.
      const cl = clampToCity(_mvTgt.x + _mvDelta.x, _mvTgt.z + _mvDelta.z);
      const dx = cl.x - _mvTgt.x;
      const dz = cl.z - _mvTgt.z;
      const dy = mvU * step;
      let eyeY = _mvEye.y + dy;
      let tgtY = _mvTgt.y + dy;
      if (eyeY < MIN_EYE_Y) {
        tgtY += MIN_EYE_Y - eyeY;
        eyeY = MIN_EYE_Y;
      }
      void c.setLookAt(_mvEye.x + dx, eyeY, _mvEye.z + dz, _mvTgt.x + dx, tgtY, _mvTgt.z + dz, false);
      markCameraActivity("pan");
    }

    // ---- Drift (behaviour 2, reworked 2026-07-16): TWO ways into the same flight.
    // Drift MODE (st.driftMode; Space / helicopter button / Drift header switch) —
    // the camera flies until told otherwise: a manual adjustment pauses it and it
    // eases back in DRIFT_RESUME_SEC after release. IDLE drift (snv3.idleDrift, the
    // preference) — kicks in after idleDelaySec of no input; an intervention stops
    // it and the full timer starts over.
    const v3 = st.snv3;
    // Engage a flight: anchor at the current pose so the motion starts CONTINUOUS —
    // azimuth / radius / focal pick up exactly where the camera rests; only the
    // elevation eases (over the flight's ramp) into its bob band.
    const engage = (rampSec: number) => {
      driftOn.current = true;
      driftRampSec.current = rampSec;
      driftT.current = 0;
      driftWt.current = 0;
      c.getPosition(_eye);
      c.getTarget(_tgt);
      const dx = _eye.x - _tgt.x;
      const dy = _eye.y - _tgt.y;
      const dz = _eye.z - _tgt.z;
      const r = Math.hypot(dx, dy, dz) || 1e-3;
      driftAnchor.current = {
        az: Math.atan2(dx, dz),
        el: Math.asin(THREE.MathUtils.clamp(dy / r, -1, 1)) / DEG, // degrees
        r,
        fx: _tgt.x,
        fy: _tgt.y,
        fz: _tgt.z,
        ph: driftSeedPhase(String(st.masterSeed)) * Math.PI * 2,
        startDist: Math.hypot(_tgt.x - CITY_CENTER.x, _tgt.z - CITY_CENTER.z),
      };
      driftAz.current = driftAnchor.current.az;
      driftF.current = { x: _tgt.x, y: _tgt.y, z: _tgt.z };
      const ph0 = driftAnchor.current.ph;
      const tier0 = CITY_TIERS[st.citySize] + GROUND_APRON_M;
      const roam0 = st.drift.wanderRadius * tier0;
      driftPrevW.current = {
        x: CITY_CENTER.x + roam0 * driftWander1(0, ph0, 0),
        z: CITY_CENTER.z + roam0 * driftWander1(0, ph0, 2.1),
      };
    };
    // Drift-mode edges: ON (from wherever) backdates the idle stamp so takeoff is
    // immediate; OFF holds the pose right where the flight left it.
    if (st.driftMode !== prevDriftMode.current) {
      prevDriftMode.current = st.driftMode;
      if (st.driftMode) lastInput.current = -1e9;
      else driftOn.current = false;
    }
    // Never drift during: top-down (a deliberately parked plan view), or an open
    // inspection (drill cards / a selected building) — the user is READING, and flying
    // away from the framed arcs mid-read would be jarring. Leaving the inspection
    // re-arms the clock (2.14): drift MODE eases back in after the short resume beat;
    // the idle path waits its full delay again.
    const inspecting = st.columnCursor >= 0 || st.selectedBuildingId !== null;
    if (wasInspecting.current && !inspecting) lastInput.current = state.clock.elapsedTime;
    wasInspecting.current = inspecting;
    if (tdReturn.current !== null || inspecting) {
      driftOn.current = false;
    } else if (!driftOn.current) {
      const idleFor = state.clock.elapsedTime - lastInput.current;
      if (st.driftMode) {
        if (idleFor >= DRIFT_RESUME_SEC) engage(DRIFT_RESUME_RAMP_SEC);
      } else if (v3.idleDrift && idleFor >= Math.max(2, v3.idleDelaySec)) {
        engage(DRIFT_RAMP_SEC);
      }
    }
    if (driftOn.current) {
      driftT.current += delta;
      const a = driftAnchor.current;
      const d = st.drift; // feel knobs shared with the Drift model's sliders
      const t = driftT.current;
      // Speed ramp: EVERY rate scales by this, so the drift starts at a standstill at
      // the current pose and builds to full speed over this flight's ramp — no pose
      // lerp anywhere (round 4: the old blend-to-the-wander-path read as a big glide).
      // The ramp doubles as the "lerp back into drift" after a manual adjustment.
      const easeIn = Math.min(1, t / driftRampSec.current);
      const ramp = easeIn * easeIn * (3 - 2 * easeIn); // smoothstep 0 → 1
      const tier = CITY_TIERS[st.citySize] + GROUND_APRON_M;
      // Azimuth: steady revolve from the resting bearing — INTEGRATED so a Revolve-
      // slider change mid-drift only changes speed (see driftAz ref comment).
      const revRate = d.revolveSec > 0 ? (Math.PI * 2) / d.revolveSec : 0;
      driftAz.current += revRate * delta * ramp;
      const az = driftAz.current;
      // Focal: ride the wander's VELOCITY from wherever the focal is — the tour starts
      // at the parked focal with zero jump and roams from there. The city centre only
      // BOUNDS the roam (disc of `roam` around CITY_CENTER, widened to the engage
      // distance so a rim start can't clamp-jump); nothing ever pulls toward it.
      // Wander clock INTEGRATED (Speed slider = pace, 2.15).
      const roam = d.wanderRadius * tier;
      driftWt.current += delta * d.wanderSpeed * ramp;
      const wt = driftWt.current;
      const wx = CITY_CENTER.x + roam * driftWander1(wt, a.ph, 0);
      const wz = CITY_CENTER.z + roam * driftWander1(wt, a.ph, 2.1);
      const f = driftF.current;
      f.x += wx - driftPrevW.current.x; // the wander's own motion this frame
      f.z += wz - driftPrevW.current.z;
      driftPrevW.current.x = wx;
      driftPrevW.current.z = wz;
      f.y += (0 - f.y) * Math.min(1, DRIFT_AIM_SETTLE * delta * ramp); // aim settles to ground level
      const boundR = Math.max(roam, a.startDist);
      const cl = clampToDisc(f.x, f.z, boundR, _driftClamp);
      f.x = cl.x;
      f.z = cl.z;
      // Radius: the Drift model's dolly breathe, around the CURRENT distance.
      const R = a.r * (1 + d.breathe * Math.sin(t * DRIFT_RADIUS_FREQ + a.ph) * ramp);
      // Elevation: bob around the resting elevation clamped into the drift band — PLUS
      // the cruise-altitude floor: the band rises (on the same ramp) until the eye
      // clears DRIFT_CRUISE_ALT, so the wander can't clip through downtown towers on
      // any seed. At typical radii that floor is still a near-horizon ~6–10°.
      const elFloor =
        Math.asin(THREE.MathUtils.clamp((DRIFT_CRUISE_ALT - f.y) / Math.max(1, R), 0, 0.95)) / DEG;
      const bandMid = THREE.MathUtils.clamp(
        Math.max(a.el, elFloor),
        DRIFT_EL_MIN,
        DRIFT_EL_MAX,
      );
      const elTarget = bandMid + d.elevAmp * Math.sin(t * DRIFT_EL_FREQ + a.ph + 1.7);
      const elDeg = a.el + (elTarget - a.el) * ramp;
      const el = elDeg * DEG;
      const sp = Math.cos(el); // horizontal share of the radius
      const cp = Math.sin(el); // vertical share
      void c.setLookAt(
        f.x + R * sp * Math.sin(az),
        Math.max(MIN_EYE_Y, f.y + R * cp),
        f.z + R * sp * Math.cos(az),
        f.x,
        f.y,
        f.z,
        false,
      );
    }
    // Mirror the flying state for the helicopter button's icon (write-on-change only).
    if (st.driftFlying !== driftOn.current) st.setDriftFlying(driftOn.current);

    // ---- Top-down compass rose gate (#95): "parked" = banked in top-down (tdReturn
    // set) AND actually near the overhead pose. A manual tilt-away (LMB-drag, no `t`)
    // drops the live elevation below TD_STILL_ELEV_DEG even though the banked return
    // pose stays put (the state machine keeps it so the NEXT `t` re-squares instead of
    // returning — see the toggle above) — gate on live elevation too, so the rose fades
    // out on that tilt-away, not just on a full return. Write-on-change, mirroring
    // driftFlying just above.
    c.getPosition(_eye);
    c.getTarget(_tgt);
    const parkR = _eye.distanceTo(_tgt) || 1e-3;
    const parkElevDeg = Math.asin(THREE.MathUtils.clamp((_eye.y - _tgt.y) / parkR, -1, 1)) / DEG;
    const parked = tdReturn.current !== null && parkElevDeg >= TD_STILL_ELEV_DEG;
    if (st.topDownParked !== parked) st.setTopDownParked(parked);

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
        <Html position={pin.pos} center zIndexRange={[100, 0]} pointerEvents="none">
          {pin.kind === "cone" ? (
            // Cone-view pivot: the arcs' centre point the orbit revolves around — the
            // pin marks it, and the cone glyph above ties it to the cone button that
            // framed this view (why THIS point: it keeps all the arcs in frame).
            <div
              className="flex flex-col items-center text-sky-300"
              style={{ transform: "translateY(-70%)" }}
            >
              <Cone strokeWidth={2.5} style={{ width: 18, height: 18, marginBottom: 2 }} />
              <MapPin strokeWidth={2.5} style={{ width: 26, height: 26 }} />
            </div>
          ) : (
            <MapPin
              className="text-sky-300"
              strokeWidth={2.5}
              style={{ width: 26, height: 26, transform: "translateY(-50%)" }}
            />
          )}
        </Html>
      )}
    </>
  );
}
