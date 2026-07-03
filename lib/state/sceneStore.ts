import { create } from "zustand";

import { CITY_TIERS, setCityTier } from "@/lib/seed/topology";
import type { CityTier, TopologyKind } from "@/lib/seed/topology";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { Archetype } from "@/lib/seed/cityGen";
import { setCitySketch } from "@/lib/seed/citySketch";
import { setFieldDeviation as setFieldDeviationModule } from "@/lib/seed/tensorField";
import {
  setDensityProfile as setDensityProfileModule,
  type DensityProfile,
} from "@/lib/seed/density";
import type { SketchTensorSource } from "@/lib/sketch/orientationField";

// ---------------------------------------------------------------------------
// Re-export everything from the sub-files so existing importers of
// "@/lib/state/sceneStore" continue to resolve without changes.
// ---------------------------------------------------------------------------
export type {
  LightingMode,
  QualityTier,
  CameraMode,
  CameraModelId,
  Projection,
  Vec3,
  OrientSource,
  CameraIntent,
  CameraLive,
  OrbitConfig,
  DriftConfig,
  Snv2Config,
  TurntableConfig,
  TweenRequest,
  WindowRange,
  WindowProfile,
  BuildingTintMode,
  RenderGroup,
  RenderMode,
  Perf,
} from "./sceneTypes";
export { round3, roundVec3 } from "./sceneTypes";

export {
  QUALITY_TIERS,
  DEFAULT_INTENT,
  TOP_DOWN_INTENT,
  PRESETS,
  DEFAULT_ORBIT,
  DEFAULT_DRIFT,
  DEFAULT_SNV2,
  DEFAULT_TURNTABLE,
  DEFAULT_MOON,
  DEFAULT_STARS,
  DEFAULT_WINDOW_AA,
  DEFAULT_FACADE,
  DEFAULT_WINDOW_SIMPLE,
  DEFAULT_WINDOW_PROFILES,
  DEFAULT_MOON_HALO,
  DEFAULT_FOG,
  DEFAULT_HAZE,
  DEFAULT_INTRO,
  DEFAULT_STAR_INTRO,
  DEFAULT_CITY_PLANNING_VIS,
  RENDER_GROUPS,
  DEFAULT_DEBUG,
  DEBUG_WIRE_COLOR,
  DEFAULT_TRAFFIC,
  DEFAULT_STREETLIGHTS,
  DEFAULT_LOD,
  DEFAULT_CITY_SHAPE,
  DEFAULT_CITY_SIZE,
  DEFAULT_CROP_LOCK,
  DEFAULT_CITY_SHAPE_SCALE,
  DEFAULT_FLY_SPEED,
  DEFAULT_ORTHO_SIZE,
  DEFAULT_PROJECTION,
  DEFAULT_PERSP_RADIUS,
} from "./sceneDefaults";

export { hasSavedQualityTier } from "./sceneMigration";

