import type { Building } from "@/lib/seed/cityGen";
import { correlationModeFor, generateWindowTexture } from "@/lib/seed/lightingGen";
import type { WindowRanges } from "./index";

// Shared cell-state logic for the baked approaches: which cells glow at time t,
// in what colour, at what pane size. Both the mip rack (canvas rasteriser) and
// the SDF rack (distance-field rasteriser) consume the same list, so they
// differ only in HOW a cell becomes pixels — the lab's whole premise.

export const CELL_PX = 16;

// Production wake/sleep numbers (uOffCycle / uRetrigger / uCycleJitter scene
// defaults): a lit-capable cell is ON ~60 s then OFF ~30 s, period jittered
// ±30% per cell — at any instant roughly 2/3 of them glow.
export const ON_SECONDS = 60;
export const OFF_SECONDS = 30;
export const CYCLE_JITTER = 0.3;

// The shader's default tungsten for atlas-unlit cells — (1.0, 0.82, 0.55) *
// uEmissiveBoost * 0.55, authored in GLSL and displayed raw, so raw bytes.
export const TUNGSTEN: readonly [number, number, number] = [196, 161, 108];

// Exact sRGB electro-optical transfer (decode), 0..1.
export function srgbToLinear(u: number): number {
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

// float32 emulation of the shader's hash11 (Hoskins fract hash) so the bakes
// roll the SAME per-building values as cityInstanced. fround after each op
// mirrors GLSL float32 rounding; FMA differences can still nudge a roll by
// ~1e-3, invisible at these ranges.
export const f = Math.fround;
export function hash11(p: number): number {
  p = f(p * f(0.1031));
  p = f(p - Math.floor(p));
  p = f(p * f(p + f(33.33)));
  p = f(p * f(p + p));
  return f(p - Math.floor(p));
}

// The shader's per-building simple-mode fraction roll, replicated exactly:
// vBuildingHash = windowSeed * 1000 (float32 attribute), independent hashes per
// dimension, clamp, and the >= 0.98 seamless snap.
export function rollFractions(
  b: Building,
  windows: WindowRanges,
): { fracW: number; fracH: number } {
  const bHash = f(b.windowSeed * 1000);
  const wRoll = hash11(f(f(bHash * f(2.3)) + 13.0));
  const hRoll = hash11(f(f(bHash * f(3.7)) + 29.0));
  let fracW = windows.wMin + (windows.wMax - windows.wMin) * wRoll;
  let fracH = windows.hMin + (windows.hMax - windows.hMin) * hRoll;
  fracW = Math.min(1, Math.max(0.05, fracW));
  fracH = Math.min(1, Math.max(0.05, fracH));
  if (fracW >= 0.98) fracW = 1;
  if (fracH >= 0.98) fracH = 1;
  return { fracW, fracH };
}

// Wake/sleep duty: is this cell's light on at time t? Seeded phase + jittered
// period per cell — deterministic, matching the shader's cycle STATISTICS
// (not its exact per-cell schedule, which lives in GLSL cell hashes).
export function cellLitNow(bHash: number, r: number, c: number, t: number): boolean {
  const u = hash11(f(bHash * f(3.1) + r * f(13.7) + c * f(5.9) + 7.0));
  const jit = 1 + (hash11(f(bHash + r * f(2.7) + c * f(11.3) + 17.0)) - 0.5) * 2 * CYCLE_JITTER;
  const period = (ON_SECONDS + OFF_SECONDS) * jit;
  const phase = (t + u * period) % period;
  return phase < ON_SECONDS * jit;
}

// One glowing pane: grid cell (r, c), display-parity colour bytes, pane size
// as a fraction of the cell, and the cell kind (bands draw as slabs; the
// atlas-SDF rack encodes kind per texel). Dark cells are simply absent.
export type CellPaint = {
  r: number;
  c: number;
  rgb: readonly [number, number, number];
  fw: number;
  fh: number;
  kind: "window" | "band" | "tv";
};

// Resolve every glowing cell of a building at time t. Encapsulates the whole
// parity recipe: production per-cell state (lit / band / TV via
// generateWindowTexture), the fractional band segment cut, wake/sleep duty,
// tungsten fill on atlas-unlit cells, and the sRGB-decode + clamp that matches
// the shader's raw framebuffer write (see BakedFacadeRack header).
export function collectCells(
  b: Building,
  seed: string,
  windows: WindowRanges,
  timeSec: number,
): { cols: number; rows: number; cells: CellPaint[] } {
  const winTex = generateWindowTexture(seed, b);
  const data = winTex.texture.image.data as Uint8Array;
  const { cols, rows } = winTex;
  winTex.texture.dispose();

  const { fracW, fracH } = rollFractions(b, windows);
  const fractionalBands = correlationModeFor(b) === 2;
  const bHash = f(b.windowSeed * 1000);
  const cells: CellPaint[] = [];

  for (let r = 0; r < rows; r++) {
    let bandC0 = 0;
    let bandLen = cols;
    if (fractionalBands) {
      // Approximation of the shader's per-face seeded segment cut (deterministic,
      // but not the same segments — the shader rolls per face, the bake per row).
      const u1 = hash11(f(bHash * f(5.3) + r * f(7.1) + 1.0));
      const u2 = hash11(f(bHash * f(9.7) + r * f(3.3) + 2.0));
      bandC0 = Math.floor(u1 * cols * 0.5);
      bandLen = Math.max(1, Math.floor(cols * (0.25 + u2 * 0.6)));
    }
    // Band rows wake/sleep as one unit (whole-row duty roll); per-window cells
    // roll individually below.
    const bandLit = cellLitNow(bHash, r, 1023, timeSec);
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c) * 4;
      const a = data[idx + 3];
      if (a === 0) {
        // Atlas-UNLIT cells still glow dim tungsten in the shader, cycling
        // like any window — about half of a settled facade's lit look.
        if (!cellLitNow(bHash, r, c, timeSec)) continue;
        cells.push({ r, c, rgb: TUNGSTEN, fw: fracW, fh: fracH, kind: "window" });
        continue;
      }
      if (a === 200 && fractionalBands && (c < bandC0 || c >= bandC0 + bandLen)) continue;
      if (a === 200 ? !bandLit : a !== 128 && !cellLitNow(bHash, r, c, timeSec)) continue;
      // COLOUR PARITY: hardware sRGB decode of the authored atlas colour, times
      // the emissive boost, per-channel clamped like the raw gl_FragColor.
      const boost = a === 128 ? 0.55 : 1.4; // TVs time-averaged; else uEmissiveBoost
      const cr = Math.min(1, srgbToLinear(data[idx + 0] / 255) * boost);
      const cg = Math.min(1, srgbToLinear(data[idx + 1] / 255) * boost);
      const cb = Math.min(1, srgbToLinear(data[idx + 2] / 255) * boost);
      cells.push({
        r,
        c,
        rgb: [Math.round(cr * 255), Math.round(cg * 255), Math.round(cb * 255)],
        // Bands read as continuous slabs; windows/TVs as centred panes.
        fw: a === 200 ? 0.96 : fracW,
        fh: a === 200 ? fracH * 1.2 : fracH,
        kind: a === 200 ? "band" : a === 128 ? "tv" : "window",
      });
    }
  }
  return { cols, rows, cells };
}
