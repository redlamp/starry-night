// Moon phase from the calendar date — the synodic approximation (Walker /
// Duffett-Smith lineage). Accurate to ~½–1 day, far below the eye's threshold for
// reading a phase, and a pure function of the date — so we sample `new Date()` ONCE
// at mount and store the result, never in the render loop (no clock in scene state).
// See wiki/research/moon-rendering.md §2.

export const SYNODIC_DAYS = 29.530588853; // mean synodic month (new → new)
// A known new moon: 2000-01-06 18:14 UTC.
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14);

export type MoonPhase = {
  /** position in the synodic cycle, 0..1 (0 = new, 0.5 = full). */
  cyclePos: number;
  /** elongation θ in radians (0 = new, π = full). */
  elongation: number;
  /** illuminated fraction of the disc, 0..1 = (1 − cos θ) / 2. */
  fraction: number;
  /** true from new → full (lit side growing). */
  waxing: boolean;
};

/** Cycle position 0..1 (0 = new) for a given date. */
export function cyclePositionFromDate(date: Date): number {
  const days = (date.getTime() - NEW_MOON_EPOCH_MS) / 86_400_000;
  const p = (days % SYNODIC_DAYS) / SYNODIC_DAYS;
  return p < 0 ? p + 1 : p;
}

/** Derive the phase quantities from a cycle position (0..1, 0 = new). */
export function moonPhase(cyclePos: number): MoonPhase {
  const elongation = cyclePos * 2 * Math.PI; // 0 = new, π = full, 2π = new
  const fraction = (1 - Math.cos(elongation)) / 2;
  return { cyclePos, elongation, fraction, waxing: cyclePos < 0.5 };
}
