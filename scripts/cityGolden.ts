/**
 * City golden-snapshot regression for the #14 scale migration
 * (generate-at-max + crop — wiki/notes/decision-additive-growth-citygen.md).
 *
 *   bun run scripts/cityGolden.ts capture          # write the baseline (run BEFORE the refactor)
 *   bun run scripts/cityGolden.ts                  # check current gen against the baseline (structural contract)
 *   bun run scripts/cityGolden.ts --full           # also print (not fail on) the old exact-byte hashes
 *
 * THE CONTRACT (narrowed 2026-09-05, see wiki/notes/decision-cross-runtime-determinism.md
 * "Contract (2026-09-05)"): after merging spike/deterministic-math, lib/seed/dmath.ts
 * makes topology.ts/lattice.ts/tensorField.ts/tensorStreets.ts bit-identical across
 * V8 and JavaScriptCore, but ~99 more native Math.sin/cos/atan2/exp/hypot call sites
 * remain across 14 more lib/seed files (tracked as a 2.0 gate, not this one). So the
 * generated city is no longer byte-identical cross-engine, but it IS identical on the
 * STRUCTURAL properties this file checks by default: buildingCount, districtCount,
 * roadCount, highwayCount, orientHash, and the sorted per-district building-count
 * distribution — confirmed by a `bun` vs `bunx tsx` sweep of all 10 gate1 seeds
 * (scratch/quantParityProbe.ts). A quantized geometry hash (buildings' position +
 * footprint + rotation, road polyline vertices, district centroids, all rounded to
 * the nearest 1 cm) is ALSO cross-engine-identical for all 10 seeds at that probe's
 * finest tested quantum (1 m / 0.1 m / 0.01 m all passed; 0.01 m is what we keep) —
 * so it's included in the default contract as `geomHash`.
 *
 * streetlightCount is deliberately NOT part of the contract: it disagreed for
 * gate1-3 (23665 vs 23667) even though every other structural field matched. The
 * streetlight de-bunch pass (cityGen.ts's STREETLIGHT_MIN_DIST) drops a lamp within
 * 11.5 m of an already-kept one — a hard threshold on a continuous distance, the
 * same failure shape as the original lattice tie-break. A near-tied pair of lamps
 * can sit a ULP on either side of that cutoff depending on which engine's transcen-
 * dentals placed them, flipping the count by a couple of lamps. That's not a
 * quantization problem (the LAMP POSITIONS may still round to the same cell; it's
 * the keep/drop DECISION that flips), so no grid quantum fixes it — same as the
 * original dominantHighwayTilt bug, just in a file the spike didn't touch. Fixing
 * it for real needs STREETLIGHT_MIN_DIST's comparison to gain the spike's tolerance-
 * band treatment, which is in scope for the full 2.0 sweep, not this narrowing.
 *
 * Within a single engine, exact byte-identity is still real and still guarded —
 * that's what scripts/gate1.ts's own same-run determinism check (generate twice,
 * compare) covers, and what `--full` reports here for local curiosity. This file's
 * default (no flag) check is the CROSS-engine contract; `--full` is informational
 * only and never fails the gate.
 *
 * Sample region is FROZEN at the original City extent (±1500 about CITY_CENTER), never
 * CITY_HALF_EXTENT, so capture and check always compare the same world region even after
 * CITY_HALF_EXTENT is repurposed as the crop.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { generateCity } from "@/lib/seed/cityGen";
import { computeLattice } from "@/lib/seed/lattice";
import { CITY_CENTER, setCityTier } from "@/lib/seed/topology";

// Pin the 6 km notch (#58, the old "metro"): the golden baseline + cross-crop
// contract are tier-stable.
setCityTier(6);

const GOLDEN_PATH = "scripts/__golden__/city.json";
const SEEDS = Array.from({ length: 10 }, (_, i) => `gate1-${i}`);
const SAMPLE_HALF = 1500; // frozen: the original City extent, in world metres
const SAMPLE_STEP = 150;
const GEOM_QUANTUM = 0.01; // metres — see header: finest quantum a 10-seed bun-vs-tsx sweep held at

// FNV-1a 32-bit over a string — deterministic, dependency-free, collision-safe enough
// for a byte-identity tripwire.
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function q(v: number, quantum: number): number {
  return Math.round(v / quantum);
}

type Fingerprint = {
  seed: string;
  // --- structural contract: checked by default, cross-engine stable ---
  buildingCount: number;
  districtCount: number;
  roadCount: number; // arterials + minor streets
  highwayCount: number;
  orientHash: string;
  perDistrictBuildingCounts: number[]; // sorted ascending, so district ORDER isn't part of the contract
  geomHash: string; // quantized (GEOM_QUANTUM) building pos/footprint/rotation + road vertices + district centroids
  // --- full-byte record: printed under --full, never fails ---
  fullHash: string;
  buildingsHash: string;
  roadsHash: string;
  districts: Array<{ id: string; character: string; cx: number; cz: number; area: number }>;
};

function fingerprint(seed: string): Fingerprint {
  const city = generateCity(seed);
  const buildings = JSON.stringify(city.buildings);
  const roads = JSON.stringify([city.topology.highways, city.arterials, city.streets]);

  // Lattice orientation over a fixed world grid — directly guards the orientationAt
  // ramp (critic #9), the most likely byte-identity failure under the MAX split.
  const L = computeLattice(seed);
  let grid = "";
  for (let x = -SAMPLE_HALF; x <= SAMPLE_HALF; x += SAMPLE_STEP) {
    for (let z = -SAMPLE_HALF; z <= SAMPLE_HALF; z += SAMPLE_STEP) {
      grid += L.orientationAt(CITY_CENTER.x + x, CITY_CENTER.z + z).toFixed(6) + ";";
    }
  }

  const perDistrict = new Map<string, number>();
  for (const b of city.buildings) {
    perDistrict.set(b.districtId, (perDistrict.get(b.districtId) ?? 0) + 1);
  }

  const bParts = city.buildings.map(
    (b) =>
      `${q(b.x, GEOM_QUANTUM)},${q(b.z, GEOM_QUANTUM)},${q(b.width, GEOM_QUANTUM)},${q(b.depth, GEOM_QUANTUM)},${q(b.rotationY, GEOM_QUANTUM)}`,
  );
  const rParts = [...city.topology.highways, ...city.arterials, ...city.streets].map((r) =>
    r.vertices.map((v) => `${q(v.x, GEOM_QUANTUM)},${q(v.z, GEOM_QUANTUM)}`).join("|"),
  );
  const dParts = city.districts.map(
    (d) => `${q(d.centroidX, GEOM_QUANTUM)},${q(d.centroidZ, GEOM_QUANTUM)}`,
  );

  return {
    seed,
    buildingCount: city.buildings.length,
    districtCount: city.districts.length,
    roadCount: city.arterials.length + city.streets.length,
    highwayCount: city.topology.highways.length,
    orientHash: hash(grid),
    perDistrictBuildingCounts: [...perDistrict.values()].sort((a, b) => a - b),
    geomHash: hash(`${bParts.join(";")}|${rParts.join(";")}|${dParts.join(";")}`),
    fullHash: hash(JSON.stringify(city)),
    buildingsHash: hash(buildings),
    roadsHash: hash(roads),
    districts: city.districts.map((d) => ({
      id: d.id,
      character: d.character,
      cx: Math.round(d.centroidX * 100),
      cz: Math.round(d.centroidZ * 100),
      area: Math.round(d.area),
    })),
  };
}

function capture() {
  const fps = SEEDS.map(fingerprint);
  mkdirSync("scripts/__golden__", { recursive: true });
  writeFileSync(GOLDEN_PATH, JSON.stringify(fps, null, 2) + "\n");
  console.log(`captured ${fps.length} golden fingerprints → ${GOLDEN_PATH}`);
  for (const f of fps) {
    console.log(
      `  ${f.seed.padEnd(10)} ${String(f.buildingCount).padStart(5)} bldg  ${String(f.districtCount).padStart(2)} dist  geom=${f.geomHash}`,
    );
  }
}

// The cross-engine contract: structural fields only. Order matters for the
// diff message but not for correctness — every field here was confirmed
// bun==tsx across all 10 gate1 seeds (scratch/quantParityProbe.ts).
const STRUCTURAL_KEYS = [
  "buildingCount",
  "districtCount",
  "roadCount",
  "highwayCount",
  "orientHash",
  "geomHash",
] as const;

function arrEq(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function check() {
  const full = process.argv.includes("--full");
  if (!existsSync(GOLDEN_PATH)) {
    console.error(`no golden at ${GOLDEN_PATH} — run: bun run scripts/cityGolden.ts capture`);
    process.exit(2);
  }
  const golden: Fingerprint[] = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
  let failed = 0;
  console.log("city golden check — current gen vs baseline (structural, cross-engine contract)\n");
  console.log("seed        result");
  for (const g of golden) {
    const cur = fingerprint(g.seed);
    const diffs: string[] = [];
    for (const k of STRUCTURAL_KEYS) if (cur[k] !== g[k]) diffs.push(`${k} ${g[k]}→${cur[k]}`);
    if (!arrEq(cur.perDistrictBuildingCounts, g.perDistrictBuildingCounts)) {
      diffs.push(
        `perDistrictBuildingCounts [${g.perDistrictBuildingCounts}]→[${cur.perDistrictBuildingCounts}]`,
      );
    }
    const ok = diffs.length === 0;
    if (!ok) failed++;
    console.log(`${g.seed.padEnd(10)}  ${ok ? "PASS" : "FAIL — " + diffs.join("; ")}`);

    if (full) {
      const fullDiffs: string[] = [];
      for (const k of ["fullHash", "buildingsHash", "roadsHash"] as const) {
        if (cur[k] !== g[k]) fullDiffs.push(`${k} ${g[k]}→${cur[k]}`);
      }
      console.log(
        `${" ".repeat(12)}--full (informational, not gated): ${fullDiffs.length === 0 ? "byte-identical" : fullDiffs.join("; ")}`,
      );
    }
  }
  console.log(`\n${failed === 0 ? "GOLDEN PASS" : `GOLDEN FAIL (${failed} seed(s))`}`);
  if (full) {
    console.log(
      "(--full is informational only and never fails the gate — see this file's header " +
        "and wiki/notes/decision-cross-runtime-determinism.md for why exact bytes aren't " +
        "part of the cross-engine contract yet.)",
    );
  }
  process.exit(failed === 0 ? 0 : 1);
}

// Cross-crop invariance — THE additive-growth contract (generate-at-max + crop):
// a smaller circle crop must be a byte-identical SUBSET of a larger one (grow reveals,
// never re-rolls). Validates that pinning gen to MAX (Step 2) makes the crop a pure
// post-filter — i.e. the per-cell rng rewrite (Step 3) is unnecessary for v1.
// Same-engine, same-run comparison only, so it isn't affected by the cross-engine
// transcendental drift this file's other modes work around.
function crosscrop() {
  const seeds = SEEDS.slice(0, 5);
  const scales = [0.25, 0.5, 1.0]; // circle R = tier extent · scale → 750 / 1500 / 3000(full)
  let failed = 0;
  console.log("cross-crop invariance — nested circle crops, byte-identical on overlap\n");
  for (const seed of seeds) {
    const byScale = scales.map((s) => {
      const c = generateCity(seed, "circle", s);
      const map = new Map<number, string>();
      for (const b of c.buildings) map.set(b.id, JSON.stringify(b));
      return { s, count: c.buildings.length, map };
    });
    for (let i = 0; i < byScale.length - 1; i++) {
      const small = byScale[i];
      const large = byScale[i + 1];
      let missing = 0;
      let mismatch = 0;
      for (const [id, bj] of small.map) {
        const lj = large.map.get(id);
        if (lj === undefined) missing++;
        else if (lj !== bj) mismatch++;
      }
      const ok = missing === 0 && mismatch === 0 && small.count <= large.count;
      if (!ok) failed++;
      console.log(
        `  ${seed.padEnd(10)} ${small.s}⊂${large.s}: ${ok ? "PASS" : "FAIL"} (${small.count}⊂${large.count}${
          ok ? "" : `, missing=${missing} mismatch=${mismatch}`
        })`,
      );
    }
  }
  console.log(`\n${failed === 0 ? "CROSSCROP PASS" : `CROSSCROP FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

const mode = process.argv[2] ?? "check";
if (mode === "capture") capture();
else if (mode === "crosscrop") crosscrop();
else check();
