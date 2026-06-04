import { create } from "zustand";

import {
  CITY_SCALE,
  CITY_TIERS,
  DEFAULT_CITY_TIER,
  setCityTier,
  type CityTier,
  type TopologyKind,
} from "@/lib/seed/topology";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { Archetype } from "@/lib/seed/cityGen";
import { setCitySketch } from "@/lib/seed/citySketch";
import { setFieldDeviation as setFieldDeviationModule } from "@/lib/seed/tensorField";
import type { SketchTensorSource } from "@/lib/sketch/orientationField";

export type LightingMode = "classic" | "modern";
export type QualityTier = "low" | "med" | "high" | "ultra";
export type CameraMode = "still" | "fly" | "orbit";

// Quality tier presets. Affects the DPR ceiling passed to the R3F Canvas and
// the suggested star count. User can still override stars.count via slider;
// the tier sets the boot-time ceiling and the DPR cap from then on.
//   low   — integrated GPUs, mobile-class fillrate
//   med   — mid-range discrete or older laptops
//   high  — modern discrete (default)
//   ultra — 4K+ workstations
export const QUALITY_TIERS: Record<
  QualityTier,
  { label: string; dprMax: number; starCount: number }
> = {
  low: { label: "Low", dprMax: 1, starCount: 4000 },
  med: { label: "Medium", dprMax: 1.25, starCount: 8000 },
  high: { label: "High", dprMax: 2, starCount: 16000 },
  ultra: { label: "Ultra", dprMax: 3, starCount: 24000 },
};

export type Projection = "perspective" | "orthographic";

export type Vec3 = [number, number, number];

// lookAt is captured from raw camera world coords (15-digit floats). Trim to
// 3 dp so saved/copied configs stay readable. (#22)
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const roundVec3 = (v: Vec3): Vec3 => [round3(v[0]), round3(v[1]), round3(v[2])];

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

// All in meters. See wiki/research/building-sizes-real-world-references.md
// Tuned via the in-app Save/Copy values workflow on 2026-05-26.
export const DEFAULT_INTENT: CameraIntent = {
  position: [3, 36, 720],
  lookAt: [-3.377, 36.474, -759.372],
  rotation: [2.9051946114622647, -0.005135430560327543, 3.140355522200459],
  fov: 28,
  orient: "lookAt",
};

export const TOP_DOWN_INTENT: CameraIntent = {
  position: [0, 1100, -140],
  lookAt: [0, 0, -140],
  rotation: [-Math.PI / 2, 0, 0],
  fov: 50,
  orient: "lookAt",
};

export const PRESETS: { id: string; label: string; intent: CameraIntent }[] = [
  { id: "default", label: "Default", intent: DEFAULT_INTENT },
  { id: "top-down", label: "Top-down", intent: TOP_DOWN_INTENT },
];

export type TweenRequest = { to: CameraIntent; durationMs: number };

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

// Tuned via the in-app Save/Copy values workflow (last 2026-05-31).
// Radius scales with city width (CITY_SCALE); 1800s sweep (0.2°/s) at a gentle 9°
// elevation. lookAtY (focal HEIGHT) is NOT scaled — building heights are fixed
// across size tiers, so the skyline sits at the same Y regardless of extent.
export const DEFAULT_ORBIT: OrbitConfig = {
  centerX: 0,
  centerZ: -120,
  lookAtY: 240,
  radius: 2400 * CITY_SCALE,
  azimuthDeg: 0,
  elevationDeg: 6,
  periodSec: 1800,
};

// Azimuth flipped 180° from the 200° tuning that paired with the old camera
// pose: with the new defaults the camera faces +z, so the moon sits at +z too.
// radiusRatio: moon radius as a fraction of star shell radius (~4500m), so
// the moon scales with the dome by default. 0.02 ≈ 90m moon at default stars
// radius, sitting just above the horizon (elevation 1°) — exposed in the Moon
// panel for live tuning.
export const DEFAULT_MOON = {
  azimuthDeg: 20,
  elevationDeg: 1,
  distance: 4500 * CITY_SCALE,
  radiusRatio: 0.02,
};
// `factor` is the star base size in px (mean, before the per-star long-tail).
// Previously a vestigial drei value (200) that nothing read; now wired to
// StarField's size prop. Legacy large values are migrated on load.
export const DEFAULT_STARS = {
  radius: 4500 * CITY_SCALE,
  depth: 360 * CITY_SCALE,
  count: 24000,
  factor: 50,
  // #26 meteors: min/max seconds between streaks + master toggle. Each fired
  // streak rolls the NEXT gap uniformly in [min, max] (seeded rng chain in
  // ShootingStars — deterministic per masterSeed).
  shootingMin: 2,
  shootingMax: 40,
  meteorsEnabled: true,
};
// Window shader AA / LOD / occupancy tuning, exposed live via the Windows panel.
//   edge    — fwidth edge-AA multiplier (higher = softer window edges)
//   lodNear — cells-per-pixel where the distance wash-to-glow starts
//   lodRange— ramp width from lodNear to full wash
//   litBias — occupancy threshold shift; higher leaves more windows lit
//   churn   — fraction of windows that breathe over time; the rest hold a
//             static lit/dark state. Lower = calmer city, less flicker.
export const DEFAULT_WINDOW_AA = {
  edge: 1.1,
  lodNear: 0.2,
  lodRange: 0.4,
  litBias: 0.7,
  churn: 0.2,
};

// Per-archetype window glass-to-cell fraction (w = width, h = height of the lit
// pane within its facade cell). Live-tunable via the Windows panel; the shader
// reads these by archetype index. Grid pitch is baked separately in cityGen.
// See wiki/notes/decision-window-proportion-by-archetype.md.
// Simple mode: one window size shared by every building (the pre-archetype
// system). Advanced mode uses DEFAULT_WINDOW_PROFILES per archetype.
export const DEFAULT_WINDOW_SIMPLE = { w: 0.3, h: 0.5 };
export const DEFAULT_WINDOW_PROFILES: Record<Archetype, { w: number; h: number }> = {
  "low-rise": { w: 0.34, h: 0.42 },
  warehouse: { w: 0.82, h: 0.34 },
  "mid-rise": { w: 0.42, h: 0.5 },
  "residential-tower": { w: 0.46, h: 0.56 },
  "narrow-tower": { w: 0.7, h: 0.72 },
  "office-block": { w: 0.78, h: 0.6 },
  spire: { w: 0.82, h: 0.78 },
};
// Moon halo: billboard glow around the moon disc. radiusMul scales the halo
// plane relative to the moon radius; innerRadius is the 0..0.5 fraction of the
// disc that stays opaque before the soft falloff; intensity multiplies the
// emissive output (post-tonemap, so >1.0 blooms under ACES).
export const DEFAULT_MOON_HALO = { radiusMul: 2.5, innerRadius: 0.05, intensity: 1.1 };

