// Live "which camera behavior is happening right now" signal, for the ControlsGuide highlight.
// DreiSceneControls calls markCameraActivity() as each gesture runs; ControlsGuide reads this from a
// rAF loop and highlights the matching row, treating it as idle once EXPIRY has passed without a
// fresh mark (so the highlight clears when the gesture stops — no per-handler "clear on end" needed).
//
// Display-only (a UI affordance, NOT scene state), so the performance.now() stamp is fine under the
// determinism contract — same basis as the FPS meter. A plain mutable singleton, never React state.
export type CameraAction = "rotate" | "focalY" | "pan" | "look" | "zoom" | "zoomIn" | "reset";

export const cameraActivity: { action: CameraAction | null; at: number } = { action: null, at: 0 };

export function markCameraActivity(action: CameraAction): void {
  cameraActivity.action = action;
  cameraActivity.at = typeof performance !== "undefined" ? performance.now() : 0;
}