// ---------------------------------------------------------------------------
// Local imports from sub-files (used by the store implementation below)
// ---------------------------------------------------------------------------
import type {
  LightingMode,
  QualityTier,
  CameraMode,
  CameraModelId,
  Projection,
  Vec3,
  CameraIntent,
  CameraLive,
  OrbitConfig,
  DriftConfig,
  Snv2Config,
  TurntableConfig,
  TweenRequest,
  WindowRange,
  WindowProfile,
  BuildingTintMode,
  RenderGroup,
  RenderMode,
  Perf,
} from "./sceneTypes";
import { roundVec3 } from "./sceneTypes";
import {
  DEFAULT_INTENT,
  DEFAULT_ORBIT,
  DEFAULT_DRIFT,
  DEFAULT_SNV2,
  DEFAULT_TURNTABLE,
  DEFAULT_MOON,
  DEFAULT_STARS,
  DEFAULT_WINDOW_AA,
  DEFAULT_FACADE,
  DEFAULT_WINDOW_SIMPLE,
  DEFAULT_WINDOW_PROFILES,
  DEFAULT_MOON_HALO,
  DEFAULT_FOG,
  DEFAULT_HAZE,
  DEFAULT_INTRO,
  DEFAULT_STAR_INTRO,
  DEFAULT_CITY_PLANNING_VIS,
  DEFAULT_DEBUG,
  DEFAULT_TRAFFIC,
  DEFAULT_STREETLIGHTS,
  DEFAULT_LOD,
  DEFAULT_CITY_SHAPE,
  DEFAULT_CITY_SIZE,
  DEFAULT_CROP_LOCK,
  DEFAULT_CITY_SHAPE_SCALE,
  DEFAULT_FLY_SPEED,
  DEFAULT_ORTHO_SIZE,
  DEFAULT_PROJECTION,
  DEFAULT_DENSITY_PROFILE,
} from "./sceneDefaults";
import {
  readSavedConfig,
  writeSavedConfig,
  removeSavedConfig,
  type SavedConfig,
} from "./sceneMigration";

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
// derived perspective↔ortho tween), orbitRestore, topDownTip, and debug
// (inspection view modes). When adding a setting, default to persist:true
// and add it to the SavedConfig type.
//
// cameraMode + orbitPaused became persist:true on 2026-06-08: with boot
// hydration, "Save" promises the camera comes back EXACTLY as saved — a still
// pose must not boot into a revolving orbit (user: "saved with default camera
// but that doesn't seem to stick").
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
  | SettingEntry<"qualityTier">
  | SettingEntry<"qualityUserSet">
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
  | SettingEntry<"facade">
  | SettingEntry<"windowLights">
  | SettingEntry<"windowMode">
  | SettingEntry<"windowSimple">
  | SettingEntry<"windowProfiles">
  | SettingEntry<"fog">
  | SettingEntry<"haze">
  | SettingEntry<"flySpeed">
  | SettingEntry<"orbitPaused">
  | SettingEntry<"showFocalIndicator">
  | SettingEntry<"orbitPivotFromBottom">
  | SettingEntry<"groundFraming">
  | SettingEntry<"groundFrameLow">
  | SettingEntry<"rotateLowAngleGain">
  | SettingEntry<"rotateSlowBelowDeg">
  | SettingEntry<"tiltSpeed">
  | SettingEntry<"showSideView">
  | SettingEntry<"orbitZoomToPin">
  | SettingEntry<"allowUnderview">
  | SettingEntry<"cameraMode">
  | SettingEntry<"cameraModel">
  | SettingEntry<"drift">
  | SettingEntry<"snv2">
  | SettingEntry<"turntable">
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
  | SettingEntry<"liveViewLink">
  | SettingEntry<"fieldDeviation">
  | SettingEntry<"densityProfile">
  | SettingEntry<"antialias">
  | SettingEntry<"dprCap">
  | SettingEntry<"adaptive">
  | SettingEntry<"perfStats">;

