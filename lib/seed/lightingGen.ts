import seedrandom from "seedrandom";
import * as THREE from "three";
import { kelvinToColor, lerpKelvin } from "@/lib/color/kelvin";
import { SCENE_WB_GAIN } from "@/lib/color/whiteBalance";
import type { Archetype, Building } from "./cityGen";

type LightingProfile = {
  litRatio: number;
  brightRatio: number;
  officeRatio: number;
  neutralRatio: number;
  tvFlickerRatio: number;
};

// Per-building mood — adds intra-archetype variety so adjacent same-archetype
// neighbours feel like different inhabitants.
type Mood = "warm" | "cool" | "sparse" | "blazing" | "neutral" | "neutral-white";

// coolPop=0.4 baseline bias toward office/neutral sources in residential moods.
// Chosen in /palette prototype 2026-05-22.
const COOL_POP_EXTRA_OFFICE = 0.08;
const COOL_POP_EXTRA_NEUTRAL = 0.06;

function profileFor(arch: Archetype): LightingProfile {
  const base = (() => {
    switch (arch) {
      case "residential-tower":
        return {
          litRatio: 0.5,
          brightRatio: 0.15,
          officeRatio: 0.04,
          neutralRatio: 0,
          tvFlickerRatio: 0.1,
        };
      case "narrow-tower":
        return {
          litRatio: 0.55,
          brightRatio: 0.18,
          officeRatio: 0.08,
          neutralRatio: 0,
          tvFlickerRatio: 0.1,
        };
      case "mid-rise":
        return {
          litRatio: 0.46,
          brightRatio: 0.12,
          officeRatio: 0.03,
          neutralRatio: 0,
          tvFlickerRatio: 0.08,
        };
      case "low-rise":
        return {
          litRatio: 0.52,
          brightRatio: 0.1,
          officeRatio: 0.02,
          neutralRatio: 0,
          tvFlickerRatio: 0.06,
        };
      case "warehouse":
        return {
          litRatio: 0.18,
          brightRatio: 0.06,
          officeRatio: 0.5,
          neutralRatio: 0,
          tvFlickerRatio: 0,
        };
      case "office-block":
        return {
          litRatio: 0.32,
          brightRatio: 0.05,
          officeRatio: 0.4,
          neutralRatio: 0,
          tvFlickerRatio: 0,
        };
      case "spire":
        return {
          litRatio: 0.3,
          brightRatio: 0.12,
          officeRatio: 0.15,
          neutralRatio: 0,
          tvFlickerRatio: 0,
        };
    }
  })();
  // The old front/mid/back Z-layer biases (×0.75 / ×0.35 lit) lived here —
  // removed with the still-frame depth bands: they dimmed a fixed world-Z
  // stripe regardless of where the orbit camera looked. Variety now comes
  // from moods, district class, and the per-building facade jitter.
  return base;
}

