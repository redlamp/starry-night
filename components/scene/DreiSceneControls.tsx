"use client";

import { useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Html, Line } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { MapPin } from "lucide-react";
import * as THREE from "three";
import { useSceneStore, DEFAULT_INTENT, type OrbitConfig } from "@/lib/state/sceneStore";
import { CITY_SCALE, CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";
import { orbitFramingFactor } from "@/lib/scene/aspectFraming";
import { tweenOrbitToHome } from "@/lib/scene/cameraView";
import { cameraReadout } from "@/lib/scene/cameraReadout";
import { markCameraActivity } from "@/lib/scene/cameraActivity";
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
function orthoMinRadius(): number {
  const r = CITY_TIERS[useSceneStore.getState().citySize] + GROUND_APRON_M;
  return Math.min(r * ORTHO_RADIUS_FACTOR, MAX_DIST);
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (n: number) => Math.round(n * 10) / 10; // 1 decimal place

// Ground detent at Focal Y = 0, for the pin scrub + free-look aim. A CONTINUOUS soft deadband: within
// ±band of 0 the focal sits at EXACTLY 0 (snug on the ground); past the band the applied value ramps
// smoothly OUT of 0 (raw, less the band width) instead of lurching.
//   The old version (labProjection.snapFocalY) used hysteresis (enter < exit) and HELD the output at 0
// while the raw drag kept accumulating — so crossing the threshold snapped the focal by the whole band
// at once, in both directions. That discontinuity was the "jarring" snap (user 2026-06-21). The
// deadband keeps the land-on-ground feel without the jump. `scale` is the projection-correct
// focal-plane world scale (focalScrubScale), so the detent is a constant on-screen size at any zoom /
// projection — NOT the ortho park radius. Applied to the mouse + touch pin scrubs and the free-look.
function snapFocalY(raw: number, scale: number): number {
  const band = Math.max(10, scale * 0.008);
  const mag = Math.abs(raw);
  return mag <= band ? 0 : Math.sign(raw) * (mag - band);
}

// Projection-correct "effective distance" for the focal-Y scrub speed + its ground detent size. In
// perspective the orbit distance sets the on-screen scale, so speed ∝ distance keeps a constant feel
// across zoom. In ORTHO the orbit radius is a fixed park value (held far out for near-plane safety)
// with nothing to do with on-screen scale — that's orthoSize — so driving the scrub by c.distance made
// it race (~2.4×) and ignore ortho zoom (user 2026-06-21). Map orthoSize back to the equivalent
// perspective distance (same focal-plane world height) so both projections feel identical. Mirrors
// freeLookAim's wppY; perspective is returned unchanged.
function focalScrubScale(c: CameraControlsImpl): number {
  const st = useSceneStore.getState();
  if (st.projection !== "orthographic") return c.distance;
  const cam = c.camera as THREE.PerspectiveCamera;
  const tanHalfFov = Math.tan(((cam.fov * Math.PI) / 180) / 2) || 0.4663;
  return (st.orthoSize * orbitFramingFactor(cam.aspect)) / tanHalfFov;
}

// Auto-revolution resume: after a control gesture, hold the sweep off briefly,
// then ramp (tween) back up to speed. Enabling via Space also ramps up; disabling
// stops instantly (handled by snapping the factor to 0 when paused).
const RESUME_DELAY = 0.4; // s after a gesture before the sweep restarts
const RESUME_RAMP_SEC = 1; // s to ramp the sweep factor 0 → 1 (linear, to full speed)
const DRAG_PX = 6; // press→drag threshold: a click/tap under this doesn't pause the sweep
const FREE_LOOK_GAIN = 1; // free-look: 1 = drag tracks the focal (pin) plane 1:1; >1 = faster look
// Rotate/tilt speed limit (user 2026-06-16): a grazing / far-out view turns the same drag into far
// more on-screen motion. dragRotate tapers the azimuth + tilt rate by elevation (smoothstep to the
// store's rotateLowAngleGain below rotateSlowBelowDeg) and by distance (mild 1/d past ROT_DIST_REF),
// then hard-caps the per-event step as a backstop against fast flicks.
const ROT_DIST_REF = 5000; // distance at/below which there is no distance taper (~default radius)
const ROT_DIST_MIN_GAIN = 0.35; // floor for the distance taper (far out never slower than this share)
const ROT_MAX_STEP = 0.2; // rad: per-event cap on azimuth + tilt (~11.5°), a backstop only
// Tilt-vs-rotate axis gate (user 2026-06-16): a vertical "tilt" drag picks up horizontal delta from
// the natural arc of a thumb, which the lever-arm azimuth turns into unwanted rotation. Accumulate
// the gesture's recent direction (decayed) and gate AZIMUTH by how horizontal it is, so a mostly-
// vertical drag stays pure tilt while a horizontal drag keeps the full turntable spin. Tilt is
// dy-driven, so it already self-limits on horizontal drags. Reset at each gesture start.
const ROT_AXIS_DECAY = 0.9; // recent-direction memory (~10-sample window); lower = more reactive
const ROT_AXIS_GATE_LO = 0.4; // horizontal fraction at/below which azimuth is fully gated (pure tilt)
const ROT_AXIS_GATE_HI = 0.7; // at/above this horizontal fraction, full azimuth
let _rotAccX = 0; // decayed |dx| over the active drag
let _rotAccY = 0; // decayed |dy| over the active drag
function resetDragAxis(): void {
  _rotAccX = 0;
  _rotAccY = 0;
}
const TURNTABLE_MIN_R = 40; // px floor on press↔pin distance, so the press-relative spin can't blow up at the pin
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
const FOCAL_SCRUB_K = 0.0018; // Focal-Y units per pixel, ×focalScrubScale (projection-correct feel)
const SCRUB_SMOOTH = 0.35; // per-event ease on the pin-scrub: smooths choppy mouse deltas, stops dead on release (no post-drag tween)
const PIN_HIT_HALF_W = 16; // pin grab hit box, screen px (centred on the projected focal)
const PIN_HIT_TOP = 34; // px above the focal screen point — the pin icon body extends up
const PIN_HIT_BOT = 8; // px below the tip
const PIN_HIT_TOUCH_PAD = 14; // touch: enlarge the pin hit box (no hover to aim, fatter finger)
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

// Near-horizon pan limit (ported from camera-lab CustomOrbitControls.doPan, 2026-06-21). A
// cursor-locked ground pan at a grazing angle maps one drag pixel to an enormous (or, across the
// horizon, sign-flipped) ground delta — the pan teleports across the whole map. Cap the step to
// PAN_CAP_MULT × the equivalent screen-plane pan (kills the teleport), then taper the rate toward the
// horizon (floor so it still creeps, never rockets). Used by the drag pans (mouse + touch); NOT the
// zoom re-pin, which wants the exact ground lock. Needs an INCREMENTAL (prev→curr) ground delta.
const PAN_CAP_MULT = 6; // max ground step as a multiple of the screen-plane pan for the same pixels
const PAN_TAPER_DEG = 12; // elevation below which the pan rate eases off
const PAN_TAPER_FLOOR = 0.2; // pan rate at 0° elevation (fraction) — a creep, never a rocket
function panHalfHeight(c: CameraControlsImpl, camera: THREE.Camera): number {
  const s = useSceneStore.getState();
  const cam = camera as THREE.PerspectiveCamera;
  const oeff = s.orthoSize * orbitFramingFactor(cam.aspect);
  const perspK = c.distance * Math.tan((cam.fov * DEG) / 2);
  return perspK + (oeff - perspK) * s.projectionBlend; // focal-plane half-height (persp↔ortho by blend)
}
function panWithLimit(
  c: CameraControlsImpl,
  camera: THREE.Camera,
  dom: HTMLCanvasElement,
  dx: number,
  dz: number,
  pixel: number,
): void {
  // Only the INTO-SCREEN axis warps: at a grazing angle, perspective foreshortening along the camera's
  // view vector maps one pixel to an enormous ground distance (the teleport). The SIDEWAYS axis (across
  // the view) isn't foreshortened, so it pans 1:1 at full default speed (user 2026-06-21). Decompose
  // the ground delta into the camera's horizontal forward (fwd) + sideways (side), cap + taper ONLY
  // fwd toward the horizon, leave side untouched, recombine.
  camera.getWorldDirection(_camFwd);
  let fx = _camFwd.x;
  let fz = _camFwd.z;
  const fl = Math.hypot(fx, fz);
  if (fl < 1e-4) {
    panRig(c, dx, dz); // looking ~straight down: no foreshortening axis, pan as-is
    return;
  }
  fx /= fl;
  fz /= fl;
  let fwd = dx * fx + dz * fz; // into-screen component (the one that warps)
  const side = dz * fx - dx * fz; // sideways component (= delta · right, right = (-fz, fx)) — left full
  const wpp = (2 * panHalfHeight(c, camera)) / Math.max(1, dom.clientHeight);
  const cap = PAN_CAP_MULT * wpp * pixel;
  if (cap > 0 && Math.abs(fwd) > cap) fwd = Math.sign(fwd) * cap; // cap the grazing teleport
  const elev = 90 - c.polarAngle / DEG;
  const xe = clamp(elev / PAN_TAPER_DEG, 0, 1);
  const gain = PAN_TAPER_FLOOR + (1 - PAN_TAPER_FLOOR) * (xe * xe * (3 - 2 * xe)); // taper fwd toward horizon
  fwd *= gain;
  panRig(c, fwd * fx - side * fz, fwd * fz + side * fx); // recombine: limited forward + full sideways
}

// Park the orbit pivot (the pin) at the SCREEN FOCUS position — a fraction up from
// the bottom of the screen — via camera-controls' focal offset. The camera still
// orbits the pivot, but the pivot renders off-centre, so rotating around it keeps it
// fixed on screen at that height. The world offset scales with distance (perspective)
// / orthoSize (ortho) so the screen % holds through zoom. Only writes on a real
// change, so a resting camera can still rest.
const _focalOff = new THREE.Vector3();
// Low-elevation ground framing (both projections). As the camera tilts toward the horizon the
// ground sweeps up the frame — in ortho that leaves below-ground void at the bottom, in perspective
// it just crowds the skyline. Below GROUND_EASE_DEG, pull the pivot DOWN so the ground settles low.
// The two projections differ only in WHERE the ground sits: ortho is linear in lookAtY/orthoSize,
// perspective is the foreshortened angle (distance + FOV). Their target pivots cross-fade by
// projectionBlend, so the pull is continuous through a morph and reduces to the pure-ortho pull at
// blend 1. The pull is a smoothstep in elevation (proportional to how parallel the view is), and the
// value is applied DIRECTLY (a pure function of the current elevation) — no per-gesture freeze and no
// post-release damp, so it tracks the tilt as a continuous gradient WHILE dragging and is already
// settled the instant the drag ends. (The earlier freeze-then-damp left a "catch-up" tween after
// release that felt gross; corrTarget is smooth because polarAngle is — camera-controls eases the
// rotation — so direct tracking can't jitter.)
// Single low-angle easing curve (user 2026-06-21): one smoothstep in elevation — 0 above lowAngleDeg,
// 1 at/below the horizon — that drives BOTH the tilt throttle (dragRotate) and the Screen-Y ground
// pull (here), so the framing and the tilt-slowdown ease in lockstep instead of on two separate
// thresholds (the old GROUND_EASE_DEG 12° for Screen-Y vs rotateSlowBelowDeg 20° for tilt). The shared
// threshold is rotateSlowBelowDeg.
function lowAngleT(elevDeg: number, lowAngleDeg: number): number {
  const x = clamp((lowAngleDeg - elevDeg) / Math.max(1, lowAngleDeg), 0, 1);
  return x * x * (3 - 2 * x); // smoothstep
}
let _screenYNow = 0.37; // current eased pivot (fraction from bottom), exposed to the side-view Scr-Y gauge
// The low-angle ground pull is normally applied DIRECTLY (it tracks the tilt smoothly because
// camera-controls eases the rotation). A Focal-Y scrub breaks that: it re-aims with setLookAt(…,false),
// so the polar — and the pull that keys off it — JUMPS per pointer event, jerky at low angle where the
// pull is strong (and the pin's screen anchor wanders mid-scrub). So freeze the pull while scrubbing
// (the scrub owns the aim; the framing shouldn't chase the per-event tilt), then ease it back to live
// on release so the pin doesn't pop. Rotate never freezes, so it keeps its instant tracking. (2026-06-21)
let _corrNow = 0; // the applied pull offset: held during a focal scrub, eased on release, else direct
let _corrFrozen: number | null = null; // value captured + held across a scrub; null = not scrubbing
function applyScreenFocus(c: CameraControlsImpl, camera: THREE.Camera, freeze: boolean): void {
  const s = useSceneStore.getState();
  const base = s.orbitPivotFromBottom;
  const blend = s.projectionBlend;
  // Aspect-widened ortho framing (portrait), matching ProjectionBlender's oeff so the pull + the
  // parked pivot track the widened render. (Perspective's effective fov rides on camera.fov.)
  const oeff = s.orthoSize * orbitFramingFactor((camera as THREE.PerspectiveCamera).aspect);
  // Elevation-keyed target pull (≤ 0): how far below the user's ScreenY to sit at this tilt.
  let corrTarget = 0;
  const elevDeg = 90 - c.polarAngle / DEG;
  const t = s.groundFraming ? lowAngleT(elevDeg, s.rotateSlowBelowDeg) : 0; // shared low-angle curve
  if (t > 0) {
    // The ground/skyline line eases to `lowTarget` (fraction up from the bottom) at full low angle —
    // a balanced city + sky frame, INDEPENDENT of focal Y. `drop` then RAISES the pivot for a focal
    // ABOVE ground so the below-ground void at the bottom stays capped. (Was a fixed 1−CONTENT_CAP =
    // 0.05, which degenerated to "skyline jammed at the bottom / ~90% sky" at focal Y = 0, since both
    // drop terms scale with lookAtY and vanish there.)
    const lowTarget = s.groundFrameLow;
    // Ortho: the ground line sits lookAtY·cos(θ)/(2·orthoSize) below the pin.
    const dropOrtho = (s.orbit.lookAtY * Math.cos(elevDeg * DEG)) / (2 * oeff);
    const targetOrtho = lowTarget + dropOrtho;
    // Perspective: the ground-below-pin sits at the foreshortened angle φ below the view axis.
    const fovRad = (camera as THREE.PerspectiveCamera).fov * DEG;
    const phi =
      Math.atan2(
        s.orbit.lookAtY + c.distance * Math.sin(elevDeg * DEG),
        c.distance * Math.cos(elevDeg * DEG),
      ) -
      elevDeg * DEG;
    const dropPersp = (0.5 * Math.tan(phi)) / Math.tan(fovRad / 2);
    const targetPersp = lowTarget + dropPersp;
    // Cross-fade the two targets by projection; only ever pull DOWN (target below the user's ScreenY).
    const targetPivot = targetOrtho * blend + targetPersp * (1 - blend);
    if (targetPivot < base) {
      corrTarget = (targetPivot - base) * t; // negative — only ever pulls the pin DOWN; eased by the shared curve
    }
  }
  // Freeze the pull during a focal scrub; ease back to live for a few frames after release; else direct.
  if (freeze) {
    if (_corrFrozen === null) _corrFrozen = _corrNow; // capture the live value at scrub start
    _corrNow = _corrFrozen; // hold steady — don't chase the per-event tilt
  } else if (_corrFrozen !== null) {
    _corrNow += (corrTarget - _corrNow) * 0.5; // settle back to live (~5 frames) so the pin doesn't pop
    if (Math.abs(corrTarget - _corrNow) < 0.003) {
      _corrNow = corrTarget;
      _corrFrozen = null;
    }
  } else {
    _corrNow = corrTarget; // direct — rotate keeps its instant, settled-on-release tracking
  }
  const frac = base + _corrNow - 0.5; // 0 = centre, < 0 below centre, > 0 above
  _screenYNow = base + _corrNow; // expose the applied pivot for the side-view Scr-Y gauge
  // Half-height the morph frames at the focal plane — the SAME bridge ProjectionBlender
  // uses (perspK at blend 0 → orthoSize at blend 1), so the parked pin tracks the framing
  // through a projection morph instead of popping when projection flips but blend hasn't.
  const perspK = c.distance * Math.tan(((camera as THREE.PerspectiveCamera).fov * DEG) / 2);
  const halfH = perspK + (oeff - perspK) * blend;
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
// Free-look accumulator: the RAW (un-snapped) look direction + the gesture's fixed focal distance,
// held across the gesture so the Focal-Y=0 detent can stick without freezing the pitch — the applied
// target Y is snapped while the raw direction keeps accumulating the drag. resetFreeLook() re-seeds at
// the start of each free-look gesture (mouse LMB+RMB / Ctrl-drag engage, touch 3-finger start).
const _flDir = new THREE.Vector3();
let _flActive = false;
let _flDist = 0;
function resetFreeLook(): void {
  _flActive = false;
}
function freeLookAim(c: CameraControlsImpl, dx: number, dy: number, viewH: number): void {
  markCameraActivity("look");
  c.getPosition(_camPos);
  // Seed the raw direction + distance once per gesture; thereafter accumulate into _flDir (re-deriving
  // from the snapped target each frame would freeze the pitch at the detent).
  if (!_flActive) {
    c.getTarget(_tgt);
    _flDir.subVectors(_tgt, _camPos);
    _flDist = _flDir.length();
    if (_flDist < 1e-3) return;
    _flDir.multiplyScalar(1 / _flDist);
    _flActive = true;
  }
  const d = _flDist;
  // Screen-proportional look rate (user 2026-06-16): one drag pixel rotates the view by the angle
  // subtending one pixel of the focal (pin) plane, so the scene tracks the cursor 1:1 at the
  // current zoom instead of a fixed angular speed that raced the focal Y at large radius / wide
  // ortho. wppY = focal-plane world units per vertical pixel; rate = wppY / d (rad/px), so the
  // focal Y then moves ~wppY per pixel.
  const st = useSceneStore.getState();
  const cam = c.camera as THREE.PerspectiveCamera;
  const H = Math.max(1, viewH);
  const wppY =
    st.projection === "orthographic"
      ? (2 * st.orthoSize * orbitFramingFactor(cam.aspect)) / H
      : (2 * d * Math.tan(((cam.fov * Math.PI) / 180) / 2)) / H;
  const rate = (wppY / d) * FREE_LOOK_GAIN;
  _quat.setFromAxisAngle(_UP, -dx * rate); // yaw around world up
  _flDir.applyQuaternion(_quat);
  _camRight.crossVectors(_flDir, _UP).normalize(); // camera right
  _quat.setFromAxisAngle(_camRight, -dy * rate); // pitch
  _look.copy(_flDir).applyQuaternion(_quat);
  if (Math.abs(_look.y) < 0.996) _flDir.copy(_look); // clamp short of vertical (no flip)
  // Continuous ground detent at Focal Y = 0: the focal rides distance d along the ray, so its height
  // is _camPos.y + dir.y·d. The deadband eases the applied height onto the ground line and out of it
  // without a snap-jump; the raw horizontal aim is preserved so the pitch keeps accumulating.
  const rawY = _camPos.y + _flDir.y * d;
  const targetY = snapFocalY(rawY, focalScrubScale(c));
  // re-aim from the SAME position at distance d → rotate in place; the new target's Y becomes Focal Y.
  void c.setLookAt(
    _camPos.x,
    _camPos.y,
    _camPos.z,
    _camPos.x + _flDir.x * d,
    targetY,
    _camPos.z + _flDir.z * d,
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
    const halfH = useSceneStore.getState().orthoSize * orbitFramingFactor(aspect);
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

const _screen2 = new THREE.Vector2();
// Screen-px position (client coords) of a world point under the current camera — ortho-correct under
// the faked-ortho camera (camera.project takes the wrong, perspective branch at blend 1, so project
// through the parallel ortho frustum ourselves). Returns false if the point is behind the camera.
function focalScreenPos(
  camera: THREE.Camera,
  dom: HTMLCanvasElement,
  focal: THREE.Vector3,
  out: THREE.Vector2,
): boolean {
  const r = dom.getBoundingClientRect();
  if (useSceneStore.getState().projectionBlend >= 0.9999) {
    const aspect = r.width / Math.max(1, r.height);
    const halfH = useSceneStore.getState().orthoSize * orbitFramingFactor(aspect);
    camera.updateMatrixWorld();
    _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.getWorldDirection(_camFwd);
    camera.getWorldPosition(_camWorld);
    _rel.subVectors(focal, _camWorld);
    if (_rel.dot(_camFwd) <= 0) return false; // behind the camera
    out.x = (_rel.dot(_camRight) / (halfH * aspect)) * 0.5 * r.width + 0.5 * r.width + r.left;
    out.y = -(_rel.dot(_camUp) / halfH) * 0.5 * r.height + 0.5 * r.height + r.top;
  } else {
    _proj.copy(focal).project(camera);
    if (_proj.z > 1) return false; // behind the camera
    out.x = (_proj.x * 0.5 + 0.5) * r.width + r.left;
    out.y = (-_proj.y * 0.5 + 0.5) * r.height + r.top;
  }
  return true;
}

// Is the cursor over the focal pin? Project the (logical) orbit target — which renders at the
// screen-focus % via focalOffset, so projecting it with the offset camera gives its on-screen spot —
// and test a small box around the pin icon (tip on that point, body extending upward).
function pinScreenHit(
  camera: THREE.Camera,
  dom: HTMLCanvasElement,
  focal: THREE.Vector3,
  clientX: number,
  clientY: number,
  pad = 0, // extra hit-box slack; touch passes a larger value (no hover to aim, fatter finger)
): boolean {
  if (!focalScreenPos(camera, dom, focal, _screen2)) return false; // behind the camera
  const dx = clientX - _screen2.x;
  const dy = clientY - _screen2.y;
  // Below ground the pin icon is flipped (scaleY(-1)), so its body extends DOWN from the tip —
  // mirror the hit box, else the focal can't be re-grabbed once it's dragged below the horizon.
  const above = (focal.y >= 0 ? PIN_HIT_TOP : PIN_HIT_BOT) + pad;
  const below = (focal.y >= 0 ? PIN_HIT_BOT : PIN_HIT_TOP) + pad;
  return Math.abs(dx) <= PIN_HIT_HALF_W + pad && dy >= -above && dy <= below;
}

// LMB / 1-finger drag → orbit + tilt, eased (transition = true). AZIMUTH is PRESS-POINT-RELATIVE:
// the grabbed point sweeps an angle around the pin, (v × drag) / |v|² (v = press − pin, screen), so
// where you grab sets the lever arm — press far from the pin → slow / wide arc, near → fast / tight —
// and the direction flips by side for free (above the pin a rightward drag goes CCW, below CW). TILT
// stays a plain uniform vertical drag (the pin-relative tilt is the part that felt bad). |v| is
// floored so the spin can't blow up right at the pin. Shared by touch + mouse. (user 2026-06-16)
function dragRotate(
  c: CameraControlsImpl,
  camera: THREE.Camera,
  dom: HTMLCanvasElement,
  dx: number,
  dy: number,
  pointerX: number,
  pointerY: number,
): void {
  markCameraActivity("rotate");
  c.getTarget(_tgt);
  const r = dom.getBoundingClientRect();
  let pinX = r.left + r.width * 0.5;
  let pinY = r.top + r.height * 0.5;
  if (focalScreenPos(camera, dom, _tgt, _screen2)) {
    pinX = _screen2.x;
    pinY = _screen2.y;
  }
  const vx = pointerX - pinX;
  const vy = pointerY - pinY;
  const r2 = Math.max(vx * vx + vy * vy, TURNTABLE_MIN_R * TURNTABLE_MIN_R);
  let dAz = (vx * dy - vy * dx) / r2; // press-point-relative azimuth (lever arm; CCW above / CW below)
  const st = useSceneStore.getState();
  // Tilt is a regulated, slower action (user 2026-06-16): a gentler rate than rotation, scaled by the
  // tiltSpeed knob (1 = the legacy 2*pi/height gain), so a vertical drag eases the pitch.
  let dPolar = (-2 * Math.PI * st.tiltSpeed * dy) / Math.max(1, dom.clientHeight);
  // Tilt/rotate axis gate: accumulate the gesture's recent direction (decayed) and gate AZIMUTH by
  // how horizontal it is, so the natural arc of a vertical "tilt" drag does not bleed into rotation.
  _rotAccX = _rotAccX * ROT_AXIS_DECAY + Math.abs(dx);
  _rotAccY = _rotAccY * ROT_AXIS_DECAY + Math.abs(dy);
  const horizFrac = _rotAccX / (_rotAccX + _rotAccY + 1e-6);
  const xa = clamp((horizFrac - ROT_AXIS_GATE_LO) / (ROT_AXIS_GATE_HI - ROT_AXIS_GATE_LO), 0, 1);
  dAz *= xa * xa * (3 - 2 * xa); // smoothstep: vertical drag → no azimuth, horizontal → full
  // Speed limit at grazing / far-out views: taper by elevation (smoothstep to the store floor below
  // the store threshold) and by distance (mild 1/d past ROT_DIST_REF), then hard-cap the step.
  const elevDeg = 90 - c.polarAngle / DEG;
  // Shared low-angle curve (also drives the Screen-Y ground pull) — tilt eases 1 → rotateLowAngleGain
  // as the view nears the horizon, in lockstep with the framing.
  const gElev = 1 + (st.rotateLowAngleGain - 1) * lowAngleT(elevDeg, st.rotateSlowBelowDeg);
  const gDist = clamp(ROT_DIST_REF / Math.max(ROT_DIST_REF, c.distance), ROT_DIST_MIN_GAIN, 1);
  const gain = gElev * gDist;
  dAz = clamp(dAz * gain, -ROT_MAX_STEP, ROT_MAX_STEP);
  dPolar = clamp(dPolar * gain, -ROT_MAX_STEP, ROT_MAX_STEP);
  void c.rotate(dAz, dPolar, true); // eased
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
  applyScreenFocus(c, camera, false);
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
  const focalScrubbing = useRef(false); // a Focal-Y scrub (pin / LMB+RMB / 1-finger) is live
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

    const qElev = Number(q?.get("elev"));
    if (q?.has("elev") && Number.isFinite(qElev)) s.setOrbit({ elevationDeg: qElev });

    if (q?.get("pinPlane") === "1") s.setShowPinPlane(true);

    const effectiveProjection = projectionOverride ?? s.projection;
    s.setProjectionBlend(effectiveProjection === "orthographic" ? 1 : 0);

    if (q?.get("mode") === "orbit") s.setCameraMode("orbit"); // capture the interactive orbit rig
  }, []);

  // THROWAWAY debug exposure (2026-06-14): reach the live camera / controls / store from a
  // headless CDP Runtime.evaluate for geometry dumps. Remove with the URL override.
  useEffect(() => {
    if (typeof window !== "undefined")
      Object.assign(window, { __cam: { controls, camera, store: useSceneStore, home: tweenOrbitToHome } });
  }, [camera]);

  // Button map (swapped 2026-06-16): LMB = rotate/tilt, RMB = pan (custom). Touch is rebound in
  // the gesture effect (1-finger orbit / 2-finger pan+pinch / 3-finger free-look).
  useEffect(() => {
    const c = controls.current;
    if (!c || mode !== "orbit") return;
    const A = CameraControlsImpl.ACTION;
    c.mouseButtons.left = A.NONE; // rotate/tilt handled by the custom turntable effect (LMB, cursor-pinned)
    c.mouseButtons.right = A.NONE; // pan handled by the custom anchored-pan effect (RMB / Shift+LMB)
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

  // LMB drag → turntable rotate / tilt, identical to 1-finger touch (camera-controls' own ROTATE is
  // off in the button map, so azimuth can be the cursor-pinned turntable + the rotate/tilt lock).
  // Bails for the gestures that own LMB: Shift / Ctrl / Cmd (pan, free-look), both buttons
  // (free-look), and a press on the pin (Focal-Y scrub). The shared drag-threshold tracker handles
  // the sweep-pause + writeBack, so this only drives the camera. (user 2026-06-16)
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    let rotating = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) return; // pan / free-look modifiers own LMB
      if ((e.buttons & 0b11) === 0b11) return; // both buttons → free-look
      const c = controls.current;
      if (!c) return;
      if (useSceneStore.getState().showFocalIndicator) {
        c.getTarget(_tgt);
        if (pinScreenHit(camera, dom, _tgt, e.clientX, e.clientY)) return; // on the pin → scrub
      }
      rotating = true;
      lastX = e.clientX;
      lastY = e.clientY;
      resetDragAxis(); // fresh tilt/rotate axis intent for this drag
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!rotating) return;
      if ((e.buttons & 0b11) !== 0b01 || e.shiftKey || e.ctrlKey || e.metaKey) {
        rotating = false; // LMB released, RMB joined, or a modifier joined → hand off
        return;
      }
      const c = controls.current;
      if (!c) return;
      dragRotate(c, camera, dom, e.clientX - lastX, e.clientY - lastY, e.clientX, e.clientY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      rotating = false;
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
    };
  }, [mode, gl, camera]);

  useEffect(() => {
    const dom = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      const s = useSceneStore.getState();
      if (s.cameraMode !== "orbit") return;
      wheelFrames.current = 10; // mark a wheel as "controlling" so readback tracks
      markCameraActivity("zoom");
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
          applyScreenFocus(c, camera, false); // re-park the pin for the new distance NOW (no hiccup)
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

  // Custom ground-anchored pan (mouse) — now on RMB or Shift+LMB (plain LMB rotates; LMB-on-pin
  // scrubs Focal Y). Suppress the context menu so RMB-drag pans cleanly. Touch pan = 2-finger drag.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    let lastPanX = 0; // incremental pan baseline (re-lock prev→curr, so the cap/taper port works)
    let lastPanY = 0;
    const onCtx = (e: Event) => e.preventDefault();
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if ((e.buttons & 0b11) === 0b11) return; // both buttons → Focal Height owns it
      if (!(e.button === 2 || (e.button === 0 && e.shiftKey))) return; // RMB or Shift+LMB
      if (!controls.current) return;
      lastPanX = e.clientX; // seed the incremental baseline
      lastPanY = e.clientY;
      panning.current = true; // the drag-threshold tracker handles pause + readback
      dom.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!panning.current) return;
      if ((e.buttons & 0b11) === 0b11) {
        panning.current = false; // both buttons down → Focal Height owns the gesture
        return;
      }
      if ((e.buttons & 0b11) === 0b01 && !e.shiftKey) {
        panning.current = false; // plain LMB without Shift (Shift released mid-drag) → hand back to rotate
        return;
      }
      const c = controls.current;
      if (!c) return;
      // Incremental: re-lock the ground between the PREVIOUS and CURRENT cursor, then apply the
      // near-horizon cap + taper so a grazing pan creeps instead of teleporting across the map.
      if (
        groundHit(camera, dom, lastPanX, lastPanY, 0, _anchor) &&
        groundHit(camera, dom, e.clientX, e.clientY, 0, _hit)
      ) {
        _delta.subVectors(_anchor, _hit);
        markCameraActivity("pan");
        panWithLimit(c, camera, dom, _delta.x, _delta.z, Math.hypot(e.clientX - lastPanX, e.clientY - lastPanY));
      }
      lastPanX = e.clientX;
      lastPanY = e.clientY;
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
    dom.addEventListener("contextmenu", onCtx);
    window.addEventListener("pointerup", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("contextmenu", onCtx);
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
    const A = CameraControlsImpl.ACTION;
    let scrubbing = false;
    let focalY = 0; // raw dragged Focal Y target (accumulates movementY)
    let appliedY = 0; // eased Focal Y actually applied (smooths choppy per-event deltas)
    let lastHover = false;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const s = useSceneStore.getState();
      if (!s.showFocalIndicator) return;
      const c = controls.current;
      if (!c) return;
      c.getTarget(_tgt);
      if (!pinScreenHit(camera, dom, _tgt, e.clientX, e.clientY)) return;
      e.preventDefault();
      scrubbing = true;
      dragging.current = true; // hold the auto-revolution sweep + drive live writeBack
      focalScrubbing.current = true; // relax the ground clamp so the in-place re-aim isn't fought
      panning.current = false; // pan must not co-own this press
      focalY = _tgt.y;
      appliedY = _tgt.y;
      dom.style.cursor = "none";
      dom.setPointerCapture?.(e.pointerId);
      c.mouseButtons.left = A.NONE; // suppress the LMB rotate while scrubbing the pin
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
      // Only LMB drives the scrub — if another button joins (RMB → two-button Focal Height), hand it
      // off so the two don't both re-aim the camera.
      if (e.buttons !== 1) {
        finish(e.pointerId);
        return;
      }
      const c = controls.current;
      if (!c) return;
      c.getTarget(_tgt);
      c.getPosition(_camPos);
      const scale = focalScrubScale(c); // projection-correct (the ortho radius is a park value, not zoom)
      focalY = clamp(focalY - e.movementY * scale * FOCAL_SCRUB_K, FOCAL_Y_MIN, FOCAL_Y_MAX);
      appliedY += (focalY - appliedY) * SCRUB_SMOOTH; // ease toward the dragged target → glides, not steps
      const targetY = snapFocalY(appliedY, scale); // continuous ground detent at Focal Y = 0 (no snap-jump)
      markCameraActivity("focalY");
      // re-aim at the new Focal Y from the SAME camera position → the view tilts; applyScreenFocus
      // (main frame) keeps the pin parked at the screen-focus %.
      void c.setLookAt(_camPos.x, _camPos.y, _camPos.z, _tgt.x, targetY, _tgt.z, false);
    };
    const finish = (pointerId: number) => {
      if (!scrubbing) return;
      scrubbing = false;
      dragging.current = false;
      focalScrubbing.current = false;
      lastHover = false;
      dom.style.cursor = "";
      dom.releasePointerCapture?.(pointerId);
      const c = controls.current;
      if (c) {
        c.mouseButtons.left = A.NONE; // keep camera-controls' LMB rotate off (the custom turntable owns it)
        writeBack(c, syncingFromCamera);
      }
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

  // Focal Height (hold LMB + RMB, or Ctrl/⌘ + LMB): adjust Focal Y by a vertical drag ANYWHERE — no
  // need to grab the small pin. The two-button chord and its one-button modifier twin (Ctrl on
  // Windows/Linux, ⌘ on macOS — the trackpad-friendly form, mirroring Shift+LMB = Move) are the same
  // gesture. Height-only: the camera POSITION is fixed and only the aim tilts (so the rig can't be
  // pushed through the ground), reusing the pin-scrub's exact ease (SCRUB_SMOOTH) + ground detent so
  // they feel identical. Auto-shows the pin while held, restores it after. (user 2026-06-21)
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const A = CameraControlsImpl.ACTION;
    const isFocal = (e: PointerEvent) =>
      (e.buttons & 0b11) === 0b11 || // LMB + RMB chord
      ((e.buttons & 0b11) === 0b01 && (e.ctrlKey || e.metaKey)); // Ctrl/⌘ + LMB twin (RMB up)
    let active = false;
    let focalY = 0; // raw dragged target (accumulates movementY)
    let appliedY = 0; // eased applied value — smooths choppy per-event deltas (matches the pin scrub)
    let priorPin = false;
    const engage = () => {
      const c = controls.current;
      if (!c) return;
      active = true;
      panning.current = false; // both buttons → the custom pan must not co-own this
      dragging.current = true; // hold the auto-revolution sweep + drive live writeBack
      focalScrubbing.current = true; // relax the ground clamp so the in-place re-aim isn't fought
      c.mouseButtons.left = A.NONE; // keep camera-controls rotate off
      c.getTarget(_tgt);
      focalY = _tgt.y;
      appliedY = _tgt.y;
      const st = useSceneStore.getState();
      priorPin = st.showFocalIndicator;
      if (!priorPin) st.setShowFocalIndicator(true);
    };
    const disengage = () => {
      if (!active) return;
      active = false;
      dragging.current = false;
      focalScrubbing.current = false;
      const c = controls.current;
      if (c) c.mouseButtons.left = A.NONE;
      if (!priorPin) useSceneStore.getState().setShowFocalIndicator(false);
      if (c) writeBack(c, syncingFromCamera); // commit the new Focal Y
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (!active && isFocal(e)) {
        e.preventDefault();
        engage();
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (!active) {
        if (isFocal(e)) engage();
        return;
      }
      if (!isFocal(e)) {
        disengage(); // a button released → commit + hand back
        return;
      }
      const c = controls.current;
      if (!c) return;
      c.getTarget(_tgt);
      c.getPosition(_camPos);
      const scale = focalScrubScale(c); // projection-correct (the ortho radius is a park value, not zoom)
      focalY = clamp(focalY - e.movementY * scale * FOCAL_SCRUB_K, FOCAL_Y_MIN, FOCAL_Y_MAX);
      appliedY += (focalY - appliedY) * SCRUB_SMOOTH; // ease toward the dragged target → glides, not steps
      const targetY = snapFocalY(appliedY, scale); // continuous ground detent at Focal Y = 0 (no snap-jump)
      markCameraActivity("focalY");
      // re-aim at the new Focal Y from the SAME camera position → the view tilts; applyScreenFocus
      // (main frame) keeps the pin parked at the screen-focus %.
      void c.setLookAt(_camPos.x, _camPos.y, _camPos.z, _tgt.x, targetY, _tgt.z, false);
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

  // Custom touch gestures (camera-controls touch is off — touches = NONE — so it stays
  // ortho-correct and we own the mapping). Mirrors the desktop swap (user 2026-06-16):
  //   1-finger → rotate + tilt (camera-controls' own rotate speed, so it matches an LMB drag)
  //   2-finger → ground-anchored pan (midpoint drag) + pinch-zoom — locks to whichever leads
  //   3-finger → free-look (look around in place; the touch twin of LMB+RMB / Ctrl-drag)
  // The shared drag-threshold tracker (pointer-type agnostic) owns dragging.current — pausing the
  // sweep + writing the pose back on release — so these handlers only drive the camera.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const pts = new Map<number, { x: number; y: number }>();
    let lastX = 0; // 1-finger rotate anchor
    let lastY = 0;
    // 2-finger: lock to pan OR pinch once one leads past GESTURE_LOCK_PX.
    let g2: "pan" | "pinch" | null = null;
    let startDist = 0;
    let startMidX = 0;
    let startMidY = 0;
    let lastDist = 0;
    let lastMidX = 0; // incremental 2-finger pan baseline
    let lastMidY = 0;
    let last3X = 0; // 3-finger free-look midpoint
    let last3Y = 0;
    // 1-finger-on-pin → Focal Y scrub (the touch twin of LMB-on-pin). Pin must be shown
    // (showFocalIndicator), since touch has no hover to reveal it before you grab.
    let scrub = false;
    let scrubLastY = 0;
    let scrubFocalY = 0; // raw dragged Focal Y (pre-detent accumulator)
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
      startMidX = m.x;
      startMidY = m.y;
      g2 = null; // undetermined until pan / pinch leads past GESTURE_LOCK_PX
    };
    const threeFingerStart = () => {
      resetFreeLook(); // re-seed the look accumulator for the 3-finger free-look
      const m = mid([...pts.values()]);
      last3X = m.x;
      last3Y = m.y;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dom.setPointerCapture?.(e.pointerId);
      const n = pts.size;
      if (n === 1) {
        lastX = e.clientX;
        lastY = e.clientY;
        resetDragAxis(); // fresh tilt/rotate axis intent for this drag
        // On the pin (and the indicator is shown) → scrub Focal Y instead of rotating.
        scrub = false;
        const c = controls.current;
        if (c && useSceneStore.getState().showFocalIndicator) {
          c.getTarget(_tgt);
          if (pinScreenHit(camera, dom, _tgt, e.clientX, e.clientY, PIN_HIT_TOUCH_PAD)) {
            scrub = true;
            scrubLastY = e.clientY;
            scrubFocalY = _tgt.y;
            dragging.current = true; // pause the sweep + drive writeBack while scrubbing
            focalScrubbing.current = true; // relax the ground clamp so the in-place re-aim isn't fought
          }
        }
      } else if (n === 2) {
        scrub = false; // a second finger → pan / pinch owns the gesture
        focalScrubbing.current = false;
        twoFingerStart();
      } else if (n === 3) {
        threeFingerStart();
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = controls.current;
      if (!c) return;
      const n = pts.size;
      if (n === 1) {
        if (scrub) {
          // Scrub Focal Y by vertical travel (clientY delta; touch movementY is unreliable). Re-aim
          // from the same camera position so the view tilts; applyScreenFocus keeps the pin parked.
          c.getTarget(_tgt);
          c.getPosition(_camPos);
          const scale = focalScrubScale(c); // projection-correct (the ortho radius is a park value, not zoom)
          scrubFocalY = clamp(
            scrubFocalY - (e.clientY - scrubLastY) * scale * FOCAL_SCRUB_K,
            FOCAL_Y_MIN,
            FOCAL_Y_MAX,
          );
          scrubLastY = e.clientY;
          const targetY = snapFocalY(scrubFocalY, scale); // continuous ground detent at Focal Y = 0 (no snap-jump)
          markCameraActivity("focalY");
          void c.setLookAt(_camPos.x, _camPos.y, _camPos.z, _tgt.x, targetY, _tgt.z, false);
        } else {
          // 1-finger → press-point-relative orbit + uniform tilt (smoothed).
          dragRotate(c, camera, dom, e.clientX - lastX, e.clientY - lastY, e.clientX, e.clientY);
          lastX = e.clientX;
          lastY = e.clientY;
        }
      } else if (n === 2) {
        const a = [...pts.values()];
        const dist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        const m = mid(a);
        // Lock to pan (midpoint travel) vs pinch (spread change) — whichever leads first.
        if (g2 === null) {
          const accPinch = Math.abs(dist - startDist);
          const accPan = Math.hypot(m.x - startMidX, m.y - startMidY);
          if (Math.max(accPinch, accPan) > GESTURE_LOCK_PX) {
            g2 = accPinch > accPan ? "pinch" : "pan";
            lastMidX = m.x; // seed the incremental-pan baseline at lock
            lastMidY = m.y;
          }
        }
        if (g2 === "pinch" && lastDist > 0 && dist > 0) {
          markCameraActivity("zoom");
          zoomToPoint(c, camera, dom, m.x, m.y, lastDist / dist); // <1 spread = zoom in
        } else if (g2 === "pan") {
          // Incremental ground-anchored pan: pan by the world delta between the PREVIOUS and the
          // CURRENT midpoint, both measured against the current camera. The two fingers report on
          // separate pointer events, so an absolute anchor would chase the half-updated (jittering)
          // midpoint and flick between the two states; a per-event delta is immune to that.
          if (
            groundHit(camera, dom, lastMidX, lastMidY, 0, _anchor) &&
            groundHit(camera, dom, m.x, m.y, 0, _hit)
          ) {
            _delta.subVectors(_anchor, _hit);
            markCameraActivity("pan");
            panWithLimit(c, camera, dom, _delta.x, _delta.z, Math.hypot(m.x - lastMidX, m.y - lastMidY));
          }
          lastMidX = m.x;
          lastMidY = m.y;
        }
        lastDist = dist;
      } else if (n >= 3) {
        // 3-finger → free-look (look around in place).
        const m = mid([...pts.values()]);
        freeLookAim(c, m.x - last3X, m.y - last3Y, dom.clientHeight);
        last3X = m.x;
        last3Y = m.y;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.delete(e.pointerId);
      dom.releasePointerCapture?.(e.pointerId);
      const n = pts.size;
      if (n === 2) {
        twoFingerStart(); // dropped 3 → 2: re-seed the pan / pinch baseline
      } else if (n === 1) {
        const r = [...pts.values()][0];
        lastX = r.x; // dropped 2 → 1: resume rotate from the remaining finger
        lastY = r.y;
        resetDragAxis();
      }
      if (pts.size === 0) {
        scrub = false; // all fingers up → end any pin scrub
        focalScrubbing.current = false;
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

  // Double-click (mouse) → full camera reset home (orientation + position + framing, keeping the
  // current projection). Touch double-tap is detected in the next effect, since touch-action:none
  // suppresses the browser's synthesized dblclick on the canvas.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const onDbl = (e: MouseEvent) => {
      if (!controls.current) return;
      e.preventDefault();
      markCameraActivity("reset");
      tweenOrbitToHome();
    };
    dom.addEventListener("dblclick", onDbl);
    return () => dom.removeEventListener("dblclick", onDbl);
  }, [mode, gl]);

  // Touch double-tap → the SAME full camera reset as mouse double-click. touch-action:none
  // suppresses the synthesized dblclick on the canvas, so detect it ourselves: a tap is a quick
  // single-finger down/up that barely moves; two within DOUBLE_TAP_MS at ~the same spot fire the
  // reset. A second finger (pinch / twist) invalidates the tap so gestures never trigger it.
  useEffect(() => {
    if (mode !== "orbit") return;
    const dom = gl.domElement;
    const DOUBLE_TAP_MS = 300;
    const TAP_MAX_MS = 250; // a tap is a quick press, not a long hold
    const TAP_MOVE_PX = 16; // a tap barely moves
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
        activeId = -1; // a second finger → not a tap (a gesture owns it)
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
        lastTapAt = 0; // a drag / long press breaks the double-tap chain
        return;
      }
      const near =
        Math.abs(e.clientX - lastTapX) <= TAP_MOVE_PX * 2 &&
        Math.abs(e.clientY - lastTapY) <= TAP_MOVE_PX * 2;
      if (e.timeStamp - lastTapAt <= DOUBLE_TAP_MS && near) {
        lastTapAt = 0;
        if (controls.current) {
          markCameraActivity("reset");
          tweenOrbitToHome();
        }
      } else {
        lastTapAt = e.timeStamp;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
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
    };
  }, [mode, gl]);

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
    // ALWAYS keep the two <Html>-bearing groups (pin, dot) parked on the focal — drei
    // projects <Html> from its parent group's matrix, so it must be current the frame
    // visibility flips on, else the pin flashes at the world origin (#80). Cheap (vector
    // copies + a matrix), so it's fine to run every frame even while hidden.
    if (pinRef.current) {
      pinRef.current.position.copy(_focal);
      pinRef.current.updateMatrixWorld();
    }
    if (dotRef.current) {
      dotRef.current.position.set(_focal.x, 0, _focal.z);
      dotRef.current.updateMatrixWorld();
    }
    // The rest only renders when the indicator is on. Plain 3D objects (ring, plumbline)
    // have no Html-mount lag, so they place correctly the frame they're shown — no need to
    // rebuild the plumbline geometry or write DOM styles while hidden (#80 "no measurable
    // cost" for an always-mounted overlay).
    const showNow =
      useSceneStore.getState().showFocalIndicator || useSceneStore.getState().focalAdjust !== "";
    if (!showNow) return;
    // below ground → recolour every focal asset earthy brown (sky-blue above) and flip
    // the pin (pivoting on its tip). A clear "looking into the soil" cue.
    const below = _focal.y < 0;
    const col = below ? COLOR_BELOW : COLOR_ABOVE;
    if (pinIconRef.current) {
      pinIconRef.current.style.transform = below
        ? "translate(-50%, -100%) scaleY(-1)"
        : "translate(-50%, -100%)";
      pinIconRef.current.style.color = col;
    }
    if (dotElRef.current) dotElRef.current.style.background = col;
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

    // park the orbit pivot at the screen-focus position (focal offset; scales w/ zoom). The
    // low-elevation ground pull freezes while a Focal-Y scrub is live (focalScrubbing) so it can't
    // chase the per-event tilt, then eases back on release. (See applyScreenFocus.)
    applyScreenFocus(c, camera, focalScrubbing.current);

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

    // Ground clamp for orbit elevation (BOTH projections): the ACTUAL eye must stay at/above y = 0,
    // and may sit anywhere below Focal Y down to it. Triangulating from focalY + radius·cos(polar)
    // alone bounds the ORBIT POINT — but the real eye is the orbit point PLUS the focal offset
    // (ScreenY parking and the low-elevation ground pull both setFocalOffset, which physically
    // shifts the camera), so that stops the orbit point on the ground while the eye is still up
    // (the "looks high" at the limit). Measure the offset's world-Y contribution (actual − orbit)
    // and fold it in: eyeY = focalY + offsetY + radius·cos(polar) ≥ 0 →
    //   maxPolar = acos(-(focalY + offsetY)/radius). Recomputed live, so it tracks Focal Y, radius
    // (zoom / morph tween), AND the focal offset; the persp↔ortho radius tween rides it safely too.
    c.getTarget(_tgt);
    // Use the REAL eye (camera.position), NOT c.getPosition(): camera-controls' getPosition returns
    // the pre-focal-offset orbit point (Y≈0 at the limit), but the focal offset (ScreenY + ground
    // pull) physically shifts the rendered camera up ~137 — so measuring against getPosition read
    // offsetY≈0 and the eye stayed high. offsetY = real eye − analytic orbit point.
    const offsetY = camera.position.y - (_tgt.y + c.distance * Math.cos(c.polarAngle));
    // Ground floor for the EYE. Perspective: eye ≥ 0 (just above the plane). ORTHO: the parallel slab
    // spans eye ± frustumHalfHeight (oeff), so eye = oeff would jam the ground to the very bottom (and
    // push the pin off-screen). Instead leave a controlled void gap below the ground = the low-angle
    // Screen Y (groundFrameLow): eye ≥ oeff·(1−2·gap) rests the ground that fraction up from the bottom
    // with some void below it (OK at the horizon — user 2026-06-21), while keeping the eye ≥ 0 (above
    // ground, no underside). A higher Focal Y still raises the eye → the tilt can go more negative.
    // Blended so a projection morph tweens to the plain eye ≥ 0 perspective floor.
    const oeff = s.orthoSize * orbitFramingFactor((camera as THREE.PerspectiveCamera).aspect);
    const eyeFloor = s.projectionBlend * Math.max(0, oeff * (1 - 2 * s.groundFrameLow));
    let maxPolar = Math.acos(clamp((eyeFloor - (_tgt.y + offsetY)) / Math.max(1, c.distance), -1, 1));
    // A Focal-Y scrub re-aims from a FIXED orbit point (it can't push the camera underground), so the
    // ground clamp has nothing to protect against — but when it binds it MOVES the orbit point and
    // fights the in-place re-aim, worst right at Focal Y = 0 where the clamp sits at its limit. Relax
    // it while scrubbing; the live clamp resumes on release (the orbit point never left the ground, so
    // there's nothing to snap back). (user 2026-06-21 — the "fight near Focal Y = 0")
    if (allowUnder || focalScrubbing.current) maxPolar = Math.PI * 0.98;
    c.maxPolarAngle = maxPolar;

    // Side-view diagram readout (display-only; the CameraSideView overlay paints it). A cheap
    // per-frame write to a shared object — never React state — so it can't trigger a re-render.
    // frustumHh blends the perspective half-height (d·tan(fov/2)) → ortho (orthoSize·framing) by the
    // morph amount, the same bridge applyScreenFocus uses, so the drawn frustum tracks a projection
    // tween. _tgt still holds the focal from the ground-clamp block above.
    if (s.showSideView) {
      const cam = camera as THREE.PerspectiveCamera;
      const perspHh = c.distance * Math.tan((cam.fov * DEG) / 2);
      const orthoHh = s.orthoSize * orbitFramingFactor(cam.aspect);
      const blend = s.projectionBlend;
      cameraReadout.elev = 90 - c.polarAngle / DEG;
      cameraReadout.dist = c.distance;
      cameraReadout.focalY = _tgt.y;
      cameraReadout.camY = camera.position.y;
      cameraReadout.blend = blend;
      cameraReadout.parallel = blend >= 0.5;
      cameraReadout.frustumHh = perspHh + (orthoHh - perspHh) * blend;
      // Low-angle framing + tilt-throttle gauges: current eased Screen Y (+ its norm/low endpoints)
      // and the live rotate/tilt speed multiplier, both keyed to the current elevation.
      const elevG = 90 - c.polarAngle / DEG;
      const gElev = 1 + (s.rotateLowAngleGain - 1) * lowAngleT(elevG, s.rotateSlowBelowDeg);
      const gDist = clamp(ROT_DIST_REF / Math.max(ROT_DIST_REF, c.distance), ROT_DIST_MIN_GAIN, 1);
      cameraReadout.tilt = gElev * gDist;
      cameraReadout.screenY = _screenYNow;
      cameraReadout.screenYBase = s.orbitPivotFromBottom;
      cameraReadout.screenYLow = s.groundFrameLow;
      // Framing + tilt now share ONE threshold (rotateSlowBelowDeg), so both gauges key off it.
      cameraReadout.frameBelow = s.rotateSlowBelowDeg;
      cameraReadout.tiltBelow = s.rotateSlowBelowDeg;
    }

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
        <Html center style={{ pointerEvents: "none" }} zIndexRange={[15, 0]}>
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
        <Html center={false} style={{ pointerEvents: "none" }} zIndexRange={[15, 0]}>
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
