import gsap from "gsap";
import type { ViewLinkPose } from "@/lib/scene/viewLink";
import type { MoveKind } from "./shotList";

// Pure pose math for the vignette player: no React, no clock of its own. The
// caller (components/vignette-lab/VignettePlayer.tsx) supplies `t` in [0,1]
// sourced from the shared scene clock (lib/shaders/sharedTime) — never
// Date.now/performance.now — so these stay reproducible given the same
// elapsed-time samples. GSAP is used only for its pure easing functions
// (gsap.parseEase), never its own ticker: we drive the interpolation
// ourselves, per wiki/notes/decision-camera-transition-tween.md's idiom of a
// tweened proxy value applied imperatively.

export const DEFAULT_TRANSITION_EASE = "power2.inOut";
export const DEFAULT_TRANSITION_SEC = 2.5;

// Hold-move tuning — small, "the camera is barely breathing" amounts. These
// are mood, not blocking: a push-in dollies at most this fraction of the
// starting distance; drift/orbit sweep this far/wide over a FULL hold.
const PUSH_IN_FRACTION = 0.14;
const DRIFT_METERS = 22;
const ORBIT_DEG = 14;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Ease a raw progress fraction using a named GSAP ease (pure function, no ticker). */
export function ease(name: string, t: number): number {
  return gsap.parseEase(name)(Math.min(1, Math.max(0, t)));
}

/** Transition: A→B pose lerp with an eased t in [0,1]. */
export function lerpPose(a: ViewLinkPose, b: ViewLinkPose, t: number): ViewLinkPose {
  return {
    position: lerpVec3(a.position, b.position, t),
    lookAt: lerpVec3(a.lookAt, b.lookAt, t),
    fov: lerp(a.fov, b.fov, t),
    projection: "perspective",
  };
}

// Camera-right in the ground plane, from position→lookAt forward. Used by
// "drift" to truck sideways instead of just panning (aim translates with it).
function rightXZ(pose: ViewLinkPose): [number, number] {
  const fx = pose.lookAt[0] - pose.position[0];
  const fz = pose.lookAt[2] - pose.position[2];
  const len = Math.hypot(fx, fz) || 1;
  return [fz / len, -fx / len];
}

/**
 * Continuous camera motion applied WHILE holding a shot, `t` in [0,1] across
 * the hold. `static` returns the base pose untouched.
 */
export function applyHoldMove(base: ViewLinkPose, move: MoveKind, t: number): ViewLinkPose {
  if (move === "static") return base;

  if (move === "push-in") {
    const k = ease("sine.inOut", t) * PUSH_IN_FRACTION;
    return {
      ...base,
      position: lerpVec3(base.position, base.lookAt, k),
    };
  }

  if (move === "drift") {
    const [rx, rz] = rightXZ(base);
    // Single-direction lateral pass across the hold, not a back-and-forth
    // oscillation — reads as a truck shot, not a wobble.
    const d = (t - 0.5) * DRIFT_METERS;
    return {
      ...base,
      position: [base.position[0] + rx * d, base.position[1], base.position[2] + rz * d],
      lookAt: [base.lookAt[0] + rx * d, base.lookAt[1], base.lookAt[2] + rz * d],
    };
  }

  // orbit: sweep azimuth around the look-at point at a fixed radius/height.
  const dx = base.position[0] - base.lookAt[0];
  const dz = base.position[2] - base.lookAt[2];
  const radius = Math.hypot(dx, dz);
  const startAngle = Math.atan2(dz, dx);
  const sweep = ORBIT_DEG * (Math.PI / 180) * t;
  const angle = startAngle + sweep;
  return {
    ...base,
    position: [
      base.lookAt[0] + Math.cos(angle) * radius,
      base.position[1],
      base.lookAt[2] + Math.sin(angle) * radius,
    ],
  };
}
