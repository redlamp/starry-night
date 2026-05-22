import { create } from "zustand";

export type LightingMode = "classic" | "modern";
export type QualityTier = "low" | "med" | "high" | "ultra";
export type CameraMode = "still" | "fly" | "orbit";

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
const DEFAULT_INTENT: CameraIntent = {
  position: [0, 2, 400],
  lookAt: [0, 2, 0],
  rotation: [(16 * Math.PI) / 180, 0, 0],
  fov: 45,
  orient: "rotation",
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
  lookAtY: number; // absolute Y the camera aims at
  cameraY: number; // absolute Y of the camera itself (independent of lookAtY)
  radius: number;
  periodSec: number; // seconds per full revolution
  startAngleDeg: number; // starting angle around the circle
};

const DEFAULT_ORBIT: OrbitConfig = {
  centerX: 0,
  centerZ: -120,
  lookAtY: 240,
  cameraY: 2,
  radius: 650,
  periodSec: 500,
  startAngleDeg: 180,
};

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
  cameraMode: CameraMode;
  cameraIntent: CameraIntent;
  cameraLive: CameraLive;
  cameraTweenRequest: TweenRequest | null;
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
  // Note: cameraMode default is "orbit" — see below.
  cameraMode: "orbit",
  cameraIntent: DEFAULT_INTENT,
  cameraLive: {
    position: DEFAULT_INTENT.position,
    rotation: [0, 0, 0],
    fov: DEFAULT_INTENT.fov,
  },
  cameraTweenRequest: null,
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
  resetCamera: () => set({ cameraIntent: DEFAULT_INTENT, cameraMode: "still" }),
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
