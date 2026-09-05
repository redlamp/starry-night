// Pure geometry helpers extracted from StarryNightV3Model.tsx (2026-09-05). These take
// everything they need as arguments (plus their own private scratch vectors below) — no
// store reads, no refs, no closures over the model's component state — so they're safe to
// unit-test or reuse in isolation. Everything else that TOUCHED the store (groundHit,
// zoomAtCursor, clampToCity) or the skyline latch stayed in the model file; see that file's
// comments at each call site for why.

import * as THREE from "three";
import type CameraControlsImpl from "camera-controls";
import { CITY_CENTER } from "@/lib/seed/topology";

// Private scratch, used only within this file's own functions during a single synchronous
// call (never retained by a caller) — safe as module-private temp workspace, distinct from
// the model file's own same-purpose scratch of the same names.
const _eye = new THREE.Vector3();
const _tgt = new THREE.Vector3();

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
export function zoomAboutPoint(
  c: CameraControlsImpl,
  pivot: THREE.Vector3,
  k: number,
  smooth: boolean,
) {
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

// Keep a point within a disc of radius R centred on CITY_CENTER (world XZ). clampToCity (still in
// the model file — it reads citySize off the store) is the ground-disc-radius convenience most
// callers use; the pan handler also clamps the EYE independently to a larger disc
// (PAN_EYE_REACH_MULT × the ground radius) so backing the camera up can't dead-stop at the same
// rim the focal is held to.
export function clampToDisc(
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