function pickMood(rng: () => number, building: Building): Mood {
  const arch = building.archetype;
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
    if (wild < 0.2) return "warm";
    if (wild < 0.4) return "cool";
    if (wild < 0.6) return "sparse";
    if (wild < 0.8) return "blazing";
    return "neutral-white";
  }

  // Mixed-use cross-pollination — same archetype reads differently depending on
  // where in the city it sits. Real apartments in a financial district feel
  // like serviced condos / lit boardrooms; corner shops on a residential
  // street feel like warm bodegas.
  const inDowntown = building.coreProximity > 0.4;
  const onResidentialEdge = building.district === "residential" || building.district === "oldtown";

  if (residential && inDowntown) {
    // Residential building dropped into downtown core — bias cool / neutral-white.
    if (r < 0.3) return "cool";
    if (r < 0.55) return "neutral-white";
    if (r < 0.7) return "warm";
    if (r < 0.85) return "blazing";
    if (r < 0.95) return "neutral";
    return "sparse";
  }
  if (officeStyle && onResidentialEdge && building.coreProximity < 0.25) {
    // Office building tucked into a residential / oldtown street — small shop,
    // mixed live-work, bias warmer + more lit.
    if (r < 0.4) return "warm";
    if (r < 0.6) return "neutral";
    if (r < 0.75) return "neutral-white";
    if (r < 0.9) return "blazing";
    return "sparse";
  }

  if (residential) {
    if (r < 0.42) return "warm";
    if (r < 0.62) return "neutral-white";
    if (r < 0.75) return "neutral";
    if (r < 0.9) return "blazing";
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
        officeRatio: 0.07 + COOL_POP_EXTRA_OFFICE,
        neutralRatio: 0.05 + COOL_POP_EXTRA_NEUTRAL,
        tvFlickerRatio: Math.min(0.15, p.tvFlickerRatio + 0.04),
      };
    case "cool":
      return {
        litRatio: Math.min(0.85, p.litRatio * 1.1),
        brightRatio: p.brightRatio * 0.6,
        officeRatio: Math.max(0.55, p.officeRatio + 0.4),
        neutralRatio: 0.1,
        tvFlickerRatio: 0,
      };
    case "sparse":
      return {
        litRatio: p.litRatio * 0.3,
        brightRatio: p.brightRatio * 0.4,
        officeRatio: p.officeRatio,
        neutralRatio: p.neutralRatio,
        tvFlickerRatio: p.tvFlickerRatio * 0.5,
      };
    case "blazing":
      return {
        litRatio: Math.min(0.92, p.litRatio * 1.5),
        brightRatio: Math.min(0.4, p.brightRatio * 2.2),
        officeRatio: p.officeRatio,
        neutralRatio: p.neutralRatio,
        tvFlickerRatio: p.tvFlickerRatio,
      };
    case "neutral-white":
      return {
        litRatio: Math.min(0.82, p.litRatio * 1.05),
        brightRatio: p.brightRatio * 0.7,
        officeRatio: p.officeRatio * 0.5 + COOL_POP_EXTRA_OFFICE,
        neutralRatio: 0.7 + COOL_POP_EXTRA_NEUTRAL,
        tvFlickerRatio: p.tvFlickerRatio,
      };
    case "neutral":
      return {
        ...p,
        officeRatio: p.officeRatio + COOL_POP_EXTRA_OFFICE,
        neutralRatio: p.neutralRatio + COOL_POP_EXTRA_NEUTRAL,
      };
  }
}

function pickKelvin(
  rng: () => number,
  profile: LightingProfile,
): {
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
    // Small chance of a brighter "neon" highlight
    if (rng() < 0.12) {
      return { color: lerpKelvin(rng, 6500, 7200), intensity: 0.95, isTv: false };
    }
    return { color: lerpKelvin(rng, 5000, 5800), intensity: 0.7, isTv: false };
  }
  // Neutral white residential — modern apartment LED bridge between warm + cool
  if (roll < profile.tvFlickerRatio + profile.officeRatio + profile.neutralRatio) {
    return { color: lerpKelvin(rng, 3300, 3800), intensity: 0.55, isTv: false };
  }
  // Bright warm — closer / brighter incandescent (range lifted from 2800-3200K)
  if (
    roll <
    profile.tvFlickerRatio + profile.officeRatio + profile.neutralRatio + profile.brightRatio
  ) {
    return { color: lerpKelvin(rng, 3300, 3700), intensity: 0.75, isTv: false };
  }
  // Dim warm — old bulbs, lamp glow (range lifted from 1800-2200K)
  if (rng() < 0.28) {
    return { color: lerpKelvin(rng, 2700, 3100), intensity: 0.4, isTv: false };
  }
  // Standard warm — common residential (range lifted from 2300-2700K)
  return { color: lerpKelvin(rng, 3200, 3600), intensity: 0.55, isTv: false };
}

export type WindowDataTexture = {
  texture: THREE.DataTexture;
  cols: number;
  rows: number;
};

// Archetypes that may use office-style correlated lighting (blocks, fractional
// floors, whole floors). For these, we pick a per-building cohort; others are
// always per-window.
const OFFICE_ARCHETYPES = new Set<Archetype>(["office-block", "spire"]);

