import seedrandom from "seedrandom";
import * as THREE from "three";
import { kelvinToColor, lerpKelvin } from "@/lib/color/kelvin";
import type { Archetype, Building, Layer } from "./cityGen";

type LightingProfile = {
  litRatio: number;
  brightRatio: number;
  officeRatio: number;
  tvFlickerRatio: number;
};

// Per-building mood — adds intra-archetype variety so adjacent same-archetype
// neighbours feel like different inhabitants.
type Mood = "warm" | "cool" | "sparse" | "blazing" | "neutral";

function profileFor(arch: Archetype, layer: Layer): LightingProfile {
  const base = (() => {
    switch (arch) {
      case "residential-tower":
        return { litRatio: 0.5, brightRatio: 0.15, officeRatio: 0.04, tvFlickerRatio: 0.1 };
      case "narrow-tower":
        return { litRatio: 0.55, brightRatio: 0.18, officeRatio: 0.08, tvFlickerRatio: 0.1 };
      case "mid-rise":
        return { litRatio: 0.46, brightRatio: 0.12, officeRatio: 0.03, tvFlickerRatio: 0.08 };
      case "low-rise":
        return { litRatio: 0.52, brightRatio: 0.1, officeRatio: 0.02, tvFlickerRatio: 0.06 };
      case "warehouse":
        return { litRatio: 0.18, brightRatio: 0.06, officeRatio: 0.5, tvFlickerRatio: 0 };
      case "office-block":
        return { litRatio: 0.32, brightRatio: 0.05, officeRatio: 0.4, tvFlickerRatio: 0 };
      case "spire":
        return { litRatio: 0.3, brightRatio: 0.12, officeRatio: 0.15, tvFlickerRatio: 0 };
    }
  })();
  if (layer === "front") return { ...base, litRatio: base.litRatio * 0.75 };
  if (layer === "back") return { ...base, litRatio: base.litRatio * 0.35, brightRatio: 0 };
  return base;
}

function pickMood(rng: () => number, arch: Archetype): Mood {
  const residential =
    arch === "residential-tower" ||
    arch === "narrow-tower" ||
    arch === "mid-rise" ||
    arch === "low-rise";
  const officeStyle = arch === "office-block" || arch === "spire" || arch === "warehouse";
  const r = rng();

  // Wildcard mood — 10% chance regardless of archetype
  if (r < 0.1) {
    const wild = rng();
    if (wild < 0.25) return "warm";
    if (wild < 0.5) return "cool";
    if (wild < 0.75) return "sparse";
    return "blazing";
  }

  if (residential) {
    if (r < 0.5) return "warm";
    if (r < 0.7) return "neutral";
    if (r < 0.88) return "blazing";
    return "sparse";
  }
  if (officeStyle) {
    if (r < 0.35) return "sparse";
    if (r < 0.8) return "cool";
    if (r < 0.93) return "neutral";
    return "blazing";
  }
  return "neutral";
}

function applyMood(p: LightingProfile, mood: Mood): LightingProfile {
  switch (mood) {
    case "warm":
      return {
        litRatio: Math.min(0.85, p.litRatio * 1.1),
        brightRatio: p.brightRatio * 1.2,
        officeRatio: 0,
        tvFlickerRatio: Math.min(0.15, p.tvFlickerRatio + 0.04),
      };
    case "cool":
      return {
        litRatio: Math.min(0.85, p.litRatio * 1.1),
        brightRatio: p.brightRatio * 0.6,
        officeRatio: Math.max(0.55, p.officeRatio + 0.4),
        tvFlickerRatio: 0,
      };
    case "sparse":
      return {
        litRatio: p.litRatio * 0.3,
        brightRatio: p.brightRatio * 0.4,
        officeRatio: p.officeRatio,
        tvFlickerRatio: p.tvFlickerRatio * 0.5,
      };
    case "blazing":
      return {
        litRatio: Math.min(0.92, p.litRatio * 1.5),
        brightRatio: Math.min(0.4, p.brightRatio * 2.2),
        officeRatio: p.officeRatio,
        tvFlickerRatio: p.tvFlickerRatio,
      };
    case "neutral":
      return p;
  }
}

function pickKelvin(rng: () => number, profile: LightingProfile): {
  color: THREE.Color;
  intensity: number;
  isTv: boolean;
} {
  const roll = rng();
  // TV flicker — cool blue-white, dim
  if (roll < profile.tvFlickerRatio) {
    return { color: kelvinToColor(6500), intensity: 0.55, isTv: true };
  }
  // Office cool fluorescent — visibly blue-white now
  if (roll < profile.tvFlickerRatio + profile.officeRatio) {
    // Small chance of a brighter "neon" 6800K highlight
    if (rng() < 0.12) {
      return { color: lerpKelvin(rng, 6500, 7200), intensity: 0.95, isTv: false };
    }
    return { color: lerpKelvin(rng, 5000, 5800), intensity: 0.7, isTv: false };
  }
  // Bright warm — like a closer / brighter incandescent
  if (roll < profile.tvFlickerRatio + profile.officeRatio + profile.brightRatio) {
    return { color: lerpKelvin(rng, 2800, 3200), intensity: 0.9, isTv: false };
  }
  // Dim warm — most windows. Old bulbs, lamp glow.
  if (rng() < 0.28) {
    return { color: lerpKelvin(rng, 1800, 2200), intensity: 0.3, isTv: false };
  }
  // Standard warm — common residential
  return { color: lerpKelvin(rng, 2300, 2700), intensity: 0.55, isTv: false };
}

export type WindowDataTexture = {
  texture: THREE.DataTexture;
  cols: number;
  rows: number;
};

export function generateWindowTexture(
  masterSeed: string,
  building: Building,
): WindowDataTexture {
  const rng = seedrandom(`${masterSeed}::lighting::${building.id}::${building.windowSeed}`);
  const baseProfile = profileFor(building.archetype, building.layer);
  const mood = pickMood(rng, building.archetype);
  const profile = applyMood(baseProfile, mood);

  const cols = building.colsPerFace;
  const rows = building.floors;
  const data = new Uint8Array(cols * rows * 4);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c) * 4;
      const lit = rng() < profile.litRatio;
      if (!lit) {
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }
      const { color, intensity, isTv } = pickKelvin(rng, profile);
      data[idx + 0] = Math.floor(color.r * intensity * 255);
      data[idx + 1] = Math.floor(color.g * intensity * 255);
      data[idx + 2] = Math.floor(color.b * intensity * 255);
      // alpha encodes TV flag: 128 = TV (flickers), 255 = steady lit, 0 = unlit
      data[idx + 3] = isTv ? 128 : 255;
    }
  }

  const texture = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return { texture, cols, rows };
}

// Muted, low-saturation. Mid keeps slight teal tint; front near-black; back deep navy.
export const FACADE_BY_LAYER: Record<Layer, string> = {
  front: "#08080f",
  mid: "#243648",
  back: "#0c121e",
};

export const GLOW_BY_LAYER: Record<Layer, number> = {
  front: 0,
  mid: 0.1,
  back: 0,
};
