// Live-tunable knobs for the Camera Lab, persisted to localStorage. A flat bag:
// each method reads the subset it cares about, and the panel shows the relevant
// sliders/toggles for the active method.

export type LabTuning = {
  // shared (orbit family)
  rotateSpeed: number; // multiplier on rotate (lever gain, uniform rate, or drei azimuth speed)
  tiltSpeed: number; // tilt rate; 1 = the app's legacy 2*pi/height. Lower = more regulated
  panSpeed: number; // pan / truck speed multiplier
  zoomSpeed: number; // wheel / pinch zoom multiplier
  smoothTime: number; // damping time constant (s); 0 = snappy, higher = floaty
  // lever-arm only
  leverMinR: number; // px floor on press->focus distance (stops the spin blowing up at the pin)
  lowAngleGain: number; // 0..1 rate floor at the horizon (the low-angle speed limit)
  slowBelowDeg: number; // elevation below which the low-angle slowdown eases in
  axisGate: boolean; // gate azimuth on vertical drags so a tilt swipe stays pure tilt
  // fly only
  flyMove: number; // move speed (units/s)
  flyLook: number; // look sensitivity (rad/px)
};

export const DEFAULT_TUNING: LabTuning = {
  rotateSpeed: 1,
  tiltSpeed: 0.5,
  panSpeed: 1,
  zoomSpeed: 1,
  smoothTime: 0.25,
  leverMinR: 40,
  lowAngleGain: 0.35,
  slowBelowDeg: 20,
  axisGate: true,
  flyMove: 160,
  flyLook: 0.0025,
};

export const TUNING_STORAGE_KEY = "camera-lab.tuning";
