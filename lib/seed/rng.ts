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

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
