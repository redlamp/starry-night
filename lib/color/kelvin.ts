import * as THREE from "three";

/**
 * Tanner Helland's approximation of blackbody color temperature → sRGB.
 * Input clamped to 1000..10000 K.
 */
export function kelvinToColor(kelvin: number): THREE.Color {
  const k = Math.max(1000, Math.min(10000, kelvin));
  const t = k / 100;

  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }

  return new THREE.Color(
    Math.max(0, Math.min(255, r)) / 255,
    Math.max(0, Math.min(255, g)) / 255,
    Math.max(0, Math.min(255, b)) / 255,
  );
}

export function lerpKelvin(rng: () => number, low: number, high: number): THREE.Color {
  return kelvinToColor(low + rng() * (high - low));
}
