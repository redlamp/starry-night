import { create } from "zustand";

export type LightingMode = "classic" | "modern";
export type QualityTier = "low" | "med" | "high" | "ultra";
export type CameraMode = "still" | "fly" | "orbit";

export type Projection = "perspective" | "orthographic";

export type Vec3 = [number, number, number];

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
// Tuned via the in-app Save/Copy values workflow on 2026-05-25.
export const DEFAULT_INTENT: CameraIntent = {
  position: [-3.428768842032016, 34.13166196623823, -769.0941943937339],
  lookAt: [-3.377414762153272, 36.473654819023615, -759.3724439219319],
  rotation: [2.9051946114622647, -0.005135430560327543, 3.140355522200459],
  fov: 45,
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

// Tuned via the in-app Save/Copy values workflow on 2026-05-25.
// Elevation pinned at the orbit floor (0.01°) so the ground plane stays visible
// in ortho mode; focal Y at 150 frames the lower half of the city skyline.
export const DEFAULT_ORBIT: OrbitConfig = {
  centerX: 0,
  centerZ: -120,
  lookAtY: 150,
  radius: 650,
  azimuthDeg: 3.11353259843213,
  elevationDeg: 0.01,
  periodSec: 500,
};

// Azimuth flipped 180° from the 200° tuning that paired with the old camera
// pose: with the new defaults the camera faces +z, so the moon sits at +z too.
export const DEFAULT_MOON = { azimuthDeg: 20, elevationDeg: 32, distance: 4500 };
export const DEFAULT_STARS = { radius: 4500, depth: 200, count: 16000, factor: 200 };

const SAVED_CONFIG_KEY = "starry-night.savedConfig";

type SavedConfig = {
  cameraIntent: CameraIntent;
  orbit: OrbitConfig;
  moon: typeof DEFAULT_MOON;
  stars: typeof DEFAULT_STARS;
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
  stars: { radius: number; depth: number; count: number; factor: number };
  setStars: (patch: Partial<{ radius: number; depth: number; count: number; factor: number }>) => void;
  moon: {
    // Celestial body modelled on a sky dome around the city axis.
    azimuthDeg: number; // compass yaw, 0 = +z (north), 90 = +x (east)
    elevationDeg: number; // angle above horizon, 0 = horizon, 90 = zenith
    distance: number; // radial distance from city centre; default tracks stars.radius
  };
  setMoon: (patch: Partial<SceneState["moon"]>) => void;
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
  fog: { enabled: boolean; near: number; far: number };
  setFog: (patch: Partial<{ enabled: boolean; near: number; far: number }>) => void;
  // Visibility of the orbit focal-point crosshair.
  showFocalIndicator: boolean;
  setShowFocalIndicator: (v: boolean) => void;
  // Intro / wake-up sequence. progress 0..1; mode selects per-window ordering.
  intro: {
    progress: number;
    playing: boolean;
    durationSec: number;
    mode: "random" | "district" | "outside-in" | "far-to-near" | "inside-out";
    // Base period of the post-intro breathing cycle in seconds.
    breathingPeriodSec: number;
  };
  setIntroProgress: (v: number) => void;
  setIntroPlaying: (v: boolean) => void;
  setIntroDuration: (v: number) => void;
  setIntroMode: (m: SceneState["intro"]["mode"]) => void;
  setBreathingPeriod: (v: number) => void;
  playIntro: () => void;
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
  hasSavedConfig: () => boolean;
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
  // Defaults preserve the old (3742, 2321, 200) position:
  //   distance = sqrt(3742² + 2321²) ≈ 4403
  //   elevation = asin(2321 / 4403) ≈ 31.8°
  //   azimuth   = 200°
  // Distance default sits on the star dome (4500) so moon hugs the celestial sphere.
  moon: DEFAULT_MOON,
  setMoon: (patch) => set((s) => ({ moon: { ...s.moon, ...patch } })),
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
  projection: "perspective",
  // 200 ≈ tan(45°/2) × 482 — matches the default-perspective view at the default orbit distance.
  orthoSize: 200,
  projectionBlend: 0,
  setProjection: (projection) => set({ projection }),
  setOrthoSize: (orthoSize) => set({ orthoSize }),
  setProjectionBlend: (projectionBlend) => set({ projectionBlend }),
  flySpeed: 14,
  setFlySpeed: (flySpeed) => set({ flySpeed }),
  fog: { enabled: true, near: 240, far: 2400 },
  setFog: (patch) => set((s) => ({ fog: { ...s.fog, ...patch } })),
  showFocalIndicator: false,
  setShowFocalIndicator: (showFocalIndicator) => set({ showFocalIndicator }),
  intro: {
    progress: 0,
    playing: false,
    durationSec: 24,
    mode: "random",
    breathingPeriodSec: 240,
  },
  setIntroProgress: (progress) => set((s) => ({ intro: { ...s.intro, progress } })),
  setIntroPlaying: (playing) => set((s) => ({ intro: { ...s.intro, playing } })),
  setIntroDuration: (durationSec) =>
    set((s) => ({ intro: { ...s.intro, durationSec } })),
  setIntroMode: (mode) => set((s) => ({ intro: { ...s.intro, mode } })),
  setBreathingPeriod: (breathingPeriodSec) =>
    set((s) => ({ intro: { ...s.intro, breathingPeriodSec } })),
  playIntro: () =>
    set((s) => ({ intro: { ...s.intro, progress: 0, playing: true } })),
  focalDragging: false,
  setFocalDragging: (focalDragging) => set({ focalDragging }),
  orbitPaused: false,
  setOrbitPaused: (orbitPaused) => set({ orbitPaused }),
  orbit: DEFAULT_ORBIT,
  setOrbit: (patch) => set((s) => ({ orbit: { ...s.orbit, ...patch } })),
  perf: { fps: 0, triangles: 0, calls: 0, geometries: 0, textures: 0 },
  setPerf: (perf) => set({ perf }),
  setSeed: (masterSeed) => set({ masterSeed }),
  setLightingMode: (lightingMode) => set({ lightingMode }),
  setQualityTier: (qualityTier) => set({ qualityTier }),
  setPaused: (paused) => set({ paused }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setCameraIntent: (intent) =>
    set((s) => ({ cameraIntent: { ...s.cameraIntent, ...intent } })),
  setCameraLive: (cameraLive) => set({ cameraLive }),
  resetCamera: () => {
    const snap = readSavedConfig();
    if (snap) {
      set({
        cameraIntent: snap.cameraIntent ?? DEFAULT_INTENT,
        orbit: snap.orbit ?? DEFAULT_ORBIT,
        moon: snap.moon ?? DEFAULT_MOON,
        stars: snap.stars ?? DEFAULT_STARS,
        cameraMode: "still",
      });
      return;
    }
    set({
      cameraIntent: DEFAULT_INTENT,
      orbit: DEFAULT_ORBIT,
      moon: DEFAULT_MOON,
      stars: DEFAULT_STARS,
      cameraMode: "still",
    });
  },
  saveCurrentAsDefault: () => {
    const s = get();
    writeSavedConfig({
      cameraIntent: s.cameraIntent,
      orbit: s.orbit,
      moon: s.moon,
      stars: s.stars,
    });
  },
  hasSavedConfig: () => readSavedConfig() !== null,
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