export const DEFAULT_FOG = {
  enabled: true,
  mode: "linear" as const,
  color: "#0b0d14",
  near: 2400 * CITY_SCALE, // 4800 at City
  far: 3600 * CITY_SCALE, // 7200 at City
  density: 0.0006,
};

export const DEFAULT_HAZE = {
  enabled: true,
  color: "#1b2641",
  // Vertical extents are absolute (heights don't scale with city width — #47).
  topY: 240,
  bottomY: -30,
  intensity: 1,
  radius: 1500 * CITY_SCALE, // 3000 at City
};

// Intro wake-up sequence defaults. Durations are the "Default" speed preset
// (windows 240s / stars 360s); the panel's Fast preset drops both to 30s.
// Persisted via the settings registry so Reset/Save/Copy/Revert cover them.
export const DEFAULT_INTRO = {
  progress: 0,
  playing: false,
  durationSec: 240,
  // Streetlights wake on their own (shorter) timeline so they don't take the
  // full multi-minute window wake to appear.
  streetlightDurationSec: 60,
  mode: "random" as "random" | "district" | "outside-in" | "far-to-near" | "inside-out",
  offCycleSec: 90,
  retriggerSec: 45,
  cycleJitter: 0.3,
};
export const DEFAULT_STAR_INTRO = {
  progress: 0,
  playing: false,
  durationSec: 240,
  mode: "random" as "random" | "bright-first" | "horizon-first" | "zenith-first",
};

export const DEFAULT_CITY_PLANNING_VIS = {
  showHighways: false,
  showDistrictShells: false,
  showArterials: false,
  showStreets: false,
};

// ---------------------------------------------------------------------------
// Debug view modes
// ---------------------------------------------------------------------------
// Building tint washes the 3D massing by a chosen category (plan-view-style),
// driven by a shader uniform mix — no mesh rebuild. Render modes flip each
// scene group between Rendered / Wireframe / Hidden. All runtime UI state.
export type BuildingTintMode = "off" | "district" | "landuse" | "archetype" | "depth" | "height";
export type RenderGroup = "buildings" | "roads" | "ground" | "sky" | "moon";
export type RenderMode = "rendered" | "wireframe" | "hidden";
export const RENDER_GROUPS: RenderGroup[] = ["buildings", "roads", "ground", "sky", "moon"];

export const DEFAULT_DEBUG = {
  buildingTint: { mode: "off" as BuildingTintMode, intensity: 0.85 },
  renderModes: {
    buildings: "rendered" as RenderMode,
    roads: "rendered" as RenderMode,
    ground: "rendered" as RenderMode,
    sky: "rendered" as RenderMode,
    moon: "rendered" as RenderMode,
  } as Record<RenderGroup, RenderMode>,
  // Tensor Field view (#40 Phase 1): overlay the road-shaping direction field.
  showTensorField: false,
};

// Default wireframe stroke colour — a bright blue used where a group has no
// semantic source colour to match: buildings with tint OFF, and the ground.
// (Buildings with a tint mode stroke in that mode's colour; road tiers stroke
// in their highlight colours; the moon strokes in its own material colour.)
export const DEBUG_WIRE_COLOR = "#4d9fff";

// Ambient traffic (research D): car head/tail-lights flowing along the roads.
// On by default. `density` is the global car-count multiplier; highway/arterial/
// minor are per-tier multipliers layered on each tier's base usage rate (base
// rates already encode the usage hierarchy: highways busiest, side streets least).
export const DEFAULT_TRAFFIC = { enabled: true, density: 1, highway: 4, arterial: 2, minor: 1 };

// Streetlights along the road network. On by default; toggled from the Roads panel.
// `size` scales the point sprite (×base 6 px); `brightness` scales emissive gain.
// Defaults dialled below 1.0 — on high-DPR mobile the sprite pinned the clamp
// ceiling and read too large/hot.
export const DEFAULT_STREETLIGHTS = { enabled: true, size: 0.8, brightness: 0.85 };

// Distance LOD for the streetlight + traffic point-clouds (#52). RENDER-only:
// lights shrink + dim by CAMERA distance (world metres) past `near`, sitting at
// the floors by `far`, and are dropped entirely past `cull`. Never touches
// generated positions, so gate1 is unaffected. Tuned live per device (the
// RTX 3080ti can afford a far `cull`; the Pixel 6 wants it tighter). Defaults
// scaled to the default orbit distance (radius ~4800) so the near side of the
// city stays full-bright and only the genuinely far/zoomed-out lights attenuate.
export const DEFAULT_LOD = {
  enabled: true,
  near: 3200, // full size/brightness within this camera distance (m)
  far: 9600, // ramp end — size/brightness reach the floors here (m)
  cull: 16000, // drop the light beyond this camera distance (m); generous = off in normal view
  sizeFloor: 0.5, // far size as a fraction of near
  brightnessFloor: 0.4, // far brightness as a fraction of near
  // #55 per-tile culling + lazy materialisation: offscreen tiles of buildings /
  // streetlights / traffic are not materialised at all. Render-only.
  tiles: true,
};

