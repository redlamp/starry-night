import type { CameraModelId } from "@/lib/state/sceneStore";

// The camera-model catalog — the "3 Cs" personalities the orbit slot can take on
// (Camera / Controls / Character). PURE metadata (no component imports) so the
// settings UI can read labels/blurbs without pulling in three.js. The id→component
// wiring lives in components/scene/camera-models/registry; the id union lives in the store (sceneStore.ts).
export interface CameraModelMeta {
  id: CameraModelId;
  label: string; // short label for the selector tab
  character: string; // one-line personality, shown under the selector
  blurb: string; // longer description (tooltip / future detail)
  // Transport default applied when this model becomes active (on a USER switch —
  // the selector / the t·f hotkeys — never on hydration, so a saved pose restores
  // exactly as saved). Omitted = plays (orbitPaused false). Map is the still
  // curated pose, so it starts paused; Drift / Turntable are ambient, so they play.
  startsPaused?: boolean;
}

export const CAMERA_MODELS: CameraModelMeta[] = [
  {
    id: "map",
    label: "Starry Night Cam v1",
    character: "The original hands-on Starry Night camera — orbit, tilt, pan, zoom.",
    blurb:
      "The v1 controller: LMB drag to orbit + tilt, RMB / Shift+LMB to pan, scrub the pin for focal height, wheel to zoom toward the cursor, double-click to reset. Persp/ortho morph.",
    startsPaused: true, // the curated still pose — auto-revolution off until you press play
  },
  {
    id: "snv3",
    label: "Starry Night Cam v3",
    character:
      "v2's drone rig + T dives top-down in place, drift transport (Space), arc-aware inspect framing.",
    blurb:
      "The v3 camera: everything v2 does (LMB move, Shift+LMB orbit, Ctrl/⌘+LMB look, wheel zoom, WASD/QE), plus: T sweeps to a top-down plan view WITHOUT leaving the camera — keep panning/zooming up there, T again returns to where you were (or re-squares the view if you tilted away). Leave it alone and it starts to drift around the city on its own (toggle + delay in Settings). Cone-view focus lands at the angle that shows the arcs broadside. Touch: 1-finger orbit, 2-finger pan + pinch, double-tap zoom.",
    startsPaused: true,
  },
  {
    id: "snv2",
    label: "Starry Night Cam v2",
    character: "Drone-style — grab the ground to move, Shift to orbit a point, Ctrl to look.",
    blurb:
      "The v2 camera (v3's base): LMB drag moves over the ground, Shift+LMB orbits the clicked point (pinned), Ctrl/⌘+LMB is a grab-look (the grabbed map point stays under the cursor), wheel zooms toward the cursor, double-click zooms in. Touch: 1-finger move, 2-finger pinch + twist. Perspective + orthographic (press p to toggle).",
    startsPaused: true,
  },
  {
    id: "drift",
    label: "Drift",
    character: "Hands-off — a slow cinematic orbit, the screensaver at rest.",
    blurb:
      "An ambient establishing-shot camera: a slow, seeded crane-orbit around the city with a gentle rise/fall and a breathing dolly. No pointer input — just watch. Space pauses. Deterministic per seed.",
  },
  {
    id: "turntable",
    label: "Turntable",
    character: "Showcase — the city on a slow rotating stage; grab to spin.",
    blurb:
      "A steady showcase rotation at a fixed elevation, presenting the city like a turntable model. Drag horizontally to spin it by hand (auto-spin pauses, then resumes); Space pauses. Elevation + spin rate are adjustable.",
  },
  {
    id: "topdown",
    label: "Top-Down",
    character: "North-up overhead, looking straight down at the city.",
    blurb:
      "A fixed plan view from straight above the city centre, north up, fit to the whole city. No rotation, no auto-motion.",
  },
  {
    id: "fly",
    label: "Fly",
    character: "Free flight: WASD, E up / Q down, drag to look.",
    blurb:
      "First-person free flight in perspective. W/S fly along the look direction, A/D strafe, E/Q up/down, drag to look (no roll), wheel sets speed, Shift sprints. Desktop.",
  },
  {
    id: "googleearth",
    label: "Google Earth",
    character: "Google Earth's stock controls, as a reference — drag to move, right-drag to orbit.",
    blurb:
      "A faithful reference of Google Earth's controls (drei MapControls): LMB drags across the ground, RMB / Shift+LMB orbit + tilt, wheel zooms toward the cursor, double-click zooms in. Touch: 1-finger pan, 2-finger pinch-zoom + twist. Perspective only.",
  },
  {
    id: "dreimap",
    label: "Drei - MapControls",
    character: "Vanilla drei MapControls — drag to pan, right-drag to orbit.",
    blurb:
      "drei's stock MapControls (three.js OrbitControls rebound for maps), exposed unmodified: LMB pans across the ground, RMB orbits, wheel zooms. A different library from the app's camera-controls-based orbit. Perspective only.",
  },
  {
    id: "dreicamera",
    label: "Drei - CameraControls",
    character: "Vanilla camera-controls — the library the app is built on, out of the box.",
    blurb:
      "drei's stock CameraControls (the camera-controls library that DreiSceneControls / Drift / Turntable wrap), with native input left ON: LMB orbits, RMB trucks (screen-plane pan), wheel dollies. The unmodified baseline. Perspective only.",
  },
];

export const DEFAULT_CAMERA_MODEL: CameraModelId = "snv3";

export function getCameraModelMeta(id: CameraModelId): CameraModelMeta {
  return CAMERA_MODELS.find((m) => m.id === id) ?? CAMERA_MODELS[0];
}
