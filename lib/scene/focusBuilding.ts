import { useSceneStore } from "@/lib/state/sceneStore";
import type { Building } from "@/lib/seed/cityGen";

// "Focus" a building (Unity-F style), shared by the inspect-mode double-click
// and the info panel's Focus button. Asks the active orbit camera model to
// glide its pivot onto the building's GROUND centre — so LMB-orbit then rotates
// around the building — and frame it at a distance scaled to the building's
// size. The smooth glide + orbit-after come from the model's focus consumer
// calling camera-controls setLookAt(..., enableTransition=true).
export function focusBuilding(b: Building): void {
  const span = Math.max(b.height, b.width, b.depth);
  const dist = Math.max(b.height * 1.6, span * 2.0, 100);
  useSceneStore.getState().setFocusRequest({ x: b.x, y: 0, z: b.z, dist });
}
