import type { CamReadout } from "@/components/scene/CameraDiagram";

// Live camera-rig readout for the side-view diagram (components/scene/CameraDiagram). DreiSceneControls
// writes this object every frame — a plain mutable singleton, never React state — and the
// CameraSideView overlay reads it from a rAF loop, snapshotting into state only when a displayed value
// changes. So the diagram repaints at display rate without re-rendering the scene or the settings
// panel. (Display-only mirror, so it is NOT scene-state input — the determinism contract doesn't apply.)
// Mirrors the lab's readout ref (wiki/notes/camera-lab-test-plan → "ref-backed HUD").
export const cameraReadout: CamReadout = {
  elev: 45,
  dist: 2000,
  focalY: 0,
  camY: 1000,
  parallel: false,
  frustumHh: 1000,
  blend: 0,
};
