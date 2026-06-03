/**
 * City golden-snapshot regression for the #14 scale migration
 * (generate-at-max + crop — wiki/notes/decision-additive-growth-citygen.md).
 *
 *   bun run scripts/cityGolden.ts capture   # write the baseline (run BEFORE the refactor)
 *   bun run scripts/cityGolden.ts           # check current gen against the baseline
 *
 * The contract: after the MAX split, generateCity at the City-equivalent crop must
 * reproduce this baseline BYTE-FOR-BYTE. We store compact per-seed fingerprints —
 * a whole-city hash plus localizing sub-hashes (buildings incl. id/windowSeed, roads,
 * districts) and the lattice orientation grid (critic #9 predicts this is the site that
 * diverges when `half` moves 1500→3000) — so a regression tells us WHICH subsystem
 * drifted, not merely that something did.
 *
 * Sample region is FROZEN at the original City extent (±1500 about CITY_CENTER), never
 * CITY_HALF_EXTENT, so capture and check always compare the same world region even after
 * CITY_HALF_EXTENT is repurposed as the crop.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { generateCity } from "@/lib/seed/cityGen";
import { computeLattice } from "@/lib/seed/lattice";
import { CITY_CENTER } from "@/lib/seed/topology";

const GOLDEN_PATH = "scripts/__golden__/city.json";
const SEEDS = Array.from({ length: 10 }, (_, i) => `gate1-${i}`);
const SAMPLE_HALF = 1500; // frozen: the original City extent, in world metres
const SAMPLE_STEP = 150;

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

type Fingerprint = {
  seed: string;
  buildingCount: number;
  districtCount: number;
  fullHash: string;
  buildingsHash: string;
  roadsHash: string;
  orientHash: string;
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

  return {
    seed,
    buildingCount: city.buildings.length,
    districtCount: city.districts.length,
    fullHash: hash(JSON.stringify(city)),
    buildingsHash: hash(buildings),
    roadsHash: hash(roads),
    orientHash: hash(grid),
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
    console.log(`  ${f.seed.padEnd(10)} ${String(f.buildingCount).padStart(5)} bldg  full=${f.fullHash}`);
  }
}

const SUBHASHES = ["fullHash", "buildingsHash", "roadsHash", "orientHash"] as const;

function check() {
  if (!existsSync(GOLDEN_PATH)) {
    console.error(`no golden at ${GOLDEN_PATH} — run: bun run scripts/cityGolden.ts capture`);
    process.exit(2);
  }
  const golden: Fingerprint[] = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
  let failed = 0;
  console.log("city golden check — current gen vs baseline\n");
  console.log("seed        result");
  for (const g of golden) {
    const cur = fingerprint(g.seed);
    const diffs: string[] = [];
    for (const k of SUBHASHES) if (cur[k] !== g[k]) diffs.push(`${k} ${g[k]}→${cur[k]}`);
    if (cur.buildingCount !== g.buildingCount)
      diffs.push(`buildingCount ${g.buildingCount}→${cur.buildingCount}`);
    if (cur.districtCount !== g.districtCount)
      diffs.push(`districtCount ${g.districtCount}→${cur.districtCount}`);
    const ok = diffs.length === 0;
    if (!ok) failed++;
    console.log(`${g.seed.padEnd(10)}  ${ok ? "PASS" : "FAIL — " + diffs.join("; ")}`);
  }
  console.log(`\n${failed === 0 ? "GOLDEN PASS" : `GOLDEN FAIL (${failed} seed(s))`}`);
  process.exit(failed === 0 ? 0 : 1);
}

// Cross-crop invariance — THE additive-growth contract (generate-at-max + crop):
// a smaller circle crop must be a byte-identical SUBSET of a larger one (grow reveals,
// never re-rolls). Validates that pinning gen to MAX (Step 2) makes the crop a pure
// post-filter — i.e. the per-cell rng rewrite (Step 3) is unnecessary for v1.
function crosscrop() {
  const seeds = SEEDS.slice(0, 5);
  const scales = [0.5, 1.0, 2.0]; // circle R = half*scale (currently 750 / 1500 / 3000)
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