// Lighting/breathing correlation mode for one building:
//   0 = per-window, 1 = per-block, 2 = fractional-floor, 3 = whole-floor.
// Office archetypes: 35% per-window, 25% per-block, 30% fractional-floor and
// only 10% whole-floor — full lit slabs read as a gimmick when common; used
// sparingly they read as trading floors / cleaning crews. Warehouses get a
// fractional minority (aisle light banks). Consumed by the atlas painter
// below (lit-state clustering) AND the fragment shader (band timing, per-face
// segment masks, cross-face row coherence).
export function correlationModeFor(b: Building): number {
  const office = OFFICE_ARCHETYPES.has(b.archetype);
  if (!office && b.archetype !== "warehouse") return 0;
  // Cheap deterministic float from windowSeed.
  const r = (Math.sin(b.windowSeed * 91.3) * 43758.5453) % 1;
  const u = r < 0 ? r + 1 : r;
  if (!office) return u < 0.6 ? 0 : 2; // warehouse: 40% fractional
  if (u < 0.35) return 0;
  if (u < 0.6) return 1;
  if (u < 0.9) return 2;
  return 3;
}

export function generateWindowTexture(masterSeed: string, building: Building): WindowDataTexture {
  const rng = seedrandom(`${masterSeed}::lighting::${building.id}::${building.windowSeed}`);
  const baseProfile = profileFor(building.archetype);
  const mood = pickMood(rng, building);
  const profile = applyMood(baseProfile, mood);

  const cols = building.colsPerFace;
  const rows = building.floors;
  const data = new Uint8Array(cols * rows * 4);
  const mode = correlationModeFor(building);

  // Far-field mip parity: unlit cells keep alpha 0 (the kind gate every
  // consumer branches on) but carry the dim-tungsten RGB the shader draws for
  // them — sRGB((1.0, 0.82, 0.55) × 0.55) — so the mipped far-atlas twin
  // averages lit AND unlit cells into what the near render actually shows.
  // NEAREST near-field sampling never reads alpha-0 RGB, so this is inert up
  // close.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 196;
    data[i + 1] = 179;
    data[i + 2] = 149;
  }

  // Unlit cells stay at the prefill (alpha 0 = unlit).
  // alpha encodes the cell kind: 128 = TV (flickers), 200 = correlated band
  // (steady — the shader wakes/cycles band rows together and cuts per-face
  // segments out of fractional ones), 255 = steady per-window lit. Band cells
  // force TV steady: a whole floor strobing in sync reads as a glitch, not a
  // television.
  const writeRun = (r: number, c0: number, len: number, band: boolean) => {
    const { color, intensity, isTv } = pickKelvin(rng, profile);
    const px0 = Math.min(255, Math.floor(color.r * intensity * SCENE_WB_GAIN.x * 255));
    const px1 = Math.min(255, Math.floor(color.g * intensity * SCENE_WB_GAIN.y * 255));
    const px2 = Math.min(255, Math.floor(color.b * intensity * SCENE_WB_GAIN.z * 255));
    const a = band ? 200 : isTv ? 128 : 255;
    for (let k = 0; k < len; k++) {
      const idx = (r * cols + c0 + k) * 4;
      data[idx + 0] = px0;
      data[idx + 1] = px1;
      data[idx + 2] = px2;
      data[idx + 3] = a;
    }
  };

  const perWindowRow = (r: number) => {
    for (let c = 0; c < cols; c++) {
      if (rng() < profile.litRatio) writeRun(r, c, 1, false);
    }
  };

  if (mode === 3) {
    // Whole-floor: ~40% of floors are bands — ONE lit roll + colour for the
    // entire row, so a lit floor reads as a continuous slab (the shader keeps
    // its timing and corner wrap coherent). The other floors stay per-window,
    // so even a whole-floor tower reads mixed rather than zebra-striped.
    for (let r = 0; r < rows; r++) {
      if (rng() < 0.4) {
        if (rng() < profile.litRatio) writeRun(r, 0, cols, true);
      } else {
        perWindowRow(r);
      }
    }
  } else if (mode === 2) {
    // Fractional-floor: ~60% of floors are bands painted edge-to-edge as a
    // colour base; the SHADER cuts each face down to an uneven seeded segment
    // (a quarter here, the full row there, nothing on the back). The boosted
    // activation compensates for the cut, landing visible brightness back
    // near litRatio.
    for (let r = 0; r < rows; r++) {
      if (rng() < 0.6) {
        if (rng() < Math.min(0.9, profile.litRatio * 2)) writeRun(r, 0, cols, true);
      } else {
        perWindowRow(r);
      }
    }
  } else if (mode === 1) {
    // Per-block: each floor breaks into short runs (2..6 windows) sharing one
    // lit roll + colour — reads as multi-window suites. A TV block is one
    // bright living room spilling across its windows, so flicker stays.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; ) {
        const len = Math.min(cols - c, 2 + Math.floor(rng() * 5));
        if (rng() < profile.litRatio) writeRun(r, c, len, false);
        c += len;
      }
    }
  } else {
    // Per-window — rng call order matches the pre-correlation painter exactly,
    // so every mode-0 building's atlas is byte-identical to before.
    for (let r = 0; r < rows; r++) perWindowRow(r);
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

// ---------------------------------------------------------------------------
// Facade base colour (replaces the FACADE_BY_LAYER world-Z bands, which painted
// a visible stripe across the city diameter under the orbit camera).
//
// Pure per-building random, drawn from a night-material gamut: mostly cool
// blue-blacks (glass/concrete in sodium-less dark), a warm-masonry minority,
// with a skewed lightness spread — dark-glass majority, pale-concrete tail.
// Deterministic from the building's existing windowSeed — no new gen inputs,
// city data (and the golden) untouched.
//
// Authored in DISPLAY space (setHSL with no colour-space conversion): the city
// ShaderMaterial writes gl_FragColor raw — no tonemapping/colorspace chunks —
// so whatever we put in the attribute is what reaches the screen. The earlier
// SRGBColorSpace conversion stored linear values (l 0.045–0.12 → 0.004–0.014),
// which the raw path displayed as 1–4/255: variance present, invisible.
function hash01(x: number): number {
  const s = Math.sin(x * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

// Live-tunable ranges (Buildings panel → Facade); defaults in
// sceneStore.DEFAULT_FACADE. Structural type to keep this seed-layer module
// free of store imports. Hues are in DEGREES (UI-friendly); sat/light 0..1.
export type FacadeRanges = {
  satMin: number;
  satMax: number;
  lightMin: number;
  lightMax: number;
  warmShare: number; // probability a building rolls the warm family
  warmHueMin: number;
  warmHueMax: number;
  coolHueMin: number;
  coolHueMax: number;
};

export function facadeColorFor(
  building: Building,
  out: THREE.Color,
  f: FacadeRanges,
): THREE.Color {
  const r1 = hash01(building.windowSeed * 311.7);
  const r2 = hash01(building.windowSeed * 269.5);
  const r3 = hash01(building.windowSeed * 183.3);
  const r4 = hash01(building.windowSeed * 97.3);
  // Weighted coin picks the hue family (warm masonry vs cool blue-glass),
  // then the hue rolls inside that family's degree window.
  const h =
    (r1 < f.warmShare
      ? f.warmHueMin + r2 * (f.warmHueMax - f.warmHueMin)
      : f.coolHueMin + r2 * (f.coolHueMax - f.coolHueMin)) / 360;
  const s = f.satMin + r3 * (f.satMax - f.satMin);
  const l = f.lightMin + (f.lightMax - f.lightMin) * Math.pow(r4, 1.4); // skewed dark
  return out.setHSL(h, s, l);
}

/** Facade glow: faint downtown ambience (street-light bounce on glass) that
 * fades with distance from the core — replaces the old mid-band-only glow. */
export function facadeGlowFor(building: Building): number {
  return building.coreProximity * 0.06;
}
