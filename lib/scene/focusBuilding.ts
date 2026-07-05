import { useSceneStore } from "@/lib/state/sceneStore";
import type { Building } from "@/lib/seed/cityGen";

// "Focus" a building (Unity-F style), shared by the inspect-mode double-click
// and the info panel's Focus button. Asks the active orbit camera model to glide
// its pivot onto the building's 3D CENTRE — footprint centre (x, z) and half-height
// (y = height/2, buildings sit on the ground at y=0) — so the building sits
// dead-centre on screen and LMB-orbit rotates around it. We hand the model the
// building's bounding-SPHERE radius (half its space diagonal) rather than a
// distance: the model fits that sphere to its own live fov/aspect, so the WHOLE
// building stays on screen at any orbit angle and in any aspect bucket. The
// smooth glide comes from the consumer's moveTo/dollyTo transitions; the stored
// focusPivot keeps LMB-orbit pivoting on the centre for the rest of the session.
export function focusBuilding(b: Building): void {
  const center: [number, number, number] = [b.x, b.height / 2, b.z];
  const radius = 0.5 * Math.hypot(b.width, b.depth, b.height);
  const st = useSceneStore.getState();
  // Focusing also selects (so the info panel + selection outline track it) and
  // marks this building as FOCUSED (roof pin + the Focus button's active state).
  st.setSelectedBuildingId(b.id);
  st.setFocusedBuildingId(b.id);
  st.setFocusPivot(center);
  st.setFocusRequest({ x: center[0], y: center[1], z: center[2], radius });
}

// Toggle focus OFF: drop the roof pin, the orbit-lock pivot, and the Focus
// button's active state, but keep the building SELECTED (info panel, selection
// outline, and highlight stay). The camera holds its current pose — un-focusing
// is a state toggle, not a fly-back.
export function unfocusBuilding(): void {
  const st = useSceneStore.getState();
  st.setFocusedBuildingId(null);
  st.setFocusPivot(null);
}
