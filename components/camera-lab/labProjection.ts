// Shared camera helpers for the lab's camera-controls methods.
//
// Projection: ONE PerspectiveCamera renders everything. "Orthographic" is faked by blending its
// projection matrix toward a focal-matched ortho matrix (see ProjectionRig), so the camera object
// is always perspective and project/unproject use the live (possibly blended) matrix. That means
// the world half-height of the view at the focal plane is always the perspective focal half-height
// (d·tan(fov/2)) — the faked ortho is sized to match it there — for both park and diagram math.

import * as THREE from "three";
import type CameraControlsImpl from "camera-controls";

const _o = new THREE.Vector3();
const DEG = Math.PI / 180;

// World half-height of the view at the focal plane.
export function cameraHalfHeight(c: CameraControlsImpl, camera: THREE.Camera): number {
  const persp = camera as THREE.PerspectiveCamera;
  return c.distance * Math.tan((persp.fov * DEG) / 2);
}

// App parity: park the orbit pivot (the pin) at Screen Y (orbitPivotFromBottom = 0.37, i.e. low
// on screen) for the lever-arm method via the focal offset, like DreiSceneControls.applyScreenFocus.
// The pin sitting low also moves the lever-arm's pin reference, a big part of the app's feel. Other
// methods stay centred (frac 0). Only writes on a real change so a resting camera can rest.
export function parkFocal(c: CameraControlsImpl, camera: THREE.Camera, leverArm: boolean): void {
  const frac = leverArm ? 0.37 - 0.5 : 0;
  const offY = frac * 2 * cameraHalfHeight(c, camera);
  if (Math.abs(offY - c.getFocalOffset(_o).y) > 0.5) c.setFocalOffset(0, offY, 0, false);
}

// Keep the camera above the ground (app parity, DreiSceneControls' per-frame clamp): the REAL eye
// must stay at/above y = 0. The eye = the analytic orbit point PLUS the focal offset (Screen-Y
// parking physically shifts the camera), so fold that offset back in:
//   eyeY = focalY + offsetY + radius·cos(polar) ≥ 0  →  maxPolar = acos(-(focalY+offsetY)/radius)
//
// Orthographic additionally floors at the HORIZON (app parity: ortho "stays parallel-or-above").
// The eye term alone is not enough — the focal offset lets the orbit point dip while the real eye
// stays up, so elevation can go negative and the ortho frustum then shows BENEATH the world. The
// floor eases in with the morph (`blend`): π (no floor) at perspective → π/2 at full ortho.
export function clampPolarToGround(c: CameraControlsImpl, camera: THREE.Camera, blend = 0): void {
  c.getTarget(_o);
  const offsetY = camera.position.y - (_o.y + c.distance * Math.cos(c.polarAngle));
  const maxPolar = Math.acos(THREE.MathUtils.clamp(-(_o.y + offsetY) / Math.max(1, c.distance), -1, 1));
  const orthoFloor = Math.PI - (Math.PI / 2) * THREE.MathUtils.clamp(blend, 0, 1);
  c.maxPolarAngle = Math.min(maxPolar, orthoFloor);
}

// Sticky detent at Focal Y = 0 (ground level), for the Focal-Y scrub. When the dragged value comes
// within ENTER of 0 it snaps to exactly 0; once snapped it HOLDS at 0 until dragged past EXIT
// (> ENTER), so 0 is easy to land on and feels snug, and deliberate to leave. Thresholds scale with
// the orbit distance so the detent is a roughly constant on-screen size at any zoom.
export function snapFocalY(
  raw: number,
  wasSnapped: boolean,
  dist: number,
): { y: number; snapped: boolean } {
  const enter = Math.max(6, dist * 0.006);
  const exit = Math.max(16, dist * 0.013);
  if (wasSnapped) return Math.abs(raw) > exit ? { y: raw, snapped: false } : { y: 0, snapped: true };
  return Math.abs(raw) < enter ? { y: 0, snapped: true } : { y: raw, snapped: false };
}
