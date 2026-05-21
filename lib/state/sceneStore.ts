import { create } from "zustand";

export type LightingMode = "classic" | "modern";
export type QualityTier = "low" | "med" | "high" | "ultra";

type SceneState = {
  masterSeed: string;
  lightingMode: LightingMode;
  qualityTier: QualityTier;
  paused: boolean;
  setSeed: (seed: string) => void;
  setLightingMode: (mode: LightingMode) => void;
  setQualityTier: (tier: QualityTier) => void;
  setPaused: (paused: boolean) => void;
};

export const useSceneStore = create<SceneState>((set) => ({
  masterSeed: "starry-night-0",
  lightingMode: "classic",
  qualityTier: "high",
  paused: false,
  setSeed: (masterSeed) => set({ masterSeed }),
  setLightingMode: (lightingMode) => set({ lightingMode }),
  setQualityTier: (qualityTier) => set({ qualityTier }),
  setPaused: (paused) => set({ paused }),
}));