// Organic city footprint (#14). `circle` is the default look — a round footprint
// masked over the fixed square layout. `square` = the original full-square field
// (byte-identical no-op mask). `auto` lets each seed pick its own shape; the
// other values force one shape (the debug switcher). See lib/seed/cityShape.ts.
export const DEFAULT_CITY_SHAPE: CityShapeSetting = "circle";
// City size tier (#58) — the GEN extent. Each tier is a DIFFERENT city for the
// same seed (a bigger canvas re-rolls the layout; it does not grow the current
// city outward). Gen cost ∝ extent²: town ~0.6 s, city ~2.5 s, metro ~8–10 s —
// the City default keeps boot mobile-viable; Metro is opt-in.
export const DEFAULT_CITY_SIZE: CityTier = DEFAULT_CITY_TIER;
// Crop follows the tier while locked (the default): crop = the tier's full disc.
export const DEFAULT_CROP_LOCK = true;
// Circle crop radius as a fraction of the CURRENT tier's gen extent. 1.0 = the
// tier's full disc (the default, lock ON); smaller reveals a core. Only affects
// the `circle` shape. The City-shape "crop" slider drives this, shown in km.
export const DEFAULT_CITY_SHAPE_SCALE = 1.0;

export const DEFAULT_FLY_SPEED = 14;
// 360 at the City size (1500); base scales with the size knob via CITY_SCALE.
export const DEFAULT_ORTHO_SIZE = 180 * CITY_SCALE;
export const DEFAULT_PROJECTION = "orthographic" as const;

// ---------------------------------------------------------------------------
// Settings registry
// ---------------------------------------------------------------------------
// One entry per panel-tunable field. `persist` = included in SavedConfig.
// Reset derives system defaults from `defaultValue`; Save/Copy/Revert derive
// their field lists from `persist: true` entries. Adding a new field here
// automatically wires it into all four actions.
//
// POLICY: any setting a user adjusts that affects the scene's look or behaviour
// MUST be persist:true so Copy / Save / Revert include it. persist:false is
// reserved for TRANSIENT runtime state only — currently: projectionBlend (the
// derived perspective↔ortho tween), orbitPaused, cameraMode, orbitRestore, and
// debug (inspection view modes). When adding a setting, default to persist:true
// and add it to the SavedConfig type.
//
// NOTE: cityPlanning is handled specially — only the three visibility toggles
// participate (showHighways/showDistrictShells/showArterials), not the runtime
// readouts (topologyKind/arterialCount). The `cityPlanningVis` pseudo-key
// encodes that semantics so the registry loops stay uniform.
// ---------------------------------------------------------------------------

type SettingEntry<K extends keyof SceneState> = {
  key: K;
  defaultValue: SceneState[K];
  persist: boolean;
};

// A discriminated union so the registry is typed without needing `any`.
type AnySettingEntry =
  | SettingEntry<"cameraIntent">
  | SettingEntry<"orbit">
  | SettingEntry<"moon">
  | SettingEntry<"moonHalo">
  | SettingEntry<"moonFollowCamera">
  | SettingEntry<"stars">
  | SettingEntry<"projection">
  | SettingEntry<"orthoSize">
  | SettingEntry<"projectionBlend">
  | SettingEntry<"windowAA">
  | SettingEntry<"windowMode">
  | SettingEntry<"windowSimple">
  | SettingEntry<"windowProfiles">
  | SettingEntry<"fog">
  | SettingEntry<"haze">
  | SettingEntry<"flySpeed">
  | SettingEntry<"orbitPaused">
  | SettingEntry<"showFocalIndicator">
  | SettingEntry<"cameraMode">
  | SettingEntry<"orbitRestore">
  | SettingEntry<"topDownTip">
  | SettingEntry<"intro">
  | SettingEntry<"starIntro">
  | SettingEntry<"debug">
  | SettingEntry<"traffic">
  | SettingEntry<"streetlights">
  | SettingEntry<"lod">
  | SettingEntry<"cityShape">
  | SettingEntry<"cityShapeScale">
  | SettingEntry<"citySize">
  | SettingEntry<"cropLock">
  | SettingEntry<"fpsHud">
  | SettingEntry<"fieldDeviation">;

export const SETTINGS_REGISTRY: AnySettingEntry[] = [
  { key: "cameraIntent", defaultValue: DEFAULT_INTENT, persist: true },
  { key: "orbit", defaultValue: DEFAULT_ORBIT, persist: true },
  { key: "moon", defaultValue: DEFAULT_MOON, persist: true },
  { key: "moonHalo", defaultValue: DEFAULT_MOON_HALO, persist: true },
  { key: "moonFollowCamera", defaultValue: false as const, persist: true },
  { key: "stars", defaultValue: DEFAULT_STARS, persist: true },
  { key: "projection", defaultValue: DEFAULT_PROJECTION, persist: true },
  { key: "orthoSize", defaultValue: DEFAULT_ORTHO_SIZE, persist: true },
  {
    key: "projectionBlend",
    defaultValue: DEFAULT_PROJECTION === "orthographic" ? 1 : 0,
    persist: false,
  },
  { key: "windowAA", defaultValue: DEFAULT_WINDOW_AA, persist: true },
  { key: "windowMode", defaultValue: "advanced" as const, persist: true },
  { key: "windowSimple", defaultValue: DEFAULT_WINDOW_SIMPLE, persist: true },
  { key: "windowProfiles", defaultValue: DEFAULT_WINDOW_PROFILES, persist: true },
  { key: "fog", defaultValue: DEFAULT_FOG, persist: true },
  { key: "haze", defaultValue: DEFAULT_HAZE, persist: true },
  { key: "flySpeed", defaultValue: DEFAULT_FLY_SPEED, persist: true },
  { key: "orbitPaused", defaultValue: false as const, persist: false },
  { key: "showFocalIndicator", defaultValue: false as const, persist: true },
  { key: "cameraMode", defaultValue: "orbit" as const, persist: false },
  { key: "orbitRestore", defaultValue: null as SceneState["orbitRestore"], persist: false },
  { key: "topDownTip", defaultValue: 0, persist: false },
  { key: "intro", defaultValue: DEFAULT_INTRO, persist: true },
  { key: "starIntro", defaultValue: DEFAULT_STAR_INTRO, persist: true },
  // persist:false — debug view modes are transient inspection state (wireframe /
  // hidden / tint), not look-and-feel a user would Save/Copy/Revert into a
  // default. Reset still clears them (resetCamera iterates every entry).
  { key: "debug", defaultValue: DEFAULT_DEBUG, persist: false },
  { key: "traffic", defaultValue: DEFAULT_TRAFFIC, persist: true },
  { key: "streetlights", defaultValue: DEFAULT_STREETLIGHTS, persist: true },
  { key: "lod", defaultValue: DEFAULT_LOD, persist: true },
  { key: "cityShape", defaultValue: DEFAULT_CITY_SHAPE, persist: true },
  { key: "cityShapeScale", defaultValue: DEFAULT_CITY_SHAPE_SCALE, persist: true },
  { key: "citySize", defaultValue: DEFAULT_CITY_SIZE, persist: true },
  { key: "cropLock", defaultValue: DEFAULT_CROP_LOCK, persist: true },
  // On-screen FPS badge — persisted so a perf pass survives reloads.
  { key: "fpsHud", defaultValue: false as const, persist: true },
  // Tensor-field deviation scale (#51) — gen input, persisted.
  { key: "fieldDeviation", defaultValue: 1, persist: true },
];

