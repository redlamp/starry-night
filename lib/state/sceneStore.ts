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
import {
  setDensityProfile as setDensityProfileModule,
  DEFAULT_DENSITY_PROFILE,
  type DensityProfile,
} from "@/lib/seed/density";
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
  fov: 20, // narrow / low-distortion, matching Google Maps' 3D camera
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

// Curated default framing (2026-06-14): a near-horizon, paused ("still") view of
// the "starry-night" seed — compass 187°, elevation 2°, focal at the origin (focal
// X/Y/Z = 0) (user 2026-06-21). Radius scales with city width
// (CITY_SCALE); 1800s sweep (0.2°/s) once un-paused. lookAtY (focal HEIGHT) is NOT
// scaled — building heights are fixed across size tiers, so the skyline sits at the
// same Y regardless of extent. (Pairs with orbitPaused defaulting true.)
export const DEFAULT_ORBIT: OrbitConfig = {
  centerX: 0,
  centerZ: 0, // focal at the origin (user 2026-06-21; was -120)
  lookAtY: 0, // default aim at ground level (focal Y 0); was 120 / mid-skyline — 2026-06-21
  radius: 2400 * CITY_SCALE,
  azimuthDeg: 187,
  elevationDeg: 2,
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
  // Raised off the horizon (#65 v3): the moon renders in the star pass, which the
  // ground/horizon (main pass) draws over, so a near-0 elevation sank it. 18° sits it
  // clearly in the sky. Lower it for a horizon moon (accepts partial ground occlusion).
  elevationDeg: 18,
  // Sits on the star shell so the moon hugs the celestial sphere. Tracks the star
  // radius default (was 4500·CITY_SCALE, stale after stars.radius → 3200·CITY_SCALE,
  // which left the moon floating beyond the star dome).
  distance: 3200 * CITY_SCALE,
  radiusRatio: 0.01,
  // Phase: by default the illuminated fraction tracks the real date (sampled once at
  // mount — see lib/moon/phase.ts). Turn auto off to scrub the phase manually for
  // testing/art-direction (phaseManual = synodic position 0..1; 0 = new, 0.5 = full).
  phaseAuto: true,
  phaseManual: 0.25,
  // Stylized terminator look: "crisp" 2-tone, "dither" (1-bit ordered), or "cel"
  // steps. edgeSharpness 0..1 tightens the lit/dark transition (higher = sharper).
  terminatorStyle: "dither" as "crisp" | "dither" | "cel",
  edgeSharpness: 0.88,
};
// `factor` is the star base size in px (mean, before the per-star long-tail).
// Previously a vestigial drei value (200) that nothing read; now wired to
// StarField's size prop. Legacy large values are migrated on load.
export const DEFAULT_STARS = {
  radius: 3200 * CITY_SCALE,
  depth: 360 * CITY_SCALE,
  count: 24000,
  factor: 36,
  // Twinkle AMPLITUDE (the σ scale of the log-normal scintillation; see
  // wiki/research/star-twinkle-scintillation.md). 0 = dead steady, 1 ≈ σ 0.1 at
  // zenith, up to 3 = dramatic. The shader scales this by (sec z)^1.5, so horizon
  // stars twinkle far harder. Fed to the starField shader's uTwinkle uniform.
  twinkle: 1.5,
  // Per-star noise TIMESCALE range, in ms (slider bounds 100..6000). Each star draws
  // a random base period in [min, max]; the shader sums octaves (2.3×, 4.7× faster)
  // on top, so the visible flicker is brisker than these numbers alone. Lower =
  // faster. Real scintillation is fast/broadband, so the default sits low.
  twinkleMinMs: 150,
  twinkleMaxMs: 1200,
  // Chromatic-flash strength (0 = none). The red/green/blue shimmer of low, bright
  // stars (atmospheric dispersion + per-channel decorrelated scintillation), gated
  // in-shader to low altitude × bright stars and bounded by each star's own colour.
  twinkleChroma: 0.5,
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
//   stagger — share of correlated floors (whole/fractional bands) that switch
//             on in 2..4 column banks instead of all at once — banks of light
//             switches flipped down the hall.
//   curtain — share of correlated office towers (office-block / spire) whose
//             BAND floors render as curtainW glass — ribbon floors on
//             otherwise normal facades, corner piers, per-face wake clocks.
//   curtainW— pane fill on those towers. 0.99 default keeps hairline mullions;
//             exactly 1.0 turns lit floors into one continuous window (the
//             full curtain look — opt-in because it reads as a neon tube).
export const DEFAULT_WINDOW_AA = {
  edge: 1.1,
  lodEnabled: true, // window distance-wash LOD; header toggle in the LOD group
  lodNear: 0.2,
  lodRange: 0.4,
  litBias: 0.7,
  churn: 0.2,
  stagger: 0.5,
  curtain: 0.3,
  curtainW: 0.99,
};

// Facade base-colour ranges (lightingGen.facadeColorFor): each building rolls
// one hue + one saturation + one lightness. A weighted coin (warmShare) picks
// the hue family — warm masonry vs cool blue-glass — then hue rolls inside
// that family's [min, max] degree window. Lightness skews dark (pow 1.4).
// Sat/light are DISPLAY space HSL: the city shader writes gl_FragColor raw
// (no tonemapping / colorspace chunks), so what's stored is what reaches the
// screen. Sat/light defaults tuned live 2026-06-07: whisper-subtle separation
// — silhouettes barely lift off the sky, no readable wall colour.
export const DEFAULT_FACADE = {
  satMin: 0.02,
  satMax: 0.08,
  lightMin: 0.02,
  lightMax: 0.06,
  warmShare: 0.3,
  warmHueMin: 18, // degrees
  warmHueMax: 40,
  coolHueMin: 198,
  coolHueMax: 234,
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
export const DEFAULT_WINDOW_SIMPLE: WindowRange = {
  wMin: 0.22,
  wMax: 0.38,
  hMin: 0.42,
  hMax: 0.58,
};
// Height ranges are the old per-archetype points ±0.08 (the spread the save
// migration uses), replacing the shader's hard-coded ±15% height jitter.
export const DEFAULT_WINDOW_PROFILES: Record<Archetype, WindowProfile> = {
  "low-rise": { wMin: 0.26, wMax: 0.42, hMin: 0.34, hMax: 0.5 },
  warehouse: { wMin: 0.74, wMax: 0.9, hMin: 0.26, hMax: 0.42 },
  "mid-rise": { wMin: 0.34, wMax: 0.5, hMin: 0.42, hMax: 0.58 },
  "residential-tower": { wMin: 0.38, wMax: 0.54, hMin: 0.48, hMax: 0.64 },
  "narrow-tower": { wMin: 0.62, wMax: 0.78, hMin: 0.64, hMax: 0.8 },
  "office-block": { wMin: 0.7, wMax: 0.86, hMin: 0.52, hMax: 0.68 },
  // Spire width tops at 0.99: rolls ≥ 0.98 snap to exact 1.0 in the shader,
  // so a sliver of spires organically reads as seamless glass.
  spire: { wMin: 0.74, wMax: 0.99, hMin: 0.7, hMax: 0.86 },
};
// Moon halo: billboard glow around the moon disc. radiusMul scales the halo
// plane relative to the moon radius; innerRadius is the 0..0.5 fraction of the
// disc that stays opaque before the soft falloff; intensity multiplies the
// emissive output (post-tonemap, so >1.0 blooms under ACES).
export const DEFAULT_MOON_HALO = { radiusMul: 2.5, innerRadius: 0.05, intensity: 1.1 };

// City-anchored fog (2026-06-06, replaces absolute metres): near/far are
// positions on the live camera→city-centre axis — 0 = at the camera, 1 = at
// the centre, >1 = beyond it. FogTicker multiplies them by the camera→centre
// distance every frame, so the gradient follows the camera instead of being
// swallowed by it. Defaults ≈ the old look at the default orbit radius
// (near 4800 / far 7200 at d = 4800 ⇒ 0.9 / 1.5).
export const DEFAULT_FOG = {
  enabled: true,
  mode: "linear" as const,
  color: "#0b0d14",
  near: 1.25,
  far: 2,
  // exp² mode: fog AMOUNT at the city centre (0..0.9) — FogTicker solves the
  // actual three.js density from it per frame, so it's camera-independent.
  density: 0.45,
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
  showPopulationHeat: false,
};

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
export const RENDER_GROUPS: RenderGroup[] = ["buildings", "roads", "ground", "sky", "moon"];

export const DEFAULT_DEBUG = {
  // enabled:false so the city boots untinted; the dropdown still shows the
  // remembered mode (population) ready to flip on from the Buildings header.
  buildingTint: { mode: "population" as BuildingTintMode, intensity: 0.85, enabled: false },
  renderModes: {
    buildings: "rendered" as RenderMode,
    roads: "rendered" as RenderMode,
    ground: "rendered" as RenderMode,
    sky: "rendered" as RenderMode,
    moon: "rendered" as RenderMode,
  } as Record<RenderGroup, RenderMode>,
  // Tensor Field view (#40 Phase 1): overlay the road-shaping direction field.
  showTensorField: false,
  // Tile-culling view (#55): translucent AABB overlay of the cull tiles
  // (green = in the cull frustum, red = evicted) + a freeze that pins the cull
  // frustum to the current pose so the camera can inspect eviction from outside.
  tileOverlay: false,
  tileFreeze: false,
  // Pin-plane view (2026-06-14, throwaway camera-tuning aid): the plane through the
  // focal pin, perpendicular to the view axis, with the ortho view's footprint
  // outlined on it — adjust perspective fov/distance until the frame matches.
  showPinPlane: false,
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
// `popCoupling` scales each segment's car count by the local population density
// (0 = the old uniform look, 1 = fully population-driven; highways exempt).
export const DEFAULT_TRAFFIC = {
  enabled: true,
  density: 1,
  highway: 4,
  arterial: 2,
  minor: 1,
  popCoupling: 1,
};

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
// City size tier (#58) — the GEN extent, keyed by km across (1 km notches,
// Truck Stop → Metropolis). Each notch is a DIFFERENT city for the same seed
// (a bigger canvas re-rolls the layout; it does not grow the current city
// outward). Gen cost ∝ extent²: 3 km ~2.5 s, 6 km ~8–10 s, 8 km worse still
// (#63). Default is the 6 km "City" notch (user 2026-06-08) — boot pays the
// ~8–10 s gen; revisit if mobile boot complains.
export const DEFAULT_CITY_SIZE: CityTier = DEFAULT_CITY_TIER;
// Crop follows the tier while locked (the default): crop = the tier's full disc.
export const DEFAULT_CROP_LOCK = true;
// Circle crop radius as a fraction of the CURRENT tier's gen extent. 1.0 = the
// tier's full disc (the default, lock ON); smaller reveals a core. Only affects
// the `circle` shape. The City-shape "crop" slider drives this, shown in km.
export const DEFAULT_CITY_SHAPE_SCALE = 1.0;

export const DEFAULT_FLY_SPEED = 14;
// 360 at the 3 km default notch (half 1500); base scales with the size knob via CITY_SCALE.
export const DEFAULT_ORTHO_SIZE = 160 * CITY_SCALE;
export const DEFAULT_PROJECTION = "orthographic" as const;

// Perspective's default dolly (the hero-shot distance). 1500 × CITY_SCALE = 3000 at the
// default tier. DISTANCE is the "slack" value: in perspective it sets the dolly, in
// orthographic only clip-safety (orthoSize fixes apparent size, so ortho parks far out at
// ~DEFAULT_ORBIT.radius). The projection toggle slides distance between the two; their
// framing (K) need NOT match — ProjectionBlender bridges the gap across the morph. See
// wiki/notes/camera-tuning-notes #2 (2026-06-14 framing-bridge rework).
export const DEFAULT_PERSP_RADIUS = 1500 * CITY_SCALE;

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
  | SettingEntry<"fieldDeviation">
  | SettingEntry<"densityProfile">
  | SettingEntry<"antialias">
  | SettingEntry<"dprCap">
  | SettingEntry<"adaptive">
  | SettingEntry<"perfStats">;

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
  { key: "orbitPaused", defaultValue: true as const, persist: true },
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
  facade?: typeof DEFAULT_FACADE;
  windowMode?: "simple" | "advanced";
  windowSimple?: WindowRange;
  windowProfiles?: Record<Archetype, WindowProfile>;
  moonHalo?: typeof DEFAULT_MOON_HALO;
  moonFollowCamera?: boolean;
  flySpeed?: number;
  showFocalIndicator?: boolean;
  // 2026-06-08: the camera comes back EXACTLY as saved (mode + paused state).
  cameraMode?: CameraMode;
  orbitPaused?: boolean;
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
  densityProfile?: DensityProfile;
  antialias?: boolean;
  dprCap?: number | null;
  adaptive?: boolean;
  perfStats?: boolean;
  // Only the layer-visibility toggles persist — topologyKind / arterialCount
  // are per-seed runtime readouts, not settings.
  cityPlanning?: {
    showHighways: boolean;
    showDistrictShells: boolean;
    showArterials: boolean;
    showStreets: boolean;
    // Optional so configs saved before the Population panel still load.
    showPopulationHeat?: boolean;
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
    // 2026-06-06 city-size notches: tiers re-keyed from names to km (renames
    // can no longer re-scale a save). Legacy strings map by physical size —
    // town 1.5 km → 2, city 3 km → 3, metro 6 km → 6; anything else (or a
    // number outside the ladder) falls back to the default notch.
    {
      const raw = (parsed as Record<string, unknown>).citySize;
      if (typeof raw === "string") {
        const legacy: Record<string, CityTier> = { town: 2, city: 3, metro: 6 };
        parsed.citySize = legacy[raw] ?? DEFAULT_CITY_SIZE;
      } else if (raw !== undefined && !(typeof raw === "number" && raw in CITY_TIERS)) {
        parsed.citySize = DEFAULT_CITY_SIZE;
      }
    }
    // Forward-fill new fields (e.g. #55 lod.tiles, #26 stars.shootingMin/Max)
    // into configs saved before they existed, so an old save can't silently
    // disable a newer feature.
    if (parsed.lod) parsed.lod = { ...DEFAULT_LOD, ...parsed.lod };
    if (parsed.stars) parsed.stars = { ...DEFAULT_STARS, ...parsed.stars };
    if (parsed.windowAA) parsed.windowAA = { ...DEFAULT_WINDOW_AA, ...parsed.windowAA };
    if (parsed.facade) parsed.facade = { ...DEFAULT_FACADE, ...parsed.facade };
    if (parsed.fog) {
      // 2026-06-06 fog re-anchor: old saves carry absolute near/far metres —
      // drop them and fill the new fractional brackets so a stale save can't
      // produce NaN fog.
      const legacy = { ...(parsed.fog as Record<string, unknown>) };
      // near/far changed meaning (absolute metres → camera→centre fractions);
      // metre-scale values would be absurd fractions — drop and refill.
      if (typeof legacy.near === "number" && legacy.near > 10) delete legacy.near;
      if (typeof legacy.far === "number" && legacy.far > 10) delete legacy.far;
      // short-lived intermediate field names (2026-06-06 same-day iteration)
      delete legacy.clearDepth;
      delete legacy.hazeDepth;
      // density changed meaning (raw three.js density → amount-at-centre);
      // old-scale values (~0.0006) would read as zero fog — refill.
      if (typeof legacy.density === "number" && legacy.density < 0.01) delete legacy.density;
      parsed.fog = { ...DEFAULT_FOG, ...legacy };
    }
    // 2026-06-06 Buildings panel: window sizes became per-building ranges
    // (one seeded roll per building) — both dimensions, both modes. Old saves
    // carry point values — expand ±0.08 around the saved value (the new
    // defaults' spread) so the variance feature shows up without re-tuning.
    {
      const spread = (v: number): { lo: number; hi: number } => ({
        lo: Math.max(0.1, v - 0.08),
        hi: Math.min(0.95, v + 0.08),
      });
      const expandProfile = (p: unknown): WindowProfile | undefined => {
        if (!p || typeof p !== "object") return undefined;
        const o = p as {
          w?: number;
          wMin?: number;
          wMax?: number;
          h?: number;
          hMin?: number;
          hMax?: number;
        };
        const w =
          typeof o.wMin === "number" && typeof o.wMax === "number"
            ? { lo: o.wMin, hi: o.wMax }
            : typeof o.w === "number"
              ? spread(o.w)
              : undefined;
        const h =
          typeof o.hMin === "number" && typeof o.hMax === "number"
            ? { lo: o.hMin, hi: o.hMax }
            : typeof o.h === "number"
              ? spread(o.h)
              : undefined;
        if (!w || !h) return undefined;
        return { wMin: w.lo, wMax: w.hi, hMin: h.lo, hMax: h.hi };
      };
      if (parsed.windowSimple) {
        const o = parsed.windowSimple as {
          w?: number;
          wMin?: number;
          wMax?: number;
          h?: number;
          hMin?: number;
          hMax?: number;
        };
        const w =
          typeof o.wMin === "number" && typeof o.wMax === "number"
            ? { lo: o.wMin, hi: o.wMax }
            : typeof o.w === "number"
              ? spread(o.w)
              : { lo: DEFAULT_WINDOW_SIMPLE.wMin, hi: DEFAULT_WINDOW_SIMPLE.wMax };
        const h =
          typeof o.hMin === "number" && typeof o.hMax === "number"
            ? { lo: o.hMin, hi: o.hMax }
            : typeof o.h === "number"
              ? spread(o.h)
              : { lo: DEFAULT_WINDOW_SIMPLE.hMin, hi: DEFAULT_WINDOW_SIMPLE.hMax };
        parsed.windowSimple = { wMin: w.lo, wMax: w.hi, hMin: h.lo, hMax: h.hi };
      }
      if (parsed.windowProfiles) {
        const saved = parsed.windowProfiles as Record<string, unknown>;
        const out = {} as Record<Archetype, WindowProfile>;
        for (const arch of Object.keys(DEFAULT_WINDOW_PROFILES) as Archetype[]) {
          out[arch] = expandProfile(saved[arch]) ?? DEFAULT_WINDOW_PROFILES[arch];
        }
        parsed.windowProfiles = out;
      }
    }
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

function removeSavedConfig() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SAVED_CONFIG_KEY);
  } catch {
    // localStorage may be unavailable
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
  cameraIntent: CameraIntent;
  cameraLive: CameraLive;
  // Transient UI signal: true while the user drags the atmosphere near/far
  // sliders — FogBoundsMarkers draws the in-world bracket rings while set.
  fogAdjusting: boolean;
  setFogAdjusting: (v: boolean) => void;
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
    // City-anchored model: positions on the camera→CITY_CENTER axis (0 = at
    // the camera, 1 = at the centre, >1 = beyond). FogTicker scales them by
    // the live camera→centre distance every frame, so the fog gradient stays
    // pinned to the city while the camera orbits, flies, or zooms.
    near: number; // where the fade begins (0..4)
    far: number; // where the fade completes (0..6)
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
  orbitPaused: true,
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
