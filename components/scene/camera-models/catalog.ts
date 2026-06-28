import type { CameraModelId } from "@/lib/state/sceneStore";

// The camera-model catalog — the "3 Cs" personalities the orbit slot can take on
// (Camera / Controls / Character). PURE metadata (no component imports) so the
// settings UI can read labels/blurbs without pulling in three.js. The id→component
// wiring lives in ./registry; the id union lives in the store (sceneStore.ts).
export interface CameraModelMeta {
  id: CameraModelId;
  label: string; // short label for the selector tab
  character: string; // one-line personality, shown under the selector
  blurb: string; // longer description (tooltip / future detail)
}

export const CAMERA_MODELS: CameraModelMeta[] = [
  {
    id: "map",
    label: "Map",
    character: "Hands-on — grab, orbit, and zoom the city like a map.",
    blurb:
      "The full map-style controller: drag to orbit + tilt, grab the ground to pan, scrub the pin for focal height, wheel to zoom toward the cursor, double-click to reset. Persp/ortho morph. The default.",
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
];

export const DEFAULT_CAMERA_MODEL: CameraModelId = "drift";

export function getCameraModelMeta(id: CameraModelId): CameraModelMeta {
  return CAMERA_MODELS.find((m) => m.id === id) ?? CAMERA_MODELS[0];
}
