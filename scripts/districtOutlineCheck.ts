// District boundary-loop sanity check (mirrors scripts/personaCheck.ts's
// style). Run: bun scripts/districtOutlineCheck.ts
//
// Asserts, for each seed × shape, over every district's snapped boundary
// loops (districtOutline option 2 — traced from the label raster, then
// snapped onto the wall roads' centrelines):
//   (1) ≥1 CCW outer loop (loopSignedArea > 0)
//   (2) net signed area within ±20% of the district's sampled `area`
//   (3) every loop closed and non-degenerate (≥3 distinct points, no
//       duplicated first/last, finite coords)
//   (4) no self-intersections (O(n²) proper seg-seg test per loop — the
//       fills triangulate via THREE.ShapeGeometry, which needs simple loops)

import { generateCity, tensorDistrictField, tensorWallRoads } from "@/lib/seed/cityGen";
import {
  districtBoundaryLoops,
  loopSignedArea,
  type BoundaryLoop,
} from "@/lib/seed/districtOutline";
import type { CityShapeSetting } from "@/lib/seed/cityShape";

const SEEDS = [process.argv[2] ?? "starry-night", "gate1-3"];
const SHAPES: CityShapeSetting[] = ["auto", "square"];

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

// Proper segment intersection (strict crossing — shared endpoints and
// touches don't count; ShapeGeometry tolerates touches, not crossings).
function cross(ox: number, oz: number, ax: number, az: number, bx: number, bz: number): number {
  return (ax - ox) * (bz - oz) - (az - oz) * (bx - ox);
}
function segmentsCross(
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
  d: { x: number; z: number },
): boolean {
  const d1 = cross(a.x, a.z, b.x, b.z, c.x, c.z);
  const d2 = cross(a.x, a.z, b.x, b.z, d.x, d.z);
  const d3 = cross(c.x, c.z, d.x, d.z, a.x, a.z);
  const d4 = cross(c.x, c.z, d.x, d.z, b.x, b.z);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function loopSelfIntersects(loop: BoundaryLoop): boolean {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Adjacent segments share an endpoint — skip (incl. the cyclic pair).
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsCross(a, b, loop[j], loop[(j + 1) % n])) return true;
    }
  }
  return false;
}

function loopClosedAndFinite(loop: BoundaryLoop): boolean {
  if (loop.length < 3) return false;
  for (const p of loop) if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  const first = loop[0];
  const last = loop[loop.length - 1];
  // Loops are implicitly closed (last→first edge); a duplicated endpoint
  // would double-draw and zero-length the closing segment.
  return Math.hypot(first.x - last.x, first.z - last.z) >= 1e-9;
}

for (const seed of SEEDS) {
  for (const shape of SHAPES) {
    // Warm the same module caches the app path uses (shape clips the city;
    // the district field + walls are shape-independent by design).
    generateCity(seed, shape);
    const field = tensorDistrictField(seed);
    const walls = tensorWallRoads(seed);

    const noOuter: string[] = [];
    const areaOff: string[] = [];
    const notClosed: string[] = [];
    const selfCross: string[] = [];
    let loopCount = 0;

    const t0 = Date.now();
    for (const d of field.districts) {
      const loops = districtBoundaryLoops(field, d.index, walls);
      loopCount += loops.length;

      if (!loops.some((l) => loopSignedArea(l) > 0)) noOuter.push(d.id);

      const net = loops.reduce((sum, l) => sum + loopSignedArea(l), 0);
      const ratio = d.area > 0 ? net / d.area : 0;
      if (ratio < 0.8 || ratio > 1.2) areaOff.push(`${d.id} (${(ratio * 100).toFixed(1)}%)`);

      for (const l of loops) {
        if (!loopClosedAndFinite(l)) notClosed.push(d.id);
        if (loopSelfIntersects(l)) selfCross.push(d.id);
      }
    }
    const ms = Date.now() - t0;

    const tag = `${seed} / ${shape}`;
    console.log(
      `\n${tag}: ${field.districts.length} districts, ${loopCount} loops (${ms}ms)`,
    );
    check(`${tag}: every district has ≥1 CCW outer loop`, noOuter.length === 0, noOuter.join(", "));
    check(
      `${tag}: net signed area within ±20% of sampled area`,
      areaOff.length === 0,
      areaOff.join(", "),
    );
    check(`${tag}: all loops closed + finite`, notClosed.length === 0, notClosed.join(", "));
    check(`${tag}: no self-intersecting loops`, selfCross.length === 0, selfCross.join(", "));
  }
}

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures} check(s))`);
process.exit(failures === 0 ? 0 : 1);
