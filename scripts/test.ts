/**
 * Deterministic gate runner — runs the headless, no-server/no-browser gate
 * scripts in sequence as child processes and exits non-zero on the first
 * failure. Each script is timed; a one-line PASS/FAIL prints per script plus
 * a summary at the end.
 *
 *   bun run test
 *   bun run scripts/test.ts
 *
 * Excluded (need a dev server and/or a browser, so they don't belong in a
 * fast/offline gate):
 *   - scripts/verifyProjectionSizeInvariance.ts — requires the dev server on
 *     :7827 and drives it via cdpShot's raw-CDP transport (per its own header).
 *   - All other verify-, cdp-, and capture-prefixed scripts in scripts/ for
 *     the same reason (not in this list to begin with; noted for completeness).
 */
import { spawnSync } from "node:child_process";

const SCRIPTS = [
  "scripts/gate1.ts",
  "scripts/personaCheck.ts",
  "scripts/cityGolden.ts",
  "scripts/districtOutlineCheck.ts",
  "scripts/roadQueryCheck.ts",
  "scripts/principalCheck.ts",
  "scripts/heliSplineCheck.ts",
  "scripts/tierSanity.ts",
  "scripts/tileCullSanity.ts",
];

type Result = { script: string; ok: boolean; ms: number };

const results: Result[] = [];
let failedScript: string | null = null;

for (const script of SCRIPTS) {
  // CITY_GOLDEN=skip: scripts/cityGolden.ts encodes a byte-identity contract
  // that Math.sin/cos/atan2/hypot don't guarantee across JS engines/platforms
  // (see wiki/notes/decision-cross-runtime-determinism.md) — a CI-only escape
  // hatch so this one known-noisy script doesn't block the gate. Runs locally
  // by default (the env var is unset unless CI sets it).
  if (script === "scripts/cityGolden.ts" && process.env.CITY_GOLDEN === "skip") {
    console.log(
      "SKIP scripts/cityGolden.ts (cross-runtime drift, see wiki/notes/decision-cross-runtime-determinism.md)",
    );
    results.push({ script, ok: true, ms: 0 });
    continue;
  }
  const t0 = Date.now();
  const proc = spawnSync("bun", ["run", script], { stdio: "inherit" });
  const ms = Date.now() - t0;
  const ok = proc.status === 0;
  results.push({ script, ok, ms });
  console.log(`${ok ? "PASS" : "FAIL"}  ${script}  (${ms}ms)`);
  if (!ok) {
    failedScript = script;
    break;
  }
}

console.log("\n--- summary ---");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.script.padEnd(40)} ${r.ms}ms`);
}

if (failedScript) {
  console.log(`\nFAIL — ${failedScript} failed, stopping.`);
  process.exit(1);
}

console.log(`\nPASS — ${results.length}/${SCRIPTS.length} scripts.`);
process.exit(0);