// cityPlanning visibility toggles — persisted separately because `cityPlanning`
// in state also carries runtime readouts (topologyKind, arterialCount) that
// must never be overwritten by Reset/Revert/Save.
const CITY_PLANNING_VIS_PERSIST = true;

const SAVED_CONFIG_KEY = "starry-night.savedConfig";

type SavedConfig = {
  cameraIntent: CameraIntent;
  orbit: OrbitConfig;
  moon: typeof DEFAULT_MOON;
  stars: typeof DEFAULT_STARS;
  // Optional so configs saved before these were added still load.
  fog?: SceneState["fog"];
  haze?: SceneState["haze"];
  projection?: Projection;
  orthoSize?: number;
  windowAA?: typeof DEFAULT_WINDOW_AA;
  windowMode?: "simple" | "advanced";
  windowSimple?: { w: number; h: number };
  windowProfiles?: Record<Archetype, { w: number; h: number }>;
  moonHalo?: typeof DEFAULT_MOON_HALO;
  moonFollowCamera?: boolean;
  flySpeed?: number;
  showFocalIndicator?: boolean;
  intro?: SceneState["intro"];
  starIntro?: SceneState["starIntro"];
  traffic?: SceneState["traffic"];
  streetlights?: SceneState["streetlights"];
  lod?: SceneState["lod"];
  cityShape?: CityShapeSetting;
  cityShapeScale?: number;
  citySize?: CityTier;
  cropLock?: boolean;
  fpsHud?: boolean;
  fieldDeviation?: number;
  // Only the layer-visibility toggles persist — topologyKind / arterialCount
  // are per-seed runtime readouts, not settings.
  cityPlanning?: {
    showHighways: boolean;
    showDistrictShells: boolean;
    showArterials: boolean;
    showStreets: boolean;
  };
};

function readSavedConfig(): SavedConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SAVED_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedConfig & {
      orbit?: { lookAtY?: number; cameraY?: number; lookPitchDeg?: number };
    };
    // Migrate legacy orbit shapes: drop cameraY (no longer stored) and project
    // a saved lookPitchDeg back into an absolute lookAtY at the saved radius.
    if (parsed.orbit) {
      const o = parsed.orbit as {
        lookAtY?: number;
        cameraY?: number;
        lookPitchDeg?: number;
        radius?: number;
        elevationDeg?: number;
      };
      if (o.lookAtY === undefined && o.lookPitchDeg !== undefined) {
        const radius = o.radius ?? DEFAULT_ORBIT.radius;
        const elRad = ((o.elevationDeg ?? 0) * Math.PI) / 180;
        const camY = radius * Math.sin(elRad);
        const horizR = radius * Math.cos(elRad);
        o.lookAtY = camY + horizR * Math.tan((o.lookPitchDeg * Math.PI) / 180);
      }
      delete o.lookPitchDeg;
      delete o.cameraY;
    }
    // Migrate the legacy vestigial star `factor` (drei used ~200); it now means
    // base size in px, so clamp absurd old values back to the default.
    if (parsed.stars && parsed.stars.factor > 80) {
      parsed.stars.factor = DEFAULT_STARS.factor;
    }
    // Forward-fill new fields (e.g. #55 lod.tiles, #26 stars.shootingMin/Max)
    // into configs saved before they existed, so an old save can't silently
    // disable a newer feature.
    if (parsed.lod) parsed.lod = { ...DEFAULT_LOD, ...parsed.lod };
    if (parsed.stars) parsed.stars = { ...DEFAULT_STARS, ...parsed.stars };
    return parsed as SavedConfig;
  } catch {
    return null;
  }
}

function writeSavedConfig(snap: SavedConfig) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_CONFIG_KEY, JSON.stringify(snap));
  } catch {
    // localStorage may be unavailable in private modes — saving is best effort
  }
}

export type Perf = {
  fps: number;
  triangles: number;
  calls: number;
  geometries: number;
  textures: number;
};