export const SETTINGS_REGISTRY: AnySettingEntry[] = [
  // Quality tier persists so a user's pick (or a saved config's tier) survives
  // reload; its presence in a SavedConfig is also the signal that suppresses the
  // boot device-fit (#53). qualityUserSet is transient — a fresh tab re-fits.
  { key: "qualityTier", defaultValue: "high" as QualityTier, persist: true },
  { key: "qualityUserSet", defaultValue: false as const, persist: false },
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
  { key: "facade", defaultValue: DEFAULT_FACADE, persist: true },
  // Debug aid (Windows header switch) — deliberately not persisted, so a
  // reload / Reset can't leave the city mysteriously dark.
  { key: "windowLights", defaultValue: true, persist: false },
  { key: "windowMode", defaultValue: "advanced" as const, persist: true },
  { key: "windowSimple", defaultValue: DEFAULT_WINDOW_SIMPLE, persist: true },
  { key: "windowProfiles", defaultValue: DEFAULT_WINDOW_PROFILES, persist: true },
  { key: "fog", defaultValue: DEFAULT_FOG, persist: true },
  { key: "haze", defaultValue: DEFAULT_HAZE, persist: true },
  { key: "flySpeed", defaultValue: DEFAULT_FLY_SPEED, persist: true },
  { key: "orbitPaused", defaultValue: false as const, persist: true },
  { key: "showFocalIndicator", defaultValue: false as const, persist: true },
  { key: "orbitPivotFromBottom", defaultValue: 0.37, persist: true },
  { key: "groundFraming", defaultValue: true as const, persist: true },
  { key: "groundFrameLow", defaultValue: 0.07, persist: true },
  { key: "rotateLowAngleGain", defaultValue: 0.35, persist: true },
  { key: "rotateSlowBelowDeg", defaultValue: 20, persist: true },
  { key: "tiltSpeed", defaultValue: 0.5, persist: true },
  // Side-view diagram overlay — a transient inspection aid (like the debug view modes), so it
  // resets off on reload and stays out of Saved / Copied configs.
  { key: "showSideView", defaultValue: false as const, persist: false },
  { key: "orbitZoomToPin", defaultValue: true as const, persist: false },
  { key: "allowUnderview", defaultValue: false as const, persist: false },
  { key: "cameraMode", defaultValue: "orbit" as const, persist: true },
  { key: "cameraModel", defaultValue: "snv2" as const, persist: true },
  { key: "drift", defaultValue: DEFAULT_DRIFT, persist: true },
  { key: "snv2", defaultValue: DEFAULT_SNV2, persist: true },
  { key: "turntable", defaultValue: DEFAULT_TURNTABLE, persist: true },
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
  // Live view link: mirror the camera pose into the address bar (?seed=&cam=)
  // as it moves, Google-Maps style. Persisted; off by default.
  { key: "liveViewLink", defaultValue: false as const, persist: true },
  // Tensor-field deviation scale (#51) — gen input, persisted.
  { key: "fieldDeviation", defaultValue: 1.5, persist: true },
  // Population profile (#49) — gen input, persisted.
  { key: "densityProfile", defaultValue: DEFAULT_DENSITY_PROFILE, persist: true },
  // Perf overrides (user 2026-06-13): MSAA off by default; dpr cap null = auto (tier).
  { key: "antialias", defaultValue: false as const, persist: true },
  { key: "dprCap", defaultValue: null as SceneState["dprCap"], persist: true },
  // Adaptive quality + detailed perf overlay — settings (URL ?adaptive/?perf set them on boot).
  { key: "adaptive", defaultValue: false as const, persist: true },
  { key: "perfStats", defaultValue: false as const, persist: true },
];

// cityPlanning visibility toggles — persisted separately because `cityPlanning`
// in state also carries runtime readouts (topologyKind, arterialCount) that
// must never be overwritten by Reset/Revert/Save.
const CITY_PLANNING_VIS_PERSIST = true;

