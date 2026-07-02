// Imperative command channel from the settings panel (React / DOM) into the active camera model
// (which lives inside the R3F canvas). A camera model registers handlers on mount and clears them on
// unmount; the Camera panel calls them. A plain mutable singleton — like cameraReadout /
// cameraActivity — NOT React state and NOT scene-state input, so the determinism contract does not
// apply. Handlers are null when no registering model is mounted (callers no-op via `?.`).
//
// Why not the store? The v2 camera is driven imperatively (setLookAt from gestures) and only WRITES
// the orbit pose as a readout — it never reads orbit.* to position itself. So writing orbit.elevationDeg
// from the panel would be overwritten next frame instead of moving the camera. A direct command it is.
export const cameraCommand: {
  // Re-pitch the camera to an absolute tilt (look-down angle in degrees: 0 = parallel to the ground,
  // 90 = straight down), keeping azimuth, distance, and target fixed. Clamped to the model's tilt floor.
  setTiltDeg: ((deg: number, smooth: boolean) => void) | null;
} = {
  setTiltDeg: null,
};