type SceneState = {
  masterSeed: string;
  lightingMode: LightingMode;
  qualityTier: QualityTier;
  paused: boolean;
  captureMode: boolean;
  setCaptureMode: (captureMode: boolean) => void;
  moonFollowCamera: boolean;
  setMoonFollowCamera: (v: boolean) => void;
  stars: typeof DEFAULT_STARS;
  setStars: (patch: Partial<typeof DEFAULT_STARS>) => void;
  windowAA: typeof DEFAULT_WINDOW_AA;
  setWindowAA: (patch: Partial<typeof DEFAULT_WINDOW_AA>) => void;
  windowMode: "simple" | "advanced";
  setWindowMode: (mode: "simple" | "advanced") => void;
  windowSimple: { w: number; h: number };
  setWindowSimple: (patch: Partial<{ w: number; h: number }>) => void;
  windowProfiles: Record<Archetype, { w: number; h: number }>;
  setWindowProfile: (arch: Archetype, patch: Partial<{ w: number; h: number }>) => void;
  moon: {
    // Celestial body modelled on a sky dome around the city axis.
    azimuthDeg: number; // compass yaw, 0 = +z (north), 90 = +x (east)
    elevationDeg: number; // angle above horizon, 0 = horizon, 90 = zenith
    distance: number; // radial distance from city centre; default tracks stars.radius
    radiusRatio: number; // moon radius as a fraction of stars.radius
  };
  setMoon: (patch: Partial<SceneState["moon"]>) => void;
  moonHalo: {
    radiusMul: number;
    innerRadius: number;
    intensity: number;
  };
  setMoonHalo: (patch: Partial<SceneState["moonHalo"]>) => void;
  moonLive: {
    position: Vec3;
    azimuthDeg: number;
    elevationDeg: number;
    distance: number;
  };
  setMoonLive: (live: SceneState["moonLive"]) => void;
  cameraMode: CameraMode;
  cameraIntent: CameraIntent;
  cameraLive: CameraLive;
  cameraTweenRequest: TweenRequest | null;
  // Projection model. We keep a single perspective camera under the hood; ortho
  // is implemented by overriding camera.projectionMatrix each frame using an
  // orthographic matrix derived from orthoSize. `projectionBlend` (0..1) drives
  // a GSAP tween between perspective (0) and orthographic (1) for smooth swaps.
  projection: Projection;
  orthoSize: number; // half-height of ortho frustum, in world units
  projectionBlend: number;
  setProjection: (p: Projection) => void;
  setOrthoSize: (s: number) => void;
  setProjectionBlend: (b: number) => void;
  // Fly-mode movement speed, in m/s. Mouse wheel scales it multiplicatively
  // while flying (UE5-style); Shift sprints at FLY_SPRINT_MULTIPLIER.
  flySpeed: number;
  setFlySpeed: (v: number) => void;
  fog: {
    enabled: boolean;
    mode: "linear" | "exp2";
    color: string;
    near: number;
    far: number;
    density: number;
  };
  setFog: (
    patch: Partial<{
      enabled: boolean;
      mode: "linear" | "exp2";
      color: string;
      near: number;
      far: number;
      density: number;
    }>,
  ) => void;
  haze: {
    enabled: boolean;
    color: string;
    topY: number; // world Y where haze fades to zero
    bottomY: number; // world Y where haze hits full strength
    intensity: number; // 0..2 multiplier on emissive output
    radius: number; // sphere radius around city centre
  };
  setHaze: (patch: Partial<SceneState["haze"]>) => void;
  // Visibility of the orbit focal-point crosshair.
  showFocalIndicator: boolean;
  setShowFocalIndicator: (v: boolean) => void;
  // Intro / wake-up sequence (After-Dark model). progress 0..1 = cascade
  // completion for the UI readout; the actual wake / on-off cycle is
  // time-driven in the shader. mode selects ordering across cells.
  intro: {
    progress: number;
    playing: boolean;
    durationSec: number;
    // Streetlights wake over their own (shorter) duration, independent of the
    // multi-minute window wake.
    streetlightDurationSec: number;
    mode: "random" | "district" | "outside-in" | "far-to-near" | "inside-out";
    // Seconds a window stays ON after wake (per-cell jitter applied).
    offCycleSec: number;
    // Seconds a window stays OFF between ONs (per-cell jitter applied).
    retriggerSec: number;
    // Per-window jitter amplitude on offCycle + retrigger: 0 = every window
    // cycles in lockstep, 1 = each window's cycle length ranges 0..2× base.
    cycleJitter: number;
  };
  // Star intro — independent from the window intro so stars can wake on their
  // own timing + ordering.
  starIntro: {
    progress: number;
    playing: boolean;
    durationSec: number;
    mode: "random" | "bright-first" | "horizon-first" | "zenith-first";
  };
  setIntroProgress: (v: number) => void;
  setIntroPlaying: (v: boolean) => void;
  setIntroDuration: (v: number) => void;
  setStreetlightDuration: (v: number) => void;
  setIntroMode: (m: SceneState["intro"]["mode"]) => void;
  setOffCycle: (v: number) => void;
  setRetrigger: (v: number) => void;
  setCycleJitter: (v: number) => void;
  playIntro: () => void;
  setStarIntroProgress: (v: number) => void;
  setStarIntroPlaying: (v: boolean) => void;
  setStarIntroDuration: (v: number) => void;
  setStarIntroMode: (m: SceneState["starIntro"]["mode"]) => void;
  playStarIntro: () => void;
  playAllIntros: () => void;
  // Runtime flag set true while the user is holding RMB in orbit mode to drag
  // the focal Y. Used to brighten the focal indicator while editing.
  focalDragging: boolean;
  setFocalDragging: (v: boolean) => void;
  // Orbit auto-revolution pause. Toggled with Space in orbit mode; useFrame
  // skips advancing the sweep while true. Manual drag still works.
  orbitPaused: boolean;
  setOrbitPaused: (v: boolean) => void;
  orbit: OrbitConfig;
  setOrbit: (patch: Partial<OrbitConfig>) => void;
  // Snapshot of the pre-top-down orbit/projection state. Captured when the
  // Top-down preset is triggered in orbit mode (#18); consumed by the Default
  // preset (#19) to restore the prior framing. Null when no top-down is active.
  orbitRestore: {
    elevationDeg: number;
    radius: number;
    orthoSize: number;
    paused: boolean;
  } | null;
  setOrbitRestore: (r: SceneState["orbitRestore"]) => void;
  // Top-down "north up" camera roll, 0 = world-up .. 1 = tipped to +Z. Tweened
  // over the whole top-down transition so the roll eases in with the arc instead
  // of snapping in the final elevation degrees. CameraControls maxes it with the
  // elevation-keyed tip so manual high-elevation orbit still avoids gimbal.
  topDownTip: number;
  setTopDownTip: (v: number) => void;
  // Streets-first city-planning layer visibility + readouts (Stage 1).
  // Gated in the UI behind the ?stage1=1 flag until the rewrite is default.
  cityPlanning: {
    showHighways: boolean;
    showDistrictShells: boolean;
    showArterials: boolean;
    showStreets: boolean;
    topologyKind: TopologyKind | null;
    highwayCount: number;
    arterialCount: number;
    streetCount: number;
  };
  setCityPlanning: (patch: Partial<SceneState["cityPlanning"]>) => void;
  setTopologyKind: (kind: TopologyKind) => void;
  setHighwayCount: (n: number) => void;
  setArterialCount: (n: number) => void;
  setStreetCount: (n: number) => void;
  // Debug view modes — building tint + per-group render mode (Slices A/B).
  debug: typeof DEFAULT_DEBUG;
  setBuildingTint: (patch: Partial<{ mode: BuildingTintMode; intensity: number }>) => void;
  setRenderMode: (group: RenderGroup, mode: RenderMode) => void;
  setAllRenderModes: (mode: RenderMode) => void;
  setRenderModes: (modes: Record<RenderGroup, RenderMode>) => void;
  setShowTensorField: (v: boolean) => void;
  // Organic city footprint (#14) — gen input; changing it regenerates the city.
  cityShape: CityShapeSetting;
  setCityShape: (cityShape: CityShapeSetting) => void;
  cityShapeScale: number;
  setCityShapeScale: (cityShapeScale: number) => void;
  citySize: CityTier;
  setCitySize: (citySize: CityTier) => void;
  cropLock: boolean;
  setCropLock: (cropLock: boolean) => void;
  // Sketch-driven city (#40) — gen input; a registered sketch's field + ink
  // mask replace the seeded basis field. Session-only (not persisted): re-drop
  // the sketch on /tensor to restore it.
  citySketch: SketchTensorSource | null;
  setCitySketch: (citySketch: SketchTensorSource | null) => void;
  // On-screen FPS badge (FpsHud) — toggled from the Performance section.
  fpsHud: boolean;
  setFpsHud: (fpsHud: boolean) => void;
  // Tensor-field deviation scale (#51) — gen input; 1 = the seeded default,
  // <1 calms every city, >1 deforms harder. Changing it regenerates.
  fieldDeviation: number;
  setFieldDeviation: (fieldDeviation: number) => void;
  // Ambient traffic (research D) — opt-in car head/tail-lights.
  traffic: typeof DEFAULT_TRAFFIC;
  setTraffic: (patch: Partial<typeof DEFAULT_TRAFFIC>) => void;
  streetlights: typeof DEFAULT_STREETLIGHTS;
  setStreetlights: (patch: Partial<typeof DEFAULT_STREETLIGHTS>) => void;
  lod: typeof DEFAULT_LOD;
  setLod: (patch: Partial<typeof DEFAULT_LOD>) => void;
  perf: Perf;
  setPerf: (perf: Perf) => void;
  setSeed: (seed: string) => void;
  setLightingMode: (mode: LightingMode) => void;
  setQualityTier: (tier: QualityTier) => void;
  setPaused: (paused: boolean) => void;
  setCameraMode: (mode: CameraMode) => void;
  setCameraIntent: (intent: Partial<CameraIntent>) => void;
  setCameraLive: (live: CameraLive) => void;
  resetCamera: () => void;
  saveCurrentAsDefault: () => void;
  revertToSaved: () => void;
  hasSavedConfig: () => boolean;
  copyableConfig: () => Record<string, unknown>;
  snapIntentToLive: () => void;
  tweenCameraTo: (to: CameraIntent, durationMs?: number) => void;
  clearCameraTweenRequest: () => void;
};

