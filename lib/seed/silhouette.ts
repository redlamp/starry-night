import seedrandom from "seedrandom";
import type { District } from "./district";

// Silhouette templates for high-rise districts (downtown / subcentre).
//
// Each template is a height-multiplier field over the district: building height
// is scaled by multiplier(x, z) on top of the per-character cap. This is what
// gives each high-rise cluster a recognisable skyline shape from the slow-orbit
// camera — the BotW "spires/peaks draw the eye at distance" idea, grounded in
// real planning forms. See wiki/notes/decision-streets-first-city-generation.md
// §Silhouette templates.

export type SilhouetteTemplate = "tabletop" | "wedding-cake" | "twin-peak" | "landmark";

export type SilhouetteField = {
  template: SilhouetteTemplate;
  peaks: Array<{ x: number; z: number }>;
  radius: number; // characteristic district radius (m)
  // Height multiplier at a world point (≈0.7 valleys … ≈2.6 a landmark spike).
  multiplier: (x: number, z: number) => number;
  // 0..1 proximity to the nearest peak — feeds archetype + lighting bias.
  proximity: (x: number, z: number) => number;
};

// Weights from the decision note: 0.45 / 0.30 / 0.15 / 0.10.
export function pickTemplate(rng: () => number): SilhouetteTemplate {
  const r = rng();
  if (r < 0.45) return "tabletop";
  if (r < 0.75) return "wedding-cake";
  if (r < 0.9) return "twin-peak";
  return "landmark";
}

function districtRadius(d: District): number {
  // Prefer area-derived radius; fall back to bbox half-diagonal.
  const fromArea = Math.sqrt(Math.max(1, d.area) / Math.PI);
  const fromBox = 0.5 * Math.hypot(d.maxX - d.minX, d.maxZ - d.minZ);
  return Math.max(40, Math.min(fromArea, fromBox));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function buildSilhouette(masterSeed: string, district: District): SilhouetteField {
  const rng = seedrandom(`${masterSeed}::silhouette::${district.id}`);
  const template = pickTemplate(rng);
  const radius = districtRadius(district);
  const cx = district.centroidX;
  const cz = district.centroidZ;

  const distToNearestPeak = (peaks: Array<{ x: number; z: number }>, x: number, z: number) => {
    let best = Infinity;
    for (const p of peaks) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < best) best = d;
    }
    return best;
  };

  let peaks: Array<{ x: number; z: number }>;
  let multiplier: (x: number, z: number) => number;

  if (template === "tabletop") {
    // Flat-topped plateau: uniform tall across the core, soft falloff at the rim.
    peaks = [{ x: cx, z: cz }];
    const peakH = 1.5;
    const baseH = 0.8;
    multiplier = (x, z) => {
      const t = distToNearestPeak(peaks, x, z) / radius;
      return baseH + (peakH - baseH) * smoothstep(0.85, 0.3, t);
    };
  } else if (template === "wedding-cake") {
    // Concentric setback tiers (NYC 1916). Discrete height steps outward.
    peaks = [{ x: cx, z: cz }];
    multiplier = (x, z) => {
      const t = distToNearestPeak(peaks, x, z) / radius;
      if (t < 0.33) return 1.9;
      if (t < 0.66) return 1.35;
      if (t < 1.0) return 0.95;
      return 0.7;
    };
  } else if (template === "twin-peak") {
    // Two local maxima — a bipolar cluster (e.g. a financial core + a hotel cluster).
    const off = radius * 0.45;
    const ang = rng() * Math.PI;
    peaks = [
      { x: cx + Math.cos(ang) * off, z: cz + Math.sin(ang) * off },
      { x: cx - Math.cos(ang) * off, z: cz - Math.sin(ang) * off },
    ];
    const sigma = radius * 0.4;
    const peakH = 1.8;
    const baseH = 0.7;
    multiplier = (x, z) => {
      const d = distToNearestPeak(peaks, x, z);
      const g = Math.exp(-((d / sigma) ** 2));
      return baseH + (peakH - baseH) * g;
    };
  } else {
    // Landmark: one dominant supertall over a lower surround.
    const off = radius * 0.25;
    const ang = rng() * Math.PI * 2;
    peaks = [{ x: cx + Math.cos(ang) * off, z: cz + Math.sin(ang) * off }];
    const sigma = radius * 0.28;
    const peakH = 2.6;
    const baseH = 0.85;
    multiplier = (x, z) => {
      const d = distToNearestPeak(peaks, x, z);
      const g = Math.exp(-((d / sigma) ** 2));
      return baseH + (peakH - baseH) * g;
    };
  }

  const proximity = (x: number, z: number) =>
    Math.max(0, 1 - distToNearestPeak(peaks, x, z) / radius);

  return { template, peaks, radius, multiplier, proximity };
}

export function isHighRise(character: District["character"]): boolean {
  return character === "downtown" || character === "subcentre";
}
