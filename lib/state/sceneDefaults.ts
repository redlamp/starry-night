// All DEFAULT_* constants, QUALITY_TIERS, RENDER_GROUPS, and DEBUG_WIRE_COLOR.
// Import direction: sceneTypes ← sceneDefaults ← sceneMigration ← sceneStore
//
// NOTE: SETTINGS_REGISTRY (and its SettingEntry / AnySettingEntry types) stays
// in sceneStore.ts because it references SceneState, which is also defined
// there. Moving it here would create a circular import (sceneDefaults →
// SceneState → sceneStore). That's the only registry-related item that resists
// extraction.

import { CITY_SCALE, DEFAULT_CITY_TIER } from "@/lib/seed/topology";
import type { CityTier } from "@/lib/seed/topology";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { Archetype } from "@/lib/seed/cityGen";
import { DEFAULT_DENSITY_PROFILE } from "@/lib/seed/density";

import type {
  QualityTier,
  OrbitConfig,
  DriftConfig,
  Snv2Config,
  TurntableConfig,
  WindowRange,
  WindowProfile,
  RenderGroup,
  RenderMode,
  BuildingTintMode,
  CameraIntent,
} from "./sceneTypes";

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
  // starCount matches DEFAULT_STARS.count (24000) so the default-tier boot and an
  // explicit "high" pick land on the same starfield (was 16000 — a mismatch that
  // dropped 8k stars the first time anything touched the tier; #53).
  high: { label: "High", dprMax: 2, starCount: 24000 },
  ultra: { label: "Ultra", dprMax: 3, starCount: 24000 },
};

