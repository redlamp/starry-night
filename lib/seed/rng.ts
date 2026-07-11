import seedrandom from "seedrandom";

// --- Fast seeded PRNG (persona layer) ----------------------------------------
// Vendored xmur3 + sfc32 (bryc's canonical implementations,
// github.com/bryc/code/blob/master/jshash/PRNGs.md — public domain). sfc32
// passes PractRand + BigCrush and runs ~an order of magnitude faster than
// seedrandom's ARC4, whose per-instance key schedule dominated the persona
// build (~56k stream constructions). Swapped 2026-07-10, batched with the
// multigen re-roll (see wiki/research/persona-gen-performance.md — changing
// the generator re-rolls every downstream draw, so it had to ride an
// intentional one). Geometry/naming layers stay on seedrandom: swapping them
// would re-roll the city itself.
// Determinism: Math.imul + shifts are exact 32-bit integer ops — engine- and
// platform-identical, unlike transcendental Math.* (ECMA-262 leaves those
// loosely specified).

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// Drop-in replacement for `seedrandom(key)` in the persona layer: hash the
// stream key with xmur3 (full avalanche — `seed + offset` into a linear
// generator is the correlated-streams trap), seed sfc32, burn a few outputs
// to finish mixing the initial state.
export function seededRng(key: string): () => number {
  const h = xmur3(key);
  const rng = sfc32(h(), h(), h(), h());
  for (let i = 0; i < 8; i++) rng();
  return rng;
}

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
