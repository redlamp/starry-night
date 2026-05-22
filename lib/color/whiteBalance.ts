import * as THREE from "three";
import { kelvinToColor } from "./kelvin";

/**
 * Returns the per-channel gain that, when multiplied into a kelvinToColor()
 * output, simulates viewing it through a camera with the given white-point
 * setting. Pre-multiply window/streetlight emissive colors by this gain to
 * apply a global chromatic shift without per-frame shader work.
 *
 * 6500K returns (1,1,1) — sRGB D65 is a no-op.
 */
export function whiteBalanceGain(whitePointK: number): THREE.Vector3 {
  if (whitePointK === 6500) return new THREE.Vector3(1, 1, 1);
  const wp = kelvinToColor(whitePointK);
  const maxWp = Math.max(wp.r, wp.g, wp.b, 0.001);
  const wpN = { r: wp.r / maxWp, g: wp.g / maxWp, b: wp.b / maxWp };
  return new THREE.Vector3(
    1 / Math.max(0.08, wpN.r),
    1 / Math.max(0.08, wpN.g),
    1 / Math.max(0.08, wpN.b),
  );
}

// Calibration constants picked in /palette (2026-05-22).
// See wiki/research/color-usage-night-skyline.md.
export const SCENE_WHITE_POINT_K = 4500;
export const SCENE_WB_GAIN = whiteBalanceGain(SCENE_WHITE_POINT_K);
