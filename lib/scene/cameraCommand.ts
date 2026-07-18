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
  // Cam v3 owns top-down as an IN-MODEL flight (no model swap). When registered, the `t`
  // hotkey / panel dispatch here instead of swapping to the Top-Down model; returns true
  // when the model handled it (cameraView.toggleTopDown falls through otherwise).
  toggleTopDownInModel: (() => boolean) | null;
  // True while the active model is holding a pose the projection toggle must not dolly
  // (Cam v3's in-model top-down park + an in-flight idle drift). tweenProjectionTo then
  // keeps the radius put instead of sliding to the mode's remembered distance — the same
  // #84 rule the Top-Down MODEL gets via its cameraModel check; v3 never changes
  // cameraModel, so it signals here (the "breathing" of test round 5.32).
  projectionRadiusHold: (() => boolean) | null;
  // The drift transport (Space / the helicopter button / the Orbit transport): three-way —
  // Drift mode ON → off (hold pose); mode OFF but an idle-drift flight is up → stop the
  // flight + restart the idle timer (do NOT flip the mode on); otherwise → mode ON
  // (immediate ramped takeoff). Registered by Cam v3.
  toggleDrift: (() => void) | null;
  // Spin the azimuth to north-up (shortest way), keeping elevation/target/distance —
  // the top-down compass rose's click affordance (#95). Registered by Cam v3 while
  // parked in top-down; a no-op elsewhere (the rose only renders while parked).
  rotateNorthUp: (() => void) | null;
  // Live camera azimuth (compass yaw of the eye around the target, degrees),
  // written EVERY frame by the active model. Telemetry, not a command: the
  // compass rose needle reads this via rAF so it tethers to the real camera
  // instead of the 10Hz orbit store mirror, whose sampling made the needle
  // step/tween out of sync with the city (user 2026-07-18).
  liveAzimuthDeg: number;
} = {
  setTiltDeg: null,
  toggleTopDownInModel: null,
  projectionRadiusHold: null,
  toggleDrift: null,
  rotateNorthUp: null,
  liveAzimuthDeg: 0,
};
