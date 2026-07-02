import { useSceneStore } from "@/lib/state/sceneStore";
import { orbitFramingFactor } from "@/lib/scene/aspectFraming";

export type CamReadout = {
  elev: number; // degrees above the horizon
  dist: number; // camera → focal (world units)
  focalY: number; // focal-point height above ground
  camY: number; // camera eye height above ground
  parallel: boolean; // true = (mostly) orthographic — drives the label
  frustumHh: number; // world half-height of the view at the focal plane
  blend: number; // 0 = perspective, 1 = orthographic (the live morph amount)
  // Low-angle framing + tilt-throttle gauges (the app provides these; the lab omits them → no gauges).
  screenY?: number; // current eased pivot, fraction up from the bottom
  screenYBase?: number; // the "normal" Screen-Y endpoint
  screenYLow?: number; // the low-angle Screen-Y endpoint
  tilt?: number; // current rotate/tilt speed multiplier, 0..1
  frameBelow?: number; // elevation (deg) below which the framing eases in
  tiltBelow?: number; // elevation (deg) below which the tilt throttle eases in
};

// Live camera-rig readout for the side-view diagram (components/scene/CameraDiagram). DreiSceneControls
// (the Map model) writes this object every frame — a plain mutable singleton, never React state — and
// the CameraSideView overlay reads it from a rAF loop, snapshotting into state only when a displayed
// value changes. So the diagram repaints at display rate without re-rendering the scene or the settings
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
  screenY: 0.37,
  screenYBase: 0.37,
  screenYLow: 0.07,
  tilt: 1,
  frameBelow: 12,
  tiltBelow: 20,
};

// Only the Map model (DreiSceneControls) writes the singleton above. Every OTHER camera model keeps
// `orbit` + `cameraLive` current in the store instead, so the side view reconstructs the diagram from
// those — this is what makes the panel reflect Drift / Turntable / the Drei-* models, not stale Map
// data. The Map-only framing gauges (screenY / tilt …) are intentionally left undefined here, so the
// diagram drops them for these models. Top-down isn't an orbit writer (it drives the camera straight
// down and leaves `orbit` alone so Map can resume), so it's special-cased from the live camera height.
export function deriveReadout(): CamReadout {
  const s = useSceneStore.getState();
  const blend = s.projectionBlend;
  const fov = s.cameraLive.fov || 50;
  const camY = s.cameraLive.position[1];
  const aspect =
    typeof window !== "undefined" ? window.innerWidth / Math.max(1, window.innerHeight) : 1;
  // Focal-plane half-height, bridging perspective (dist·tan(fov/2)) → ortho (orthoSize·framing) by the
  // live blend — the same bridge ProjectionBlender and the orbit models use.
  const halfH = (dist: number) => {
    const perspK = dist * Math.tan((fov * Math.PI) / 360);
    const oeff = s.orthoSize * orbitFramingFactor(aspect);
    return perspK + (oeff - perspK) * blend;
  };
  if (s.cameraModel === "topdown") {
    const dist = Math.max(1, camY); // camera sits straight above the centre, looking down
    return {
      elev: 90,
      dist,
      focalY: 0,
      camY,
      parallel: blend > 0.5,
      frustumHh: halfH(dist),
      blend,
    };
  }
  const o = s.orbit;
  const dist = Math.max(1, o.radius);
  return {
    elev: o.elevationDeg,
    dist,
    focalY: o.lookAtY,
    camY,
    parallel: blend > 0.5,
    frustumHh: halfH(dist),
    blend,
  };
}