type SceneState = {
  masterSeed: string;
  lightingMode: LightingMode;
  qualityTier: QualityTier;
  // True once the tier has been chosen by the USER — the Performance tier select,
  // or the ?quality= URL param. The boot device-fit (applyDeviceFit) and the
  // runtime AdaptiveQuality monitor both back off when this is set, so an explicit
  // pick is never overridden by auto-tuning. Transient (persist:false): a saved
  // tier survives reload on its own (qualityTier is persisted), and a fresh tab
  // with no ?quality= should always re-fit the current device. (#53)
  qualityUserSet: boolean;
  setQualityUserSet: (v: boolean) => void;
  // Canvas MSAA. Off by default (perf): hardware multisampling is fill-rate cost
  // that compounds with DPR. Cannot change live (WebGL context-creation flag) —
  // Scene remounts the canvas on change. (user 2026-06-13)
  antialias: boolean;
  setAntialias: (v: boolean) => void;
  // Manual device-pixel-ratio cap. null = auto (the quality tier's dprMax range).
  // A number pins a fixed DPR. Live (renderer.setPixelRatio) — no reload.
  dprCap: number | null;
  setDprCap: (v: number | null) => void;
  // Adaptive quality (AdaptiveQuality): device-fit tier+radius on enable + dynamic
  // DPR regression. Off by default. (?adaptive URL just sets this on boot.)
  adaptive: boolean;
  setAdaptive: (v: boolean) => void;
  // Show the detailed perf overlay (PerfOverlay HUD). Off by default. (?perf URL
  // just sets this on boot.)
  perfStats: boolean;
  setPerfStats: (v: boolean) => void;
  paused: boolean;
  captureMode: boolean;
  setCaptureMode: (captureMode: boolean) => void;
  moonFollowCamera: boolean;
  setMoonFollowCamera: (v: boolean) => void;
  stars: typeof DEFAULT_STARS;
  setStars: (patch: Partial<typeof DEFAULT_STARS>) => void;
  windowAA: typeof DEFAULT_WINDOW_AA;
  setWindowAA: (patch: Partial<typeof DEFAULT_WINDOW_AA>) => void;
  facade: typeof DEFAULT_FACADE;
  setFacade: (patch: Partial<typeof DEFAULT_FACADE>) => void;
  windowLights: boolean;
  setWindowLights: (v: boolean) => void;
  windowMode: "simple" | "advanced";
  setWindowMode: (mode: "simple" | "advanced") => void;
  windowSimple: WindowRange;
  setWindowSimple: (patch: Partial<WindowRange>) => void;
  windowProfiles: Record<Archetype, WindowProfile>;
  setWindowProfile: (arch: Archetype, patch: Partial<WindowProfile>) => void;
  moon: {
    // Celestial body modelled on a sky dome around the city axis.
    azimuthDeg: number; // compass yaw, 0 = +z (north), 90 = +x (east)
    elevationDeg: number; // angle above horizon, 0 = horizon, 90 = zenith
    distance: number; // radial distance from city centre; default tracks stars.radius
    radiusRatio: number; // moon radius as a fraction of stars.radius
    phaseAuto: boolean; // true = illuminated fraction from the real date
    phaseManual: number; // synodic cycle position 0..1 (0 new, 0.5 full) when not auto
    terminatorStyle: "crisp" | "dither" | "cel"; // stylized lit/dark edge look
    edgeSharpness: number; // 0..1, tightens the terminator transition
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
  cameraModel: CameraModelId;
  setCameraModel: (id: CameraModelId) => void;
  drift: DriftConfig;
  setDrift: (patch: Partial<DriftConfig>) => void;
  snv2: Snv2Config;
  setSnv2: (patch: Partial<Snv2Config>) => void;
  turntable: TurntableConfig;
  setTurntable: (patch: Partial<TurntableConfig>) => void;
  cameraIntent: CameraIntent;
  cameraLive: CameraLive;
  // Transient UI signal: true while the user drags the atmosphere near/far
  // sliders — FogBoundsMarkers draws the in-world bracket rings while set.
  fogAdjusting: boolean;
  setFogAdjusting: (v: boolean) => void;
  // Debug: keep the fog boundary walls (FogBoundsMarkers) visible at all times,
  // not only while dragging the near/far sliders. Session-scoped runtime flag.
  fogBoundsAlways: boolean;
  setFogBoundsAlways: (v: boolean) => void;
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
    // World-absolute model (2026-07-01, reverted the camera-relative scaling):
    // near/far are ABSOLUTE world metres from the camera (THREE.Fog native);
    // FogTicker writes them straight through. See DEFAULT_FOG in sceneDefaults.
    near: number; // m — fog starts this far from the camera
    far: number; // m — fully fogged by here
    density: number; // exp² mode: fog amount at the city centre (0..0.9)
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
  // Transient: which focal slider is being adjusted ("" = none). Shows the pin (either
  // slider) and the Screen-Y guide line (screenY only). Not persisted.
  focalAdjust: "" | "focalY" | "screenY";
  setFocalAdjust: (v: "" | "focalY" | "screenY") => void;
  // Orbit/rotate pivot height as a fraction up from the bottom of the screen
  // (Google-Maps ~0.37). Drives the RMB pivot + the focal-marker raycast.
  orbitPivotFromBottom: number;
  setOrbitPivotFromBottom: (v: number) => void;
  // Master toggle for the low-elevation ground pull (applyScreenFocus). false = Screen Y is held
  // exactly where set at every angle; true = the pivot eases down near the horizon, tracking the tilt
  // LIVE (groundFrameLow sets how low it settles). On by default.
  groundFraming: boolean;
  setGroundFraming: (v: boolean) => void;
  // Low-angle frame: the fraction up from the bottom the ground/skyline line eases to at grazing
  // angles (applyScreenFocus). Focal-Y-INDEPENDENT — a balanced city + sky frame (~0.18). Lower =
  // skyline sits lower / more sky; higher = more foreground.
  groundFrameLow: number;
  setGroundFrameLow: (v: number) => void;
  // Side-view diagram overlay (CameraSideView): a live elevation cross-section of the rig — camera,
  // view frustum (cone ↔ slab), elevation angle, focal + plumb, ground line, clearance. Display-only
  // inspection aid; not persisted (resets off on reload). See components/scene/CameraDiagram.tsx.
  showSideView: boolean;
  setShowSideView: (v: boolean) => void;
  // Rotate/tilt speed limit at grazing / far-out views (DreiSceneControls.dragRotate).
  // rotateLowAngleGain = the rate multiplier at the horizon (1 = no limit); the slowdown eases in
  // (smoothstep) below rotateSlowBelowDeg elevation. Distance past the city tapers it further.
  rotateLowAngleGain: number;
  setRotateLowAngleGain: (v: number) => void;
  rotateSlowBelowDeg: number;
  setRotateSlowBelowDeg: (v: number) => void;
  // Tilt sensitivity: vertical-drag pitch rate as a fraction of the legacy 2*pi/screen-height gain
  // (1 = old behaviour). Lower = a more regulated, slower tilt, independent of rotation. (2026-06-16)
  tiltSpeed: number;
  setTiltSpeed: (v: number) => void;
  // Zoom mode: false = toward the cursor (default), true = toward the pin/focal.
  orbitZoomToPin: boolean;
  setOrbitZoomToPin: (v: boolean) => void;
  // Intentional underview: relax the ground/elevation clamp so the camera may drop below the
  // ground and look up at the world from underneath (off by default — prevents accidents).
  allowUnderview: boolean;
  setAllowUnderview: (v: boolean) => void;
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
  // Settings (Camera) panel visibility. Transient (not persisted) so it always boots hidden, like the
  // old local useState — lifted to the store so the ControlsGuide "Settings" switch + the H key can
  // both drive it. (user 2026-06-21)
  panelHidden: boolean;
  setPanelHidden: (v: boolean) => void;
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
    showPopulationHeat: boolean;
    showTrafficDensity: boolean;
    topologyKind: TopologyKind | null;
    highwayCount: number;
    arterialCount: number;
    streetCount: number;
  };
  setCityPlanning: (patch: Partial<SceneState["cityPlanning"]>) => void;
  // Transient hover highlight (Population → Districts list): the hovered
  // district draws emphasised in the scene. Never persisted.
  highlightDistrictId: string | null;
  setHighlightDistrictId: (id: string | null) => void;
  setTopologyKind: (kind: TopologyKind) => void;
  setHighwayCount: (n: number) => void;
  setArterialCount: (n: number) => void;
  setStreetCount: (n: number) => void;
  // Debug view modes — building tint + per-group render mode (Slices A/B).
  debug: typeof DEFAULT_DEBUG;
  setBuildingTint: (
    patch: Partial<{ mode: BuildingTintMode; intensity: number; enabled: boolean }>,
  ) => void;
  setRenderMode: (group: RenderGroup, mode: RenderMode) => void;
  setAllRenderModes: (mode: RenderMode) => void;
  setRenderModes: (modes: Record<RenderGroup, RenderMode>) => void;
  setShowTensorField: (v: boolean) => void;
  setTileOverlay: (v: boolean) => void;
  setTileFreeze: (v: boolean) => void;
  setShowPinPlane: (v: boolean) => void;
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
  // Live view link (CaptureBoot URL sync): address bar tracks the camera.
  liveViewLink: boolean;
  setLiveViewLink: (liveViewLink: boolean) => void;
  // Tensor-field deviation scale (#51) — gen input; 1 = the seeded default,
  // <1 calms every city, >1 deforms harder. Changing it regenerates.
  fieldDeviation: number;
  setFieldDeviation: (fieldDeviation: number) => void;
  // Population profile (#49) — centres / spread / shoulder / satellite.
  densityProfile: DensityProfile;
  setDensityProfile: (patch: Partial<DensityProfile>) => void;
  // Draft profile being PREVIEWED in the Density panel (heat-map overlay shows
  // the draft field live; nothing regenerates until Confirm commits it into
  // densityProfile). Transient — never persisted.
  densityProfileDraft: DensityProfile | null;
  setDensityProfileDraft: (draft: DensityProfile | null) => void;
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
  clearSavedConfig: () => void;
  copyableConfig: () => Record<string, unknown>;
  snapIntentToLive: () => void;
  tweenCameraTo: (to: CameraIntent, durationMs?: number) => void;
  clearCameraTweenRequest: () => void;
};

