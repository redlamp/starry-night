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

function profileFor(arch: Archetype, layer: Layer): LightingProfile {
  const base = (() => {
    switch (arch) {
      case "residential-tower":
        return { litRatio: 0.5, brightRatio: 0.15, officeRatio: 0.0, tvFlickerRatio: 0.05 };
      case "narrow-tower":
        return { litRatio: 0.55, brightRatio: 0.18, officeRatio: 0.05, tvFlickerRatio: 0.05 };
      case "mid-rise":
        return { litRatio: 0.46, brightRatio: 0.12, officeRatio: 0.0, tvFlickerRatio: 0.04 };
      case "low-rise":
        return { litRatio: 0.52, brightRatio: 0.1, officeRatio: 0.0, tvFlickerRatio: 0.03 };
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

function pickKelvin(rng: () => number, profile: LightingProfile): {
  color: THREE.Color;
  intensity: number;
} {
  const roll = rng();
  // TV flicker — cool blue-white, dim
  if (roll < profile.tvFlickerRatio) {
    return { color: kelvinToColor(6500), intensity: 0.55 };
  }
  // Office cool fluorescent
  if (roll < profile.tvFlickerRatio + profile.officeRatio) {
    return { color: lerpKelvin(rng, 4200, 5000), intensity: 0.55 };
  }
  // Bright warm — like a closer / brighter incandescent
  if (roll < profile.tvFlickerRatio + profile.officeRatio + profile.brightRatio) {
    return { color: lerpKelvin(rng, 2800, 3200), intensity: 0.9 };
  }
  // Dim warm — most windows. Old bulbs, lamp glow.
  if (rng() < 0.28) {
    return { color: lerpKelvin(rng, 1800, 2200), intensity: 0.3 };
  }
  // Standard warm — common residential
  return { color: lerpKelvin(rng, 2300, 2700), intensity: 0.55 };
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
  const profile = profileFor(building.archetype, building.layer);

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
      const { color, intensity } = pickKelvin(rng, profile);
      data[idx + 0] = Math.floor(color.r * intensity * 255);
      data[idx + 1] = Math.floor(color.g * intensity * 255);
      data[idx + 2] = Math.floor(color.b * intensity * 255);
      data[idx + 3] = 255;
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
