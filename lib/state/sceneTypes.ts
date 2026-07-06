// Pure type definitions and type-only helpers for the scene store.
// No runtime imports — this file is the root of the import DAG:
//   sceneTypes ← sceneDefaults ← sceneMigration ← sceneStore

export type LightingMode = "classic" | "modern";
export type QualityTier = "low" | "med" | "high" | "ultra";
export type CameraMode = "still" | "fly" | "orbit";

// Which camera-control MODEL drives the orbit slot (the "3 Cs": Camera / Controls /
// Character). "map" = the hands-on grab/orbit/zoom controller (DreiSceneControls);
// other ids are self-contained alternative models mounted via the camera-model
// registry. Orthogonal to cameraMode (still/fly/orbit) — models apply in orbit.
// Metadata (labels/blurbs) live in components/scene/camera-models/catalog.ts.
export type CameraModelId =
  | "map"
  | "drift"
  | "turntable"
  | "topdown"
  | "fly"
  | "snv2"
  | "googleearth"
  | "dreimap"
  | "dreicamera";

export type Projection = "perspective" | "orthographic";

export type Vec3 = [number, number, number];

// lookAt is captured from raw camera world coords (15-digit floats). Trim to
// 3 dp so saved/copied configs stay readable. (#22)
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
export const roundVec3 = (v: Vec3): Vec3 => [round3(v[0]), round3(v[1]), round3(v[2])];

export type OrientSource = "lookAt" | "rotation";

export type CameraIntent = {
  position: Vec3;
  lookAt: Vec3;
  rotation: Vec3; // radians, Euler XYZ
  fov: number;
  orient: OrientSource;
};

export type CameraLive = {
  position: Vec3;
  rotation: Vec3;
  fov: number;
};

export type OrbitConfig = {
  centerX: number;
  centerZ: number;
  // Absolute world-Y of the lookAt target. Fixed in space — the camera arcs
  // around (centerX, lookAtY, centerZ) as elevation and azimuth change.
  lookAtY: number;
  radius: number; // 3D distance from city centre (the orbit sphere radius)
  azimuthDeg: number; // current yaw around city axis, 0 = +z
  elevationDeg: number; // angle above horizon, 0 = horizon, 90 = directly above
  periodSec: number; // seconds per full revolution
};

// Drift camera-model tunables (the hands-off ambient orbit). Defaults = the authored
// feel; all are live-editable in Settings -> Orbit -> Drift, and persisted.
export interface DriftConfig {
  wanderRadius: number; // brownian ground-wander reach, as a fraction of the city half-extent
  wanderSpeed: number; // multiplier on the wander's base frequencies
  elevMid: number; // mean camera elevation above the horizon (deg)
  elevAmp: number; // elevation sine-bob amplitude (deg)
  revolveSec: number; // seconds per steady azimuth revolution; 0 = no revolve (pure wander + bob)
  breathe: number; // dolly breathe amount (fraction of radius)
}

// Starry Night Cam v2 tunables (the drone-style interactive camera). Live-editable in
// Settings → Orbit → v2, and persisted.
export interface Snv2Config {
  minDist: number; // closest the camera may get to its target (world metres)
  maxDist: number; // farthest the camera may get (world metres)
  orbitSpeed: number; // tilt / rotate drag sensitivity (× base). 1 = default
  zoomSpeed: number; // wheel zoom rate (× base). 1 = default
  moveSpeed: number; // WASD/QE fly-through rate (× base). Speed scales with altitude
  // (perspective) or view size (ortho), so the on-screen glide feels constant at any zoom
  // — this is the multiplier on top of that. 1 = default
  // Perspective: lowest the view may tilt. 0 = level (no looking up); negative lets the camera drop
  // into a low vantage looking up; positive keeps it angled down. Down-tilt still caps near vertical.
  tiltFloorDeg: number;
}

// Turntable camera-model tunables (the showcase spin). Live-editable in
// Settings -> Orbit -> Turntable, and persisted.
export interface TurntableConfig {
  elevDeg: number; // fixed camera elevation above the horizon (deg)
  spinSec: number; // seconds per revolution; 0 = no auto-spin (grab-to-spin only)
}

export type TweenRequest = { to: CameraIntent; durationMs: number };

// Snapshot of the model + pose that was active before the `t` hotkey swept into
// Top-down (#83) — consumed on exit to tween back to the same model and pose
// (map/snv2/fly exactly; drift/turntable/googleearth/dreimap/dreicamera just seed
// their azimuth from `orbit` and resume their own motion). See TopDownModel.tsx.
export type TopDownEntry = {
  modelId: CameraModelId;
  orbit: Pick<OrbitConfig, "azimuthDeg" | "elevationDeg" | "radius" | "centerX" | "centerZ" | "lookAtY">;
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  orthoSize: number;
  paused: boolean;
};

// Per-archetype window glass-to-cell fraction. Width AND height are
// per-building RANGES: each building rolls ONE seeded value per dimension
// (independent rolls) inside [min, max], and every window on that building
// shares the size. Live-tunable via the Buildings panel; the shader reads
// these by archetype index. Grid pitch is baked separately in cityGen.
// See wiki/notes/decision-window-proportion-by-archetype.md.
// Simple mode: one width + one height range shared by every building (the
// pre-archetype system). Advanced mode uses DEFAULT_WINDOW_PROFILES per
// archetype. Range midpoints match the old point values, so the average city
// reads the same.
export type WindowRange = { wMin: number; wMax: number; hMin: number; hMax: number };
export type WindowProfile = WindowRange;

// ---------------------------------------------------------------------------
// Debug view modes
// ---------------------------------------------------------------------------
// Building tint washes the 3D massing by a chosen category (plan-view-style),
// driven by a shader uniform mix — no mesh rebuild. Render modes flip each
// scene group between Rendered / Wireframe / Hidden. All runtime UI state.
// 2026-06-08: "off" retired from the mode list — a header on/off switch
// (buildingTint.enabled) gates the wash instead, so the dropdown only carries
// real modes (alphabetised in the UI) and remembers the last one while off.
export type BuildingTintMode =
  | "archetype"
  | "depth"
  | "district"
  | "height"
  | "landuse"
  | "population";
export type RenderGroup = "buildings" | "roads" | "ground" | "sky" | "moon";
export type RenderMode = "rendered" | "wireframe" | "hidden";

export type Perf = {
  fps: number;
  triangles: number;
  calls: number;
  geometries: number;
  textures: number;
};
