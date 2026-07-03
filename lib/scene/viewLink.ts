import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { GYM_POSES } from "@/lib/scene/gymPoses";

// Shareable view links — Google-Maps-style "link to what I'm looking at".
//
//   ?cam=<x>,<y>,<z>,<lx>,<ly>,<lz>,<fov>,<p|o>[,<orthoSize>]
//   ?cam=<gym-pose-name>                      (named moire-gym pose)
//
// Nine comma fields: eye position, look-at point, vertical fov, projection
// flag ("p" perspective / "o" orthographic, ortho carries its size). Values
// are world metres rounded to 0.1 — compact enough for chat, exact enough
// that sender and recipient see the same framing. Pairs with ?seed= so one
// URL reproduces city + view; everything else (palette, fog, LOD…) stays the
// recipient's own settings — full-fidelity sharing remains Copy Settings.
//
// Read side: CaptureBoot parses ?cam= and parks the camera at the pose in
// Still mode (the same mechanism the moire-gym uses). Write side:
// buildViewLink() encodes the LIVE pose for the Copy View Link footer action.

export interface ViewLinkPose {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  projection?: "perspective" | "orthographic";
  orthoSize?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const finite = (n: number) => Number.isFinite(n);
// Loose sanity bounds — a link is user input; keep the camera inside the world.
const clampPos = (n: number) => Math.max(-50000, Math.min(50000, round1(n)));
const clampFov = (n: number) => Math.max(5, Math.min(120, round1(n)));
const clampOrtho = (n: number) => Math.max(10, Math.min(5000, Math.round(n)));

const _euler = new THREE.Euler();
const _fwd = new THREE.Vector3();

/** The live pose as a ViewLinkPose, per camera mode's source of truth. */
export function liveViewPose(): ViewLinkPose {
  const s = useSceneStore.getState();
  const live = s.cameraLive;
  let position = live.position;
  let lookAt: [number, number, number];
  let fov = live.fov;
  if (s.cameraMode === "still") {
    // Still mode: the intent IS the pose (CameraControls applies it reactively).
    const it = s.cameraIntent;
    position = it.position;
    fov = it.fov;
    if (it.orient === "lookAt") {
      lookAt = it.lookAt;
    } else {
      _euler.set(it.rotation[0], it.rotation[1], it.rotation[2]);
      _fwd.set(0, 0, -1).applyEuler(_euler);
      lookAt = [
        it.position[0] + _fwd.x * 200,
        it.position[1] + _fwd.y * 200,
        it.position[2] + _fwd.z * 200,
      ];
    }
  } else if (s.cameraModel === "topdown" && s.cameraMode === "orbit") {
    // Top-down leaves `orbit` stale by design (so Map can resume) — the aim is
    // straight down from the live eye.
    lookAt = [position[0], 0, position[2]];
  } else if (s.cameraMode === "orbit") {
    // Orbit models write the target back into `orbit` ~10/s (writeOrbitPose).
    lookAt = [s.orbit.centerX, s.orbit.lookAtY, s.orbit.centerZ];
  } else {
    // Fly (and anything else): derive the aim from the live euler.
    _euler.set(live.rotation[0], live.rotation[1], live.rotation[2]);
    _fwd.set(0, 0, -1).applyEuler(_euler);
    lookAt = [position[0] + _fwd.x * 200, position[1] + _fwd.y * 200, position[2] + _fwd.z * 200];
  }
  const ortho = s.projection === "orthographic";
  return {
    position,
    lookAt,
    fov,
    projection: s.projection,
    ...(ortho ? { orthoSize: s.orthoSize } : {}),
  };
}

/** Encode a pose as the ?cam= value. */
export function encodeCamParam(pose: ViewLinkPose): string {
  const nums = [...pose.position, ...pose.lookAt].map(round1);
  const parts: (number | string)[] = [...nums, round1(pose.fov)];
  if (pose.projection === "orthographic") {
    parts.push("o", Math.round(pose.orthoSize ?? 320));
  } else {
    parts.push("p");
  }
  return parts.join(",");
}

/** Full shareable URL for the current live view (origin + path preserved). */
export function buildViewLink(): string {
  const s = useSceneStore.getState();
  const base = `${window.location.origin}${window.location.pathname}`;
  const cam = encodeCamParam(liveViewPose());
  return `${base}?seed=${encodeURIComponent(s.masterSeed)}&cam=${cam}`;
}

/**
 * Parse a ?cam= value: a named moire-gym pose, or the comma encoding above.
 * Returns null on anything malformed — a bad link boots the default view.
 */
export function parseCamParam(raw: string): ViewLinkPose | null {
  const gym = GYM_POSES[raw];
  if (gym) return { position: gym.position, lookAt: gym.lookAt, fov: gym.fov };
  const f = raw.split(",");
  if (f.length < 8) return null;
  const nums = f.slice(0, 7).map(Number);
  if (!nums.every(finite)) return null;
  const pose: ViewLinkPose = {
    position: [clampPos(nums[0]), clampPos(nums[1]), clampPos(nums[2])],
    lookAt: [clampPos(nums[3]), clampPos(nums[4]), clampPos(nums[5])],
    fov: clampFov(nums[6]),
  };
  if (f[7] === "o") {
    pose.projection = "orthographic";
    const size = Number(f[8]);
    pose.orthoSize = clampOrtho(finite(size) ? size : 320);
  } else if (f[7] === "p") {
    pose.projection = "perspective";
  } else {
    return null;
  }
  return pose;
}
