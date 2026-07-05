// readSavedConfig (with migration / forward-fill logic), writeSavedConfig,
// removeSavedConfig, hasSavedQualityTier, and the SavedConfig type.
// Import direction: sceneTypes ← sceneDefaults ← sceneMigration ← sceneStore

import { CITY_TIERS } from "@/lib/seed/topology";
import type { CityTier } from "@/lib/seed/topology";
import type { CityShapeSetting } from "@/lib/seed/cityShape";
import type { Archetype } from "@/lib/seed/cityGen";
import type { DensityProfile } from "@/lib/seed/density";

import type {
  QualityTier,
  CameraIntent,
  OrbitConfig,
  CameraMode,
  CameraModelId,
  DriftConfig,
  Snv2Config,
  TurntableConfig,
  WindowRange,
  WindowProfile,
  Projection,
} from "./sceneTypes";
import {
  DEFAULT_ORBIT,
  DEFAULT_STARS,
  DEFAULT_CITY_SIZE,
  DEFAULT_WINDOW_SIMPLE,
  DEFAULT_WINDOW_PROFILES,
  DEFAULT_LOD,
  DEFAULT_WINDOW_AA,
  DEFAULT_FACADE,
  DEFAULT_SNV2,
  DEFAULT_FOG,
} from "./sceneDefaults";

export type SavedConfig = {
  // Optional so configs saved before #53 still load (an absent tier means the
  // boot device-fit is free to run).
  qualityTier?: QualityTier;
  cameraIntent: CameraIntent;
  orbit: OrbitConfig;
  moon: {
    azimuthDeg: number;
    elevationDeg: number;
    distance: number;
    radiusRatio: number;
    phaseAuto: boolean;
    phaseManual: number;
    terminatorStyle: "crisp" | "dither" | "cel";
    edgeSharpness: number;
  };
  stars: {
    radius: number;
    depth: number;
    count: number;
    factor: number;
    twinkle: number;
    twinkleMinMs: number;
    twinkleMaxMs: number;
    twinkleChroma: number;
    shootingMin: number;
    shootingMax: number;
    meteorsEnabled: boolean;
  };
  // Optional so configs saved before these were added still load.
  fog?: {
    enabled: boolean;
    mode: "linear" | "exp2";
    color: string;
    near: number;
    far: number;
    density: number;
  };
  haze?: {
    enabled: boolean;
    color: string;
    topY: number;
    bottomY: number;
    intensity: number;
    radius: number;
  };
  projection?: Projection;
  orthoSize?: number;
  windowAA?: {
    edge: number;
    lodEnabled: boolean;
    lodNear: number;
    lodRange: number;
    litBias: number;
    churn: number;
    stagger: number;
    curtain: number;
    curtainW: number;
    storefront: number;
    storefrontHeight: number;
  };
  facade?: {
    satMin: number;
    satMax: number;
    lightMin: number;
    lightMax: number;
    warmShare: number;
    warmHueMin: number;
    warmHueMax: number;
    coolHueMin: number;
    coolHueMax: number;
  };
  windowMode?: "simple" | "advanced";
  windowRenderMode?: "classic" | "hybrid";
  windowSimple?: WindowRange;
  windowProfiles?: Record<Archetype, WindowProfile>;
  moonHalo?: { radiusMul: number; innerRadius: number; intensity: number };
  moonFollowCamera?: boolean;
  flySpeed?: number;
  showFocalIndicator?: boolean;
  // 2026-06-08: the camera comes back EXACTLY as saved (mode + paused state).
  cameraMode?: CameraMode;
  // Optional so configs saved before the camera-model selector still load.
  cameraModel?: CameraModelId;
  drift?: DriftConfig;
  snv2?: Snv2Config;
  turntable?: TurntableConfig;
  orbitPaused?: boolean;
  intro?: {
    progress: number;
    playing: boolean;
    durationSec: number;
    streetlightDurationSec: number;
    mode: "random" | "district" | "outside-in" | "far-to-near" | "inside-out";
    offCycleSec: number;
    retriggerSec: number;
    cycleJitter: number;
  };
  starIntro?: {
    progress: number;
    playing: boolean;
    durationSec: number;
    mode: "random" | "bright-first" | "horizon-first" | "zenith-first";
  };
  traffic?: {
    enabled: boolean;
    density: number;
    highway: number;
    arterial: number;
    minor: number;
    popCoupling: number;
    lightSize: number;
  };
  flights?: { enabled: boolean; gapMin: number; gapMax: number; deviation: number };
  helicopters?: { enabled: boolean };
  streetlights?: { enabled: boolean; size: number; brightness: number };
  lod?: {
    enabled: boolean;
    near: number;
    far: number;
    cull: number;
    sizeFloor: number;
    brightnessFloor: number;
    tiles: boolean;
  };
  cityShape?: CityShapeSetting;
  cityShapeScale?: number;
  citySize?: CityTier;
  cropLock?: boolean;
  fpsHud?: boolean;
  liveViewLink?: boolean;
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
    // Optional so configs saved before the traffic-density overlay still load.
    showTrafficDensity?: boolean;
  };
};

export const SAVED_CONFIG_KEY = "starry-night.savedConfig";

export function readSavedConfig(): SavedConfig | null {
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
    if (parsed.snv2) parsed.snv2 = { ...DEFAULT_SNV2, ...parsed.snv2 };
    if (parsed.fog) {
      // 2026-06-06 fog re-anchor: old saves carry absolute near/far metres —
      // drop them and fill the new fractional brackets so a stale save can't
      // produce NaN fog.
      const legacy = { ...(parsed.fog as Record<string, unknown>) };
      // near/far changed meaning (absolute metres → camera→centre fractions);
      // Fog near/far are ABSOLUTE METRES again (2026-07-01; reverted the camera-relative
      // multiplier model). Multiplier-era saves (≤ ~10) would read as a few metres →
      // white-out; drop and refill with the metre defaults. Genuine metre saves (old or
      // new) are ≥ 100 and pass through.
      if (typeof legacy.near === "number" && legacy.near < 100) delete legacy.near;
      if (typeof legacy.far === "number" && legacy.far < 100) delete legacy.far;
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

export function writeSavedConfig(snap: SavedConfig) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_CONFIG_KEY, JSON.stringify(snap));
  } catch {
    // localStorage may be unavailable in private modes — saving is best effort
  }
}

export function removeSavedConfig() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SAVED_CONFIG_KEY);
  } catch {
    // localStorage may be unavailable
  }
}

// True when the persisted config carries a quality tier — i.e. the user has Saved
// a config since #53. The boot device-fit (applyDeviceFit) treats that as "the
// user has a tier already; don't auto-override it". (#53)
export function hasSavedQualityTier(): boolean {
  return readSavedConfig()?.qualityTier != null;
}
