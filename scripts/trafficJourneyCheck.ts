/**
 * Traffic journey check — #57 v3 (minor-tier multi-road journeys).
 *
 *   bun run scripts/trafficJourneyCheck.ts            # default 3 seeds
 *   bun run scripts/trafficJourneyCheck.ts a b c ...   # specific seeds
 *
 * Per seed:
 *   1. Determinism — buildTraffic runs twice; every attribute Float32Array
 *      (aA, aB, aPhase, aSpeed, aColor, aTail, aHead, aReveal, aSize,
 *      aWinStart, aWinEnd, aRoadEnd) must be byte-identical between runs.
 *   2. Journey stats — number of minor-tier journeys, mean roads per journey,
 *      mean journey length (m), and how many journeys are length-1 (the
 *      starting road was a dead end in the road graph).
 *
 * Exits non-zero if any seed's two runs diverge.
 */
import { buildTraffic, type TrafficData } from "@/lib/seed/traffic";

const seeds = process.argv.slice(2);
if (seeds.length === 0) seeds.push("traffic-check-a", "traffic-check-b", "traffic-check-c");

function buffersIdentical(a: TrafficData, b: TrafficData): string[] {
  const mismatches: string[] = [];
  if (a.count !== b.count) mismatches.push(`count ${a.count} !== ${b.count}`);
  const arrayFields = [
    "aA",
    "aB",
    "aPhase",
    "aSpeed",
    "aColor",
    "aTail",
    "aHead",
    "aReveal",
    "aSize",
    "aWinStart",
    "aWinEnd",
    "aRoadEnd",
  ] as const;
  for (const f of arrayFields) {
    const av = a[f];
    const bv = b[f];
    if (av.length !== bv.length) {
      mismatches.push(`${f}.length ${av.length} !== ${bv.length}`);
      continue;
    }
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) {
        mismatches.push(`${f}[${i}] ${av[i]} !== ${bv[i]}`);
        break; // one mismatch per field is enough to fail the seed
      }
    }
  }
  if (a.maxRadius !== b.maxRadius) mismatches.push(`maxRadius ${a.maxRadius} !== ${b.maxRadius}`);
  return mismatches;
}

console.log("Traffic journey check — #57 v3 minor-tier multi-road journeys\n");
console.log("seed                 journeys  meanRoads  meanLenM  deadEnds(len=1)  result");

let allPass = true;
for (const seed of seeds) {
  const runA = buildTraffic(seed);
  const runB = buildTraffic(seed);
  const mismatches = buffersIdentical(runA, runB);
  const pass = mismatches.length === 0;
  if (!pass) allPass = false;

  const js = runA.journeyStats;
  const journeys = js.length;
  const meanRoads = journeys ? js.reduce((s, j) => s + j.roads, 0) / journeys : 0;
  const meanLenM = journeys ? js.reduce((s, j) => s + j.lenM, 0) / journeys : 0;
  const deadEnds = js.filter((j) => j.roads === 1).length;

  console.log(
    `${seed.padEnd(20)} ${String(journeys).padStart(8)}  ${meanRoads.toFixed(2).padStart(9)}  ${meanLenM
      .toFixed(1)
      .padStart(8)}  ${String(deadEnds).padStart(15)}  ${pass ? "PASS" : "FAIL"}`,
  );
  if (!pass) {
    for (const m of mismatches.slice(0, 5)) console.log(`    ${m}`);
    if (mismatches.length > 5) console.log(`    ...and ${mismatches.length - 5} more`);
  }
}

console.log("");
console.log(allPass ? "TRAFFIC JOURNEY CHECK PASS" : "TRAFFIC JOURNEY CHECK FAIL");
if (!allPass) process.exit(1);
