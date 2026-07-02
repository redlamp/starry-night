import seedrandom from "seedrandom";

export type CitySeed = {
  master: string;
  layout: () => number;
  lighting: () => number;
  residents: () => number;
};

export function deriveSeed(master: string, subsystem: string): () => number {
  return seedrandom(`${master}::${subsystem}`);
}

export function createCitySeed(master: string): CitySeed {
  return {
    master,
    layout: deriveSeed(master, "layout"),
    lighting: deriveSeed(master, "lighting"),
    residents: deriveSeed(master, "residents"),
  };
}

/**
 * UI-ONLY entropy: mints a fresh master seed for the reroll buttons.
 * Never import into generation paths — scene state must be a pure function of
 * the master seed (PRD §5 determinism contract). The Math.random() here is the
 * one sanctioned use: choosing WHICH deterministic city to show next.
 */
export function randomSeedForReroll(): string {
  return Math.random().toString(36).slice(2, 10);
}
