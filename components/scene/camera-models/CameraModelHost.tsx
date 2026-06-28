"use client";

import { useSceneStore } from "@/lib/state/sceneStore";
import { CAMERA_MODEL_COMPONENTS } from "./registry";

// Mounts the active camera MODEL (the orbit-slot controller chosen in Settings →
// Camera model). Rendered in Scene.tsx in place of the old direct DreiSceneControls
// mount; for the default "map" model this is byte-identical to the previous
// behaviour (DreiSceneControls stays mounted across modes and self-gates to orbit).
// Each model self-gates, so fly / still still fall through to the legacy controller.
export function CameraModelHost() {
  const id = useSceneStore((s) => s.cameraModel);
  const Model = CAMERA_MODEL_COMPONENTS[id] ?? CAMERA_MODEL_COMPONENTS.map;
  return <Model />;
}
