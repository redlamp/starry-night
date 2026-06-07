export type IntroViewMode = "screen" | "snowglobe";

// Screen colour depth, oldest to newest. "bw" is the compact Mac's literal
// 1-bit black/white (ordered dither), "mac256" approximates the classic
// 8-bit system palette via a dithered 6×6×6 quantize.
export type ScreenColorMode = "bw" | "grey" | "mac256" | "full";

// Levels applied to luminance ahead of the 1-bit dither: below lo ⇒ black,
// above hi ⇒ white, dither only in between. Derived from the UI's
// threshold (midpoint) + softness (knee width).
export type BwLevels = { lo: number; hi: number };
export const SCREEN_COLOR_MODE_INDEX: Record<ScreenColorMode, number> = {
  bw: 0,
  grey: 1,
  mac256: 2,
  full: 3,
};
