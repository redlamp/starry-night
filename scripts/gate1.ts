/**
 * Gate 1 — quantitative correctness asserts for the streets-first generator.
 *
 *   bun run scripts/gate1.ts            # default 20 seeds
 *   bun run scripts/gate1.ts a b c ...  # specific seeds
 *
 * Checks, per seed:
 *   1. No building overlaps   — rotation-aware OBB/SAT, 0.3m penetration tolerance.
 *   2. No corridor violations — no building centre on a highway/arterial surface.
 *   3. District sanity        — 6..26 districts; every building maps to a real one.
 *   4. In-bounds              — every building within the city bbox + slack.
 * Plus a determinism check on the full CityData.
 *
 * Exits non-zero if any assert fails. This is the Stage 1 verification Gate 1
 * from wiki/notes/decision-streets-first-city-generation.md.
 */
import { generateCity, type Building } from "@/lib/seed/cityGen";
import { CITY_CENTER, MAX_HALF_EXTENT } from "@/lib/seed/topology";
import { computeLattice } from "@/lib/seed/lattice";

type Vec = { x: number; z: number };

// Project an OBB onto an axis; return [min,max] of the 4 corners.
function projectOBB(b: Building, ax: number, az: number): [number, number] {
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const corners: Vec[] = [
    { x: b.x + (c * hw - s * hd), z: b.z + (s * hw + c * hd) },
    { x: b.x + (c * hw + s * hd), z: b.z + (s * hw - c * hd) },
    { x: b.x + (-c * hw - s * hd), z: b.z + (-s * hw + c * hd) },
    { x: b.x + (-c * hw + s * hd), z: b.z + (-s * hw - c * hd) },
  ];
  let min = Infinity;
  let max = -Infinity;
  for (const p of corners) {
    const d = p.x * ax + p.z * az;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

// Separating Axis Theorem for two rotated rectangles. Returns the minimum
// penetration depth across the 4 candidate axes (≤0 means separated).
function obbPenetration(a: Building, b: Building): number {
  const axes: Vec[] = [
    { x: Math.cos(a.rotationY), z: Math.sin(a.rotationY) },
    { x: -Math.sin(a.rotationY), z: Math.cos(a.rotationY) },
    { x: Math.cos(b.rotationY), z: Math.sin(b.rotationY) },
    { x: -Math.sin(b.rotationY), z: Math.cos(b.rotationY) },
  ];
  let minPen = Infinity;
  for (const ax of axes) {
    const [amin, amax] = projectOBB(a, ax.x, ax.z);
    const [bmin, bmax] = projectOBB(b, ax.x, ax.z);
    const overlap = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (overlap <= 0) return 0; // separating axis found
    if (overlap < minPen) minPen = overlap;
  }
  return minPen;
}

function pointSegDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(x - ax, z - az);
  let t = ((x - ax) * dx + (z - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

const OVERLAP_TOL = 0.3; // m of penetration we tolerate (rounding noise)
// Spatial-hash cell for the overlap + corridor broad-phases — ≥ the 70m overlap
// window and ≥ any road half-width, so a 3×3 neighbourhood query is exhaustive.
// Turns both checks O(n) so gate1 stays tractable at MAX (~22k buildings).
const GRID_CELL = 80;

function checkSeed(seed: string) {
  const { buildings, districts, topology, arterials, streets } = generateCity(seed);
  const failures: string[] = [];

  // 1. Overlaps — spatial-hash broad-phase (O(n) at MAX's ~22k buildings), then OBB/SAT.
  const bGrid = new Map<string, number[]>();
  for (let i = 0; i < buildings.length; i++) {
    const k = `${Math.floor(buildings[i].x / GRID_CELL)},${Math.floor(buildings[i].z / GRID_CELL)}`;
    const cell = bGrid.get(k);
    if (cell) cell.push(i);
    else bGrid.set(k, [i]);
  }
  let overlaps = 0;
  for (let i = 0; i < buildings.length; i++) {
    const a = buildings[i];
    const ci = Math.floor(a.x / GRID_CELL);
    const cj = Math.floor(a.z / GRID_CELL);
    const ra = Math.hypot(a.width, a.depth) / 2;
    for (let gi = ci - 1; gi <= ci + 1; gi++) {
      for (let gj = cj - 1; gj <= cj + 1; gj++) {
        const cell = bGrid.get(`${gi},${gj}`);
        if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue; // process each pair once (smaller index iterates)
          const b = buildings[j];
          if (Math.abs(a.x - b.x) > 70 || Math.abs(a.z - b.z) > 70) continue;
          const rb = Math.hypot(b.width, b.depth) / 2;
          if (Math.hypot(a.x - b.x, a.z - b.z) > ra + rb) continue;
          if (obbPenetration(a, b) > OVERLAP_TOL) overlaps++;
        }
      }
    }
  }
  if (overlaps > 0) failures.push(`${overlaps} building overlaps`);

  // 2. Corridor violations — bucket road segments into the grid, then test each
  //    building against only the segments in its 3×3 neighbourhood (O(n) at MAX).
  const roads = [...topology.highways, ...arterials, ...streets];
  const segGrid = new Map<
    string,
    Array<{ ax: number; az: number; bx: number; bz: number; w: number }>
  >();
  for (const r of roads) {
    const verts = r.vertices;
    const last = r.closed ? verts.length : verts.length - 1;
    const w = r.width / 2;
    for (let i = 0; i < last; i++) {
      const p = verts[i];
      const q = verts[(i + 1) % verts.length];
      const seg = { ax: p.x, az: p.z, bx: q.x, bz: q.z, w };
      const loI = Math.floor((Math.min(p.x, q.x) - w) / GRID_CELL);
      const hiI = Math.floor((Math.max(p.x, q.x) + w) / GRID_CELL);
      const loJ = Math.floor((Math.min(p.z, q.z) - w) / GRID_CELL);
      const hiJ = Math.floor((Math.max(p.z, q.z) + w) / GRID_CELL);
      for (let gi = loI; gi <= hiI; gi++) {
        for (let gj = loJ; gj <= hiJ; gj++) {
          const k = `${gi},${gj}`;
          const cell = segGrid.get(k);
          if (cell) cell.push(seg);
          else segGrid.set(k, [seg]);
        }
      }
    }
  }
  let corridorHits = 0;
  for (const bld of buildings) {
    const ci = Math.floor(bld.x / GRID_CELL);
    const cj = Math.floor(bld.z / GRID_CELL);
    let hit = false;
    for (let gi = ci - 1; gi <= ci + 1 && !hit; gi++) {
      for (let gj = cj - 1; gj <= cj + 1 && !hit; gj++) {
        const cell = segGrid.get(`${gi},${gj}`);
        if (!cell) continue;
        for (const s of cell) {
          if (pointSegDist(bld.x, bld.z, s.ax, s.az, s.bx, s.bz) < s.w) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) corridorHits++;
  }
  if (corridorHits > 0) failures.push(`${corridorHits} corridor violations`);

  // 3. District sanity.
  if (districts.length < 6 || districts.length > 26) {
    failures.push(`district count ${districts.length} out of [6,26]`);
  }
  const ids = new Set(districts.map((d) => d.id));
  const orphans = buildings.filter((b) => !ids.has(b.districtId)).length;
  if (orphans > 0) failures.push(`${orphans} buildings with unknown districtId`);

  // 4. In-bounds (+10% slack).
  const slack = MAX_HALF_EXTENT * 1.1;
  const oob = buildings.filter(
    (b) => Math.abs(b.x - CITY_CENTER.x) > slack || Math.abs(b.z - CITY_CENTER.z) > slack,
  ).length;
  if (oob > 0) failures.push(`${oob} buildings out of bounds`);

  return { buildings: buildings.length, districts: districts.length, failures };
}

function main() {
  const args = process.argv.slice(2);
  const seeds = args.length > 0 ? args : Array.from({ length: 20 }, (_, i) => `gate1-${i}`);
  let failed = 0;

  console.log("Gate 1 — tensor-field city generator asserts\n");

  // The default (and only) city model is tensor. Run the 20-seed suite on it:
  // no overlaps, no road-corridor hits, district count in band, in-bounds.
  console.log("seed           buildings  districts  result");
  for (const seed of seeds) {
    const r = checkSeed(seed);
    const ok = r.failures.length === 0;
    if (!ok) failed++;
    console.log(
      `${seed.padEnd(14)} ${String(r.buildings).padStart(8)} ${String(r.districts).padStart(10)}  ${
        ok ? "PASS" : "FAIL — " + r.failures.join("; ")
      }`,
    );
  }

  // Determinism — the tensor city is a pure function of the seed.
  const d1 = JSON.stringify(generateCity("gate1-det"));
  const d2 = JSON.stringify(generateCity("gate1-det"));
  const detOk = d1 === d2;
  console.log(`\ndeterminism: ${detOk ? "PASS" : "FAIL"}`);
  if (!detOk) failed++;

  // Streets present — the tensor city always lays arterials + minor streets.
  let streetTotal = 0;
  let arterialTotal = 0;
  for (const s of ["gate1-2", "gate1-5", "gate1-9", "gate1-13", "gate1-16"]) {
    const c = generateCity(s);
    streetTotal += c.streets.length;
    arterialTotal += c.arterials.length;
  }
  const streetsOk = streetTotal > 0 && arterialTotal > 0;
  console.log(
    `streets: ${arterialTotal} arterials, ${streetTotal} minor across 5 seeds ${streetsOk ? "PASS" : "FAIL"}`,
  );
  if (!streetsOk) failed++;

  // The lattice is a pure deterministic function with a
  // center-anchored orientation field whose neighbour-delta stays small.
  const L1 = computeLattice("gate1-det");
  const L2 = computeLattice("gate1-det");
  let latticeOk = L1.theta0 === L2.theta0 && L1.driftMag === L2.driftMag;
  let maxDelta = 0;
  for (let x = CITY_CENTER.x - MAX_HALF_EXTENT; x <= CITY_CENTER.x + MAX_HALF_EXTENT; x += 200) {
    for (let z = CITY_CENTER.z - MAX_HALF_EXTENT; z <= CITY_CENTER.z + MAX_HALF_EXTENT; z += 200) {
      if (L1.orientationAt(x, z) !== L2.orientationAt(x, z)) latticeOk = false;
      const d = Math.abs(L1.orientationAt(x, z) - L1.orientationAt(x + 50, z));
      if (d > maxDelta) maxDelta = d;
    }
  }
  const neighbourOk = maxDelta < L1.driftMag;
  console.log(
    `lattice: determinism ${latticeOk ? "PASS" : "FAIL"}; neighbour-delta ${maxDelta.toFixed(4)} (< ${L1.driftMag.toFixed(4)}) ${neighbourOk ? "PASS" : "FAIL"}`,
  );
  if (!latticeOk || !neighbourOk) failed++;

  console.log(`\n${failed === 0 ? "GATE 1 PASS" : `GATE 1 FAIL (${failed} seed(s))`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
