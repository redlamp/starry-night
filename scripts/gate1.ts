/**
 * Gate 1 — quantitative correctness asserts for the streets-first generator.
 *
 *   bun run scripts/gate1.ts            # default 20 seeds
 *   bun run scripts/gate1.ts a b c ...  # specific seeds
 *
 * Checks, per seed:
 *   1. No building overlaps   — rotation-aware OBB/SAT, 0.3m penetration tolerance.
 *   2. No corridor violations — no building centre on a highway/arterial surface.
 *   3. District sanity        — 3..8 districts; every building maps to a real one.
 *   4. In-bounds              — every building within the city bbox + slack.
 * Plus a determinism check on the full CityData.
 *
 * Exits non-zero if any assert fails. This is the Stage 1 verification Gate 1
 * from wiki/notes/decision-streets-first-city-generation.md.
 */
import { generateCity, type Building } from "@/lib/seed/cityGen";
import { CITY_CENTER, CITY_HALF_EXTENT } from "@/lib/seed/topology";

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

function checkSeed(seed: string) {
  const { buildings, districts, topology, arterials } = generateCity(seed);
  const failures: string[] = [];

  // 1. Overlaps (broad-phase by centre distance, then OBB/SAT).
  let overlaps = 0;
  for (let i = 0; i < buildings.length; i++) {
    const a = buildings[i];
    const ra = Math.hypot(a.width, a.depth) / 2;
    for (let j = i + 1; j < buildings.length; j++) {
      const b = buildings[j];
      if (Math.abs(a.x - b.x) > 70 || Math.abs(a.z - b.z) > 70) continue;
      const rb = Math.hypot(b.width, b.depth) / 2;
      if (Math.hypot(a.x - b.x, a.z - b.z) > ra + rb) continue;
      if (obbPenetration(a, b) > OVERLAP_TOL) overlaps++;
    }
  }
  if (overlaps > 0) failures.push(`${overlaps} building overlaps`);

  // 2. Corridor violations — building centre on a road surface.
  const roads = [...topology.highways, ...arterials];
  let corridorHits = 0;
  for (const bld of buildings) {
    for (const r of roads) {
      const verts = r.vertices;
      const last = r.closed ? verts.length : verts.length - 1;
      let hit = false;
      for (let i = 0; i < last; i++) {
        const p = verts[i];
        const q = verts[(i + 1) % verts.length];
        if (pointSegDist(bld.x, bld.z, p.x, p.z, q.x, q.z) < r.width / 2) {
          hit = true;
          break;
        }
      }
      if (hit) {
        corridorHits++;
        break;
      }
    }
  }
  if (corridorHits > 0) failures.push(`${corridorHits} corridor violations`);

  // 3. District sanity.
  if (districts.length < 3 || districts.length > 8) {
    failures.push(`district count ${districts.length} out of [3,8]`);
  }
  const ids = new Set(districts.map((d) => d.id));
  const orphans = buildings.filter((b) => !ids.has(b.districtId)).length;
  if (orphans > 0) failures.push(`${orphans} buildings with unknown districtId`);

  // 4. In-bounds (+10% slack).
  const slack = CITY_HALF_EXTENT * 1.1;
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

  console.log("Gate 1 — streets-first generator asserts\n");
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

  // Determinism.
  const d1 = JSON.stringify(generateCity("gate1-det"));
  const d2 = JSON.stringify(generateCity("gate1-det"));
  const detOk = d1 === d2;
  console.log(`\ndeterminism: ${detOk ? "PASS" : "FAIL"}`);
  if (!detOk) failed++;

  console.log(`\n${failed === 0 ? "GATE 1 PASS" : `GATE 1 FAIL (${failed} seed(s))`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