export const useSceneStore = create<SceneState>((set, get) => ({
  masterSeed: "starry-night-0",
  lightingMode: "classic",
  qualityTier: "high",
  paused: false,
  captureMode: false,
  setCaptureMode: (captureMode) => set({ captureMode }),
  moonFollowCamera: false,
  setMoonFollowCamera: (moonFollowCamera) => set({ moonFollowCamera }),
  stars: DEFAULT_STARS,
  setStars: (patch) => set((s) => ({ stars: { ...s.stars, ...patch } })),
  windowAA: DEFAULT_WINDOW_AA,
  setWindowAA: (patch) => set((s) => ({ windowAA: { ...s.windowAA, ...patch } })),
  windowMode: "advanced",
  setWindowMode: (windowMode) => set({ windowMode }),
  windowSimple: DEFAULT_WINDOW_SIMPLE,
  setWindowSimple: (patch) => set((s) => ({ windowSimple: { ...s.windowSimple, ...patch } })),
  windowProfiles: DEFAULT_WINDOW_PROFILES,
  setWindowProfile: (arch, patch) =>
    set((s) => ({
      windowProfiles: { ...s.windowProfiles, [arch]: { ...s.windowProfiles[arch], ...patch } },
    })),
  // Defaults preserve the old (3742, 2321, 200) position:
  //   distance = sqrt(3742² + 2321²) ≈ 4403
  //   elevation = asin(2321 / 4403) ≈ 31.8°
  //   azimuth   = 200°
  // Distance default sits on the star dome (4500) so moon hugs the celestial sphere.
  moon: DEFAULT_MOON,
  setMoon: (patch) => set((s) => ({ moon: { ...s.moon, ...patch } })),
  moonHalo: DEFAULT_MOON_HALO,
  setMoonHalo: (patch) => set((s) => ({ moonHalo: { ...s.moonHalo, ...patch } })),
  moonLive: { position: [0, 0, 0], azimuthDeg: 0, elevationDeg: 0, distance: 0 },
  setMoonLive: (moonLive) => set({ moonLive }),
  // Note: cameraMode default is "orbit" — see below.
  cameraMode: "orbit",
  cameraIntent: DEFAULT_INTENT,
  cameraLive: {
    position: DEFAULT_INTENT.position,
    rotation: [0, 0, 0],
    fov: DEFAULT_INTENT.fov,
  },
  cameraTweenRequest: null,
  projection: DEFAULT_PROJECTION,
  orthoSize: DEFAULT_ORTHO_SIZE,
  projectionBlend: 1,
  setProjection: (projection) => set({ projection }),
  setOrthoSize: (orthoSize) => set({ orthoSize }),
  setProjectionBlend: (projectionBlend) => set({ projectionBlend }),
  flySpeed: DEFAULT_FLY_SPEED,
  setFlySpeed: (flySpeed) => set({ flySpeed }),
  fog: DEFAULT_FOG,
  setFog: (patch) => set((s) => ({ fog: { ...s.fog, ...patch } })),
  haze: DEFAULT_HAZE,
  setHaze: (patch) => set((s) => ({ haze: { ...s.haze, ...patch } })),
  showFocalIndicator: false,
  setShowFocalIndicator: (showFocalIndicator) => set({ showFocalIndicator }),
  intro: DEFAULT_INTRO,
  starIntro: DEFAULT_STAR_INTRO,
  setIntroProgress: (progress) => set((s) => ({ intro: { ...s.intro, progress } })),
  setIntroPlaying: (playing) => set((s) => ({ intro: { ...s.intro, playing } })),
  setIntroDuration: (durationSec) => set((s) => ({ intro: { ...s.intro, durationSec } })),
  setStreetlightDuration: (streetlightDurationSec) =>
    set((s) => ({ intro: { ...s.intro, streetlightDurationSec } })),
  setIntroMode: (mode) => set((s) => ({ intro: { ...s.intro, mode } })),
  setOffCycle: (offCycleSec) => set((s) => ({ intro: { ...s.intro, offCycleSec } })),
  setRetrigger: (retriggerSec) => set((s) => ({ intro: { ...s.intro, retriggerSec } })),
  setCycleJitter: (cycleJitter) => set((s) => ({ intro: { ...s.intro, cycleJitter } })),
  playIntro: () => set((s) => ({ intro: { ...s.intro, progress: 0, playing: true } })),
  setStarIntroProgress: (progress) => set((s) => ({ starIntro: { ...s.starIntro, progress } })),
  setStarIntroPlaying: (playing) => set((s) => ({ starIntro: { ...s.starIntro, playing } })),
  setStarIntroDuration: (durationSec) =>
    set((s) => ({ starIntro: { ...s.starIntro, durationSec } })),
  setStarIntroMode: (mode) => set((s) => ({ starIntro: { ...s.starIntro, mode } })),
  playStarIntro: () => set((s) => ({ starIntro: { ...s.starIntro, progress: 0, playing: true } })),
  playAllIntros: () =>
    set((s) => ({
      intro: { ...s.intro, progress: 0, playing: true },
      starIntro: { ...s.starIntro, progress: 0, playing: true },
    })),
  focalDragging: false,
  setFocalDragging: (focalDragging) => set({ focalDragging }),
  orbitPaused: false,
  setOrbitPaused: (orbitPaused) => set({ orbitPaused }),
  orbit: DEFAULT_ORBIT,
  setOrbit: (patch) => set((s) => ({ orbit: { ...s.orbit, ...patch } })),
  orbitRestore: null,
  setOrbitRestore: (orbitRestore) => set({ orbitRestore }),
  topDownTip: 0,
  setTopDownTip: (topDownTip) => set({ topDownTip }),
  cityPlanning: {
    // Planning overlays are review aids, not part of the ambient screensaver —
    // the streets-first network still shapes the city, it just isn't drawn over
    // it by default. Toggle them from the Districts/Roads panels, or use /plan.
    showHighways: false,
    showDistrictShells: false,
    showArterials: false,
    showStreets: false,
    topologyKind: null,
    highwayCount: 0,
    arterialCount: 0,
    streetCount: 0,
  },
  setCityPlanning: (patch) => set((s) => ({ cityPlanning: { ...s.cityPlanning, ...patch } })),
  setTopologyKind: (topologyKind) =>
    set((s) =>
      s.cityPlanning.topologyKind === topologyKind
        ? s
        : { cityPlanning: { ...s.cityPlanning, topologyKind } },
    ),
  setArterialCount: (arterialCount) =>
    set((s) =>
      s.cityPlanning.arterialCount === arterialCount
        ? s
        : { cityPlanning: { ...s.cityPlanning, arterialCount } },
    ),
  setHighwayCount: (highwayCount) =>
    set((s) =>
      s.cityPlanning.highwayCount === highwayCount
        ? s
        : { cityPlanning: { ...s.cityPlanning, highwayCount } },
    ),
  setStreetCount: (streetCount) =>
    set((s) =>
      s.cityPlanning.streetCount === streetCount
        ? s
        : { cityPlanning: { ...s.cityPlanning, streetCount } },
    ),
  debug: DEFAULT_DEBUG,
  setBuildingTint: (patch) =>
    set((s) => ({ debug: { ...s.debug, buildingTint: { ...s.debug.buildingTint, ...patch } } })),
  setRenderMode: (group, mode) =>
    set((s) => ({ debug: { ...s.debug, renderModes: { ...s.debug.renderModes, [group]: mode } } })),
  setAllRenderModes: (mode) =>
    set((s) => ({
      debug: {
        ...s.debug,
        renderModes: { buildings: mode, roads: mode, ground: mode, sky: mode, moon: mode },
      },
    })),
  setRenderModes: (renderModes) => set((s) => ({ debug: { ...s.debug, renderModes } })),
  setShowTensorField: (v) => set((s) => ({ debug: { ...s.debug, showTensorField: v } })),
  cityShape: DEFAULT_CITY_SHAPE,
  setCityShape: (cityShape) => set({ cityShape }),
  cityShapeScale: DEFAULT_CITY_SHAPE_SCALE,
  setCityShapeScale: (cityShapeScale) => set({ cityShapeScale }),
  citySize: DEFAULT_CITY_SIZE,
  // Tier switch (#58): re-rolls the layout (the city is a function of seed +
  // extent). Locked crop snaps to the new tier's full disc; unlocked preserves
  // the ABSOLUTE crop km where possible (clamped to the new tier).
  setCitySize: (citySize) =>
    set((s) => {
      const oldHalf = CITY_TIERS[s.citySize];
      const newHalf = CITY_TIERS[citySize];
      const cityShapeScale = s.cropLock ? 1 : Math.min(1, (s.cityShapeScale * oldHalf) / newHalf);
      return { citySize, cityShapeScale };
    }),
  cropLock: DEFAULT_CROP_LOCK,
  // Locking snaps the crop to the tier's full disc (that's what "locked" shows).
  setCropLock: (cropLock) => set(cropLock ? { cropLock, cityShapeScale: 1 } : { cropLock }),
  citySketch: null,
  setCitySketch: (citySketch) => set({ citySketch }),
  fpsHud: false,
  setFpsHud: (fpsHud) => set({ fpsHud }),
  fieldDeviation: 1,
  setFieldDeviation: (fieldDeviation) => set({ fieldDeviation }),
  traffic: DEFAULT_TRAFFIC,
  setTraffic: (patch) => set((s) => ({ traffic: { ...s.traffic, ...patch } })),
  streetlights: DEFAULT_STREETLIGHTS,
  setStreetlights: (patch) => set((s) => ({ streetlights: { ...s.streetlights, ...patch } })),
  lod: DEFAULT_LOD,
  setLod: (patch) => set((s) => ({ lod: { ...s.lod, ...patch } })),
  perf: { fps: 0, triangles: 0, calls: 0, geometries: 0, textures: 0 },
  setPerf: (perf) => set({ perf }),
  setSeed: (masterSeed) => set({ masterSeed }),
  setLightingMode: (lightingMode) => set({ lightingMode }),
  setQualityTier: (qualityTier) => set({ qualityTier }),
  setPaused: (paused) => set({ paused }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setCameraIntent: (intent) =>
    set((s) => ({
      cameraIntent: {
        ...s.cameraIntent,
        ...intent,
        ...(intent.lookAt ? { lookAt: roundVec3(intent.lookAt) } : {}),
      },
    })),
  setCameraLive: (cameraLive) => set({ cameraLive }),
  resetCamera: () => {
    // Derive reset patch from the registry: every entry goes back to its
    // hardcoded defaultValue. Runtime readouts (cityPlanning.topologyKind /
    // arterialCount, perf, live values) are preserved.
    set((s) => {
      const patch: Partial<SceneState> = {};
      for (const entry of SETTINGS_REGISTRY) {
        (patch as Record<string, unknown>)[entry.key] = entry.defaultValue;
      }
      // cityPlanning visibility toggles only — preserve runtime readouts.
      patch.cityPlanning = { ...s.cityPlanning, ...DEFAULT_CITY_PLANNING_VIS };
      return patch;
    });
  },
  saveCurrentAsDefault: () => {
    const s = get();
    // Build SavedConfig from persist:true registry entries.
    const snap: Partial<SavedConfig> = {};
    for (const entry of SETTINGS_REGISTRY) {
      if (entry.persist) {
        (snap as Record<string, unknown>)[entry.key] = s[entry.key];
      }
    }
    // cityPlanning visibility toggles — persisted, but only the three toggles.
    if (CITY_PLANNING_VIS_PERSIST) {
      snap.cityPlanning = {
        showHighways: s.cityPlanning.showHighways,
        showDistrictShells: s.cityPlanning.showDistrictShells,
        showArterials: s.cityPlanning.showArterials,
        showStreets: s.cityPlanning.showStreets,
      };
    }
    writeSavedConfig(snap as SavedConfig);
  },
  revertToSaved: () => {
    // Load the last SavedConfig (with migration applied) and apply persisted
    // fields back to state. If no saved config exists, this is a no-op.
    const saved = readSavedConfig();
    if (!saved) return;
    set((s) => {
      const patch: Partial<SceneState> = {};
      for (const entry of SETTINGS_REGISTRY) {
        if (entry.persist) {
          const savedValue = (saved as Record<string, unknown>)[entry.key];
          if (savedValue !== undefined) {
            (patch as Record<string, unknown>)[entry.key] = savedValue;
          }
        }
      }
      // cityPlanning visibility toggles — preserve runtime readouts.
      if (saved.cityPlanning !== undefined) {
        patch.cityPlanning = { ...s.cityPlanning, ...saved.cityPlanning };
      }
      return patch;
    });
  },
  hasSavedConfig: () => readSavedConfig() !== null,
  copyableConfig: () => {
    const s = get();
    const out: Record<string, unknown> = {};
    for (const entry of SETTINGS_REGISTRY) {
      if (entry.persist) {
        out[entry.key] = s[entry.key];
      }
    }
    // cityPlanning visibility toggles only.
    if (CITY_PLANNING_VIS_PERSIST) {
      out.cityPlanning = {
        showHighways: s.cityPlanning.showHighways,
        showDistrictShells: s.cityPlanning.showDistrictShells,
        showArterials: s.cityPlanning.showArterials,
        showStreets: s.cityPlanning.showStreets,
      };
    }
    return out;
  },
  tweenCameraTo: (to, durationMs = 1000) =>
    set({ cameraTweenRequest: { to, durationMs }, cameraMode: "still" }),
  clearCameraTweenRequest: () => set({ cameraTweenRequest: null }),
  snapIntentToLive: () => {
    const live = get().cameraLive;
    const pos = live.position;
    const yaw = live.rotation[1];
    const pitch = live.rotation[0];
    const dist = 10;
    const fx = pos[0] - Math.sin(yaw) * Math.cos(pitch) * dist;
    const fy = pos[1] + Math.sin(pitch) * dist;
    const fz = pos[2] - Math.cos(yaw) * Math.cos(pitch) * dist;
    set((s) => ({
      cameraIntent: {
        ...s.cameraIntent,
        position: pos,
        lookAt: [fx, fy, fz],
        rotation: live.rotation,
        fov: live.fov,
        orient: "lookAt",
      },
    }));
  },
}));

// Keep lib/seed's module-level gen extent in lockstep with the store's tier
// (#58). A subscription (not just the setter) so EVERY path that writes
// `citySize` — setCitySize, Reset, Revert, saved-config load — syncs the
// generators before their next call. Initial sync covers a persisted boot value.
setCityTier(useSceneStore.getState().citySize);
useSceneStore.subscribe((s, prev) => {
  if (s.citySize !== prev.citySize) setCityTier(s.citySize);
});

// Same lockstep for the sketch registry (#40): the store is the source of
// truth, lib/seed/citySketch is the module mirror the generators read.
setCitySketch(useSceneStore.getState().citySketch);
useSceneStore.subscribe((s, prev) => {
  if (s.citySketch !== prev.citySketch) setCitySketch(s.citySketch);
});

// ...and the tensor-field deviation scale (#51).
setFieldDeviationModule(useSceneStore.getState().fieldDeviation);
useSceneStore.subscribe((s, prev) => {
  if (s.fieldDeviation !== prev.fieldDeviation) setFieldDeviationModule(s.fieldDeviation);
});
