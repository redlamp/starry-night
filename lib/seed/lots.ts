// Lot subdivision — the third tier of the streets-first pipeline. Each block
// (a cell of the street grid, a rectangle in the θ0 frame) is recursively split
// into parcels. One building later sits on each lot, so lot-size variety is
// what makes a block read as a real city block rather than a uniform stamp.
//
// Recursive OBB binary split (CityEngine "OBB" mode / Vanegas 2012, simplified
// to the axis-aligned-in-frame case our structured grid guarantees): cut the
// long axis near the midpoint with seeded irregularity, recurse until a lot is
// small enough or too narrow to split. Pure: all randomness comes from the
// caller-supplied seeded rng.

export type FrameRect = { u0: number; v0: number; u1: number; v1: number };

export type LotOptions = {
  lotMinArea: number; // stop splitting below this area (m²)
  frontageMin: number; // never produce a lot narrower than this on the cut axis (m)
  chanceNoDivide: number; // probability a divisible lot is left whole (plazas/large parcels)
  maxDepth: number;
};

export function subdivideCell(rng: () => number, rect: FrameRect, opts: LotOptions): FrameRect[] {
  const out: FrameRect[] = [];
  const rec = (r: FrameRect, depth: number) => {
    const w = r.u1 - r.u0;
    const h = r.v1 - r.v0;
    const area = w * h;
    const longSide = Math.max(w, h);
    // Stop: deep enough, small enough, too narrow to halve, or a seeded "leave
    // whole" (gives the occasional oversized parcel — a yard, lot, or plaza).
    if (
      depth >= opts.maxDepth ||
      area <= opts.lotMinArea ||
      longSide < 2 * opts.frontageMin ||
      rng() < opts.chanceNoDivide
    ) {
      out.push(r);
      return;
    }
    const t = 0.4 + rng() * 0.2; // cut near the midpoint, with irregularity
    if (w >= h) {
      const cut = r.u0 + w * t;
      rec({ u0: r.u0, v0: r.v0, u1: cut, v1: r.v1 }, depth + 1);
      rec({ u0: cut, v0: r.v0, u1: r.u1, v1: r.v1 }, depth + 1);
    } else {
      const cut = r.v0 + h * t;
      rec({ u0: r.u0, v0: r.v0, u1: r.u1, v1: cut }, depth + 1);
      rec({ u0: r.u0, v0: cut, u1: r.u1, v1: r.v1 }, depth + 1);
    }
  };
  rec(rect, 0);
  return out;
}

// Per-character lot grammar: downtown packs fine parcels, industrial coarse.
import type { DistrictCharacter } from "./district";

export const LOT_GRAMMAR: Record<DistrictCharacter, LotOptions> = {
  downtown: { lotMinArea: 620, frontageMin: 16, chanceNoDivide: 0.08, maxDepth: 5 },
  subcentre: { lotMinArea: 900, frontageMin: 18, chanceNoDivide: 0.1, maxDepth: 5 },
  heritage: { lotMinArea: 320, frontageMin: 10, chanceNoDivide: 0.06, maxDepth: 6 },
  residential: { lotMinArea: 1400, frontageMin: 18, chanceNoDivide: 0.14, maxDepth: 5 },
  industrial: { lotMinArea: 4200, frontageMin: 34, chanceNoDivide: 0.22, maxDepth: 4 },
  "mixed-use": { lotMinArea: 1000, frontageMin: 15, chanceNoDivide: 0.12, maxDepth: 5 },
};
