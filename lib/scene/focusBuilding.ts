import { useSceneStore } from "@/lib/state/sceneStore";
import type { Building } from "@/lib/seed/cityGen";

// "Focus" a building (Unity-F style), shared by the inspect-mode double-click
// and the info panel's Focus button. Asks the active orbit camera model to glide
// its pivot onto the building's 3D CENTRE — footprint centre (x, z) and half-height
// (y = height/2, buildings sit on the ground at y=0) — so the building sits
// dead-centre on screen and LMB-orbit rotates around it, framed at a distance
// scaled to its size. The smooth glide + orbit-after come from the model's focus
// consumer calling camera-controls setLookAt(..., enableTransition=true).
export function focusBuilding(b: Building): void {
  const span = Math.max(b.height, b.width, b.depth);
  const dist = Math.max(b.height * 1.6, span * 2.0, 100);
  useSceneStore.getState().setFocusRequest({ x: b.x, y: b.height / 2, z: b.z, dist });
}