// All in meters. See wiki/research/building-sizes-real-world-references.md
// Tuned via the in-app Save/Copy values workflow on 2026-07-01 (v2 hero establishing shot).
export const DEFAULT_INTENT: CameraIntent = {
  position: [-108.66, 160.1, -2801],
  lookAt: [-27, 211, -38],
  rotation: [3.1224, -0.02967, 3.14159], // (178.9°, -1.7°, 180°); orientation actually from lookAt
  fov: (360 / Math.PI) * Math.atan(12 / 55), // 55 mm-equiv "normal" lens (reads 25° fov / 55 mm)
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

// Curated default framing (2026-06-14): a near-horizon, paused ("still") view of
// the "starry-night" seed — compass 187°, elevation 2°, focal at the origin (focal
// X/Y/Z = 0) (user 2026-06-21). Radius scales with city width
// (CITY_SCALE); 1800s sweep (0.2°/s) once un-paused. lookAtY (focal HEIGHT) is NOT
// scaled — building heights are fixed across size tiers, so the skyline sits at the
// same Y regardless of extent. Per-model transport default (catalog.startsPaused,
// applied on model switch): Map enters paused on this still curated pose, while
// Drift / Turntable auto-play. Initial orbitPaused is false because the default
// model is Drift; switching to Map sets it true.
export const DEFAULT_ORBIT: OrbitConfig = {
  centerX: 0,
  centerZ: 0, // focal at the origin (user 2026-06-21; was -120)
  lookAtY: 0, // default aim at ground level (focal Y 0); was 120 / mid-skyline — 2026-06-21
  radius: 2400 * CITY_SCALE,
  azimuthDeg: 187,
  elevationDeg: 2,
  periodSec: 1800,
};

export const DEFAULT_DRIFT: DriftConfig = {
  wanderRadius: 0.45,
  wanderSpeed: 1,
  elevMid: 4,
  elevAmp: 2.5,
  revolveSec: 360,
  breathe: 0.05,
};

export const DEFAULT_SNV2: Snv2Config = {
  minDist: 1,
  maxDist: 20000,
  orbitSpeed: 1,
  zoomSpeed: 1,
  tiltFloorDeg: 0,
};

export const DEFAULT_TURNTABLE: TurntableConfig = {
  elevDeg: 8, // low + ortho-safe (sky above the skyline); raise it in perspective for a 3/4 showcase
  spinSec: 60,
};

// Azimuth flipped 180° from the 200° tuning that paired with the old camera
// pose: with the new defaults the camera faces +z, so the moon sits at +z too.
// radiusRatio: moon radius as a fraction of star shell radius (~4500m), so
// the moon scales with the dome by default. 0.02 ≈ 90m moon at default stars
// radius, sitting just above the horizon (elevation 1°) — exposed in the Moon
// panel for live tuning.
export const DEFAULT_MOON = {
  azimuthDeg: 20,
  // Raised off the horizon (#65 v3) so the ground/horizon (main pass) doesn't draw
  // over it. Lowered 18° → 12° (2026-06-24): the star camera now matches the city's
  // narrow fov, and at the near-horizontal default view (elev 2°) an 18° moon sat
  // just above the top edge. 12° centred it in the sky; dropped to 3° (user 2026-06-28)
  // for a low, near-horizon moon (accepts partial skyline occlusion); raise to clear it.
  elevationDeg: 3,
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
  // Raised 24000 → 120000 (2026-06-24): the star camera now matches the city's
  // (narrow ~20°) fov for 1:1 elevation tracking, which shows a much smaller slice
  // of sky than the old fixed 60°. ~(60/20)² ≈ 9× more stars keeps the visible
  // density rich. Tunable via the Stars slider (persisted configs keep their old
  // value until reverted). Points are cheap; revisit under device-adaptive quality.
  count: 120000,
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
  // 0.4 = wash starts at ~2.5px windows — the user's pick (2026-07-02, live
  // A/B vs 0.2): keeps mid-range window detail and accepts some speckle in
  // the 2.5-8px band. The band-jitter sub-resolution fade in cityInstanced
  // still carries the band-floor case; the telephoto sub-pixel remainder is
  // #82 (the real fix there is cell supersampling, not an earlier wash).
  lodNear: 0.4,
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

// World-absolute fog (2026-07-01, reverts the camera-relative model): near/far are
// ABSOLUTE world metres measured from the camera (THREE.Fog native), so the haze is
// locked to the world and does not rescale with camera distance. FogTicker writes them
// straight through. Defaults ≈ the previous look at the default view (near 6000 /
// far 20000 m). exp² `density` stays a 0..0.9 "amount", referenced to a fixed world
// distance inside FogTicker.
export const DEFAULT_FOG = {
  enabled: false,
  mode: "linear" as const,
  color: "#0b0d14",
  near: 6000, // m — fog starts this far from the camera
  far: 20000, // m — fully fogged by here
  density: 0.45, // exp² amount at FogTicker's fixed reference distance (0..0.9)
};

export const DEFAULT_HAZE = {
  enabled: true,
  color: "#1b2641",
  // Vertical extents are absolute (heights don't scale with city width — #47).
  topY: 240,
  bottomY: -30,
  intensity: 0.5, // "strength" slider — softer default horizon haze (user 2026-06-28)
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
  showTrafficDensity: false,
};

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
  // Windows texture-layer view (2026-07-03, window-lab parity): render the
  // buildings' raw cell atlas or the pane-mask field instead of the final
  // composite — the same layer debugging the lab's texture dropdowns give.
  windowView: "final" as "final" | "atlas" | "field",
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
  // Global car-light size multiplier (×SIZE_SCALE in the traffic shader). Street
  // cars are the smallest tier (size 4 vs arterial 5.5 / highway 7); raise this to
  // make all car lights bigger. Live uniform — no regen.
  lightSize: 1,
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
export const DEFAULT_PROJECTION = "perspective" as "perspective" | "orthographic";

// Perspective's default dolly (the hero-shot distance). 1500 × CITY_SCALE = 3000 at the
// default tier. DISTANCE is the "slack" value: in perspective it sets the dolly, in
// orthographic only clip-safety (orthoSize fixes apparent size, so ortho parks far out at
// ~DEFAULT_ORBIT.radius). The projection toggle slides distance between the two; their
// framing (K) need NOT match — ProjectionBlender bridges the gap across the morph. See
// wiki/notes/camera-tuning-notes #2 (2026-06-14 framing-bridge rework).
export const DEFAULT_PERSP_RADIUS = 1500 * CITY_SCALE;

export { DEFAULT_DENSITY_PROFILE };