export const useSceneStore = create<SceneState>((set, get) => ({
  masterSeed: "starry-night",
  lightingMode: "classic",
  qualityTier: "high",
  qualityUserSet: false,
  setQualityUserSet: (qualityUserSet) => set({ qualityUserSet }),
  antialias: false, // off by default (user 2026-06-13)
  setAntialias: (antialias) => set({ antialias }),
  dprCap: null, // auto = use the quality tier's dprMax range
  setDprCap: (dprCap) => set({ dprCap }),
  adaptive: false,
  setAdaptive: (adaptive) => set({ adaptive }),
  perfStats: false,
  setPerfStats: (perfStats) => set({ perfStats }),
  paused: false,
  captureMode: false,
  setCaptureMode: (captureMode) => set({ captureMode }),
  moonFollowCamera: false,
  setMoonFollowCamera: (moonFollowCamera) => set({ moonFollowCamera }),
  stars: DEFAULT_STARS,
  setStars: (patch) => set((s) => ({ stars: { ...s.stars, ...patch } })),
  windowAA: DEFAULT_WINDOW_AA,
  setWindowAA: (patch) => set((s) => ({ windowAA: { ...s.windowAA, ...patch } })),
  facade: DEFAULT_FACADE,
  setFacade: (patch) => set((s) => ({ facade: { ...s.facade, ...patch } })),
  windowLights: true,
  setWindowLights: (windowLights) => set({ windowLights }),
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
  cameraModel: "snv2",
  drift: DEFAULT_DRIFT,
  snv2: DEFAULT_SNV2,
  turntable: DEFAULT_TURNTABLE,
  cameraIntent: DEFAULT_INTENT,
  cameraLive: {
    position: DEFAULT_INTENT.position,
    rotation: [0, 0, 0],
    fov: DEFAULT_INTENT.fov,
  },
  cameraTweenRequest: null,
  projection: DEFAULT_PROJECTION,
  orthoSize: DEFAULT_ORTHO_SIZE,
  projectionBlend: DEFAULT_PROJECTION === "orthographic" ? 1 : 0,
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
  focalAdjust: "",
  setFocalAdjust: (focalAdjust) => set({ focalAdjust }),
  orbitPivotFromBottom: 0.37,
  setOrbitPivotFromBottom: (orbitPivotFromBottom) => set({ orbitPivotFromBottom }),
  groundFraming: true,
  setGroundFraming: (groundFraming) => set({ groundFraming }),
  groundFrameLow: 0.07,
  setGroundFrameLow: (groundFrameLow) => set({ groundFrameLow }),
  showSideView: false,
  setShowSideView: (showSideView) => set({ showSideView }),
  rotateLowAngleGain: 0.35,
  setRotateLowAngleGain: (rotateLowAngleGain) => set({ rotateLowAngleGain }),
  rotateSlowBelowDeg: 20,
  setRotateSlowBelowDeg: (rotateSlowBelowDeg) => set({ rotateSlowBelowDeg }),
  tiltSpeed: 0.5,
  setTiltSpeed: (tiltSpeed) => set({ tiltSpeed }),
  orbitZoomToPin: true,
  setOrbitZoomToPin: (orbitZoomToPin) => set({ orbitZoomToPin }),
  allowUnderview: false,
  setAllowUnderview: (allowUnderview) => set({ allowUnderview }),
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
  panelHidden: true,
  setPanelHidden: (panelHidden) => set({ panelHidden }),
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
    showPopulationHeat: false,
    showTrafficDensity: false,
    topologyKind: null,
    highwayCount: 0,
    arterialCount: 0,
    streetCount: 0,
  },
  setCityPlanning: (patch) => set((s) => ({ cityPlanning: { ...s.cityPlanning, ...patch } })),
  highlightDistrictId: null,
  setHighlightDistrictId: (highlightDistrictId) => set({ highlightDistrictId }),
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
  setTileOverlay: (v) => set((s) => ({ debug: { ...s.debug, tileOverlay: v } })),
  setTileFreeze: (v) => set((s) => ({ debug: { ...s.debug, tileFreeze: v } })),
  setShowPinPlane: (v) => set((s) => ({ debug: { ...s.debug, showPinPlane: v } })),
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
  liveViewLink: false,
  setLiveViewLink: (liveViewLink) => set({ liveViewLink }),
  fieldDeviation: 1.5,
  setFieldDeviation: (fieldDeviation) => set({ fieldDeviation }),
  densityProfile: DEFAULT_DENSITY_PROFILE,
  setDensityProfile: (patch) => set((s) => ({ densityProfile: { ...s.densityProfile, ...patch } })),
  densityProfileDraft: null,
  setDensityProfileDraft: (densityProfileDraft) => set({ densityProfileDraft }),
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
  setCameraModel: (cameraModel) => set({ cameraModel }),
  setDrift: (patch) => set((s) => ({ drift: { ...s.drift, ...patch } })),
  setSnv2: (patch) => set((s) => ({ snv2: { ...s.snv2, ...patch } })),
  setTurntable: (patch) => set((s) => ({ turntable: { ...s.turntable, ...patch } })),
  setCameraIntent: (intent) =>
    set((s) => ({
      cameraIntent: {
        ...s.cameraIntent,
        ...intent,
        ...(intent.lookAt ? { lookAt: roundVec3(intent.lookAt) } : {}),
      },
    })),
  setCameraLive: (cameraLive) => set({ cameraLive }),
  fogAdjusting: false,
  setFogAdjusting: (fogAdjusting) => set({ fogAdjusting }),
  fogBoundsAlways: false,
  setFogBoundsAlways: (fogBoundsAlways) => set({ fogBoundsAlways }),
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
      // intro / starIntro are boot WAKE animations, not look settings. Reset should
      // REPLAY the wake like a fresh boot: snap to black (progress 0) and play, so the
      // sky and city fade out then gradually return. progress:0 + playing:true is the
      // playIntro/playStarIntro contract — on a live scene (cityReady true) the
      // IntroTicker frame loop stamps a fresh start-time on the playing edge and
      // re-cascades the city; the star block animates regardless of cityReady. (An
      // earlier fix snapped these to progress:1 to avoid a black sky that never woke —
      // but that landed on the settled look; replaying the wake is the desired feel.)
      patch.intro = { ...DEFAULT_INTRO, progress: 0, playing: true };
      patch.starIntro = { ...DEFAULT_STAR_INTRO, progress: 0, playing: true };
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
    // WYSIWYG camera (2026-06-08). While the orbit auto-revolves, the store's
    // azimuthDeg is STALE (it only settles on pause/drag) — saving it would
    // boot a different bearing than the one on screen. Derive the live azimuth
    // from the camera's actual position. Same idea for fly mode: the intent
    // may lag the flight, so rebuild it from cameraLive (snapIntentToLive
    // math) inside the snapshot only.
    if (s.cameraMode === "orbit") {
      const [px, , pz] = s.cameraLive.position;
      const az = (Math.atan2(px - s.orbit.centerX, pz - s.orbit.centerZ) * 180) / Math.PI;
      snap.orbit = { ...s.orbit, azimuthDeg: ((az % 360) + 360) % 360 };
    } else if (s.cameraMode === "fly") {
      const live = s.cameraLive;
      const [yaw, pitch] = [live.rotation[1], live.rotation[0]];
      const dist = 10;
      snap.cameraIntent = {
        ...s.cameraIntent,
        position: live.position,
        lookAt: [
          live.position[0] - Math.sin(yaw) * Math.cos(pitch) * dist,
          live.position[1] + Math.sin(pitch) * dist,
          live.position[2] - Math.cos(yaw) * Math.cos(pitch) * dist,
        ],
        rotation: live.rotation,
        fov: live.fov,
        orient: "lookAt",
      };
    }
    // cityPlanning visibility toggles — persisted, but only the three toggles.
    if (CITY_PLANNING_VIS_PERSIST) {
      snap.cityPlanning = {
        showHighways: s.cityPlanning.showHighways,
        showDistrictShells: s.cityPlanning.showDistrictShells,
        showArterials: s.cityPlanning.showArterials,
        showStreets: s.cityPlanning.showStreets,
        showPopulationHeat: s.cityPlanning.showPopulationHeat,
        showTrafficDensity: s.cityPlanning.showTrafficDensity,
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
      // Never leave the wake animations un-played on a live scene (same as Reset): a saved
      // mid-wake progress would hide the stars / dark the city until a reload. On boot, the
      // IntroTicker's mount replay overrides this, so the wake still runs at load.
      patch.intro = { ...(patch.intro ?? s.intro), progress: 1, playing: false };
      patch.starIntro = { ...(patch.starIntro ?? s.starIntro), progress: 1, playing: false };
      return patch;
    });
  },
  hasSavedConfig: () => readSavedConfig() !== null,
  // Delete the saved default from this browser. The live scene is left as-is (Reset returns it to
  // the built-in default); reloads boot the built-in default once the snapshot is gone.
  clearSavedConfig: () => removeSavedConfig(),
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
        showPopulationHeat: s.cityPlanning.showPopulationHeat,
        showTrafficDensity: s.cityPlanning.showTrafficDensity,
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

// Boot hydration (user 2026-06-08: "when I press save the city size and all
// other settings should be… present after refreshing the page"). The Save
// button writes the SavedConfig, but nothing applied it on load — Revert was
// the only reader, so every refresh booted the defaults. Apply it here, at
// module init BEFORE the first generation, so a saved tier doesn't trigger a
// boot-then-regenerate double gen. Server-side this is a no-op (readSavedConfig
// requires window.localStorage).
useSceneStore.getState().revertToSaved();

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

// ...and the population profile (#49) — gen caches key on densityProfileKey().
setDensityProfileModule(useSceneStore.getState().densityProfile);
useSceneStore.subscribe((s, prev) => {
  if (s.densityProfile !== prev.densityProfile) setDensityProfileModule(s.densityProfile);
});
