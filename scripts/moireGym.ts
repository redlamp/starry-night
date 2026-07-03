/**
 * moire-gym — deterministic scenario runner for the window-aliasing families (#82).
 *
 *   bun scripts/moireGym.ts                 # run every scenario
 *   bun scripts/moireGym.ts street-graze    # run one (or several, space-separated)
 *
 * Each scenario is a named camera pose (+ optional setting overrides) applied by
 * injecting a full saved-config into localStorage and reloading — the same
 * mechanism Copy/Save Settings uses, so a gym pose is exactly reproducible in a
 * live browser by pasting the printed config. Captures go through cdpShot
 * (real-GPU headless, lossless PNG) and are scored with moireMetric's
 * median-deviation speckle rate. Higher = more churn/stripes; solid glass ≈ low.
 *
 * The poses target the three artifact signatures diagnosed from screen
 * recordings on 2026-07-02 (see wiki/notes/window-lod-moire-diagnosis.md):
 *   telephoto    — far narrow-FOV downtown; windows 1-3px in BOTH axes
 *   street-graze — eye-level view down a corridor; flanking facades sub-pixel
 *                  in X only (vertical stripe combs)
 *   band-close   — elevated mid-range; band/curtain floors at 2-5px panes
 *   frontal-far  — default-ish skyline; regression guard (should stay LOW and
 *                  keep detail — a fix that washes this pose flat is a fail)
 *
 * Requires the dev server on :7827. Output: samples/gym/<scenario>.png + a
 * score table on stdout. GYM_PREFIX env prefixes filenames (e.g. "base-").
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GYM_POSES, GYM_SEED, type GymPose } from "../lib/scene/gymPoses";

const OUT_DIR = "samples/gym";
const PREFIX = process.env.GYM_PREFIX ?? "";

// Poses live in lib/scene/gymPoses.ts — shared with the app's ?gym=<name> URL
// parameter, so every scenario here is also a live link:
//   http://localhost:7827/?gym=<name>&seed=starry-night
const SCENARIOS: Record<string, GymPose> = { ...GYM_POSES };

function runScenario(name: string, sc: GymPose): string {
  // ?capture=1 boots into "still" mode, which applies cameraIntent reactively —
  // so the pose is driven POST-boot through __sceneStore (capture boot runs
  // resetCamera, so a localStorage savedConfig would be wiped before it took).
  const intent = { position: sc.position, lookAt: sc.lookAt, fov: sc.fov, orient: "lookAt" };
  const setup = [
    `const st = window.__sceneStore.getState();`,
    `st.setWindowAA({ lodNear: 0.4, lodRange: 0.4 });`,
    // Stars off entirely: static star points read as speckle to the metric and
    // pollute any scenario that frames sky. Windows are the subject here.
    `st.setStars({ count: 0, twinkle: 0, meteorsEnabled: false });`,
    `if (st.setTraffic) st.setTraffic({ enabled: false });`,
    `st.setCameraIntent(${JSON.stringify(intent)});`,
  ].join("\n");
  const setupPath = join(OUT_DIR, `_setup-${name}.js`);
  writeFileSync(setupPath, setup);
  const png = join(OUT_DIR, `${PREFIX}${name}.png`);
  const url = `http://localhost:7827/?capture=1&intro=instant&seed=${GYM_SEED}`;
  const r = spawnSync("bun", ["scripts/cdpShot.ts", url, png], {
    env: {
      ...process.env,
      SHOT_SETUP_FILE: setupPath,
      SHOT_SETUP_WAIT: process.env.SHOT_SETUP_WAIT ?? "2500",
      SHOT_W: process.env.SHOT_W ?? "1920",
      SHOT_H: process.env.SHOT_H ?? "1080",
    },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`cdpShot failed for ${name}:\n${r.stdout}\n${r.stderr}`);
  return png;
}

function score(png: string): string {
  const r = spawnSync("bun", ["scripts/moireMetric.ts", png], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`moireMetric failed for ${png}: ${r.stderr}`);
  return r.stdout.trim();
}

// Ad-hoc pose probing without editing the file:
//   GYM_INTENT='{"position":[x,y,z],"lookAt":[x,y,z],"fov":55}' bun scripts/moireGym.ts probe
if (process.env.GYM_INTENT) {
  const p = JSON.parse(process.env.GYM_INTENT) as Omit<GymPose, "expects">;
  SCENARIOS.probe = { ...p, expects: "ad-hoc probe" };
}

mkdirSync(OUT_DIR, { recursive: true });
const picked = process.argv.slice(2);
const names = picked.length ? picked : Object.keys(SCENARIOS);
for (const name of names) {
  const sc = SCENARIOS[name];
  if (!sc) {
    console.error(`unknown scenario "${name}" — have: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n=== ${name} — expects: ${sc.expects}`);
  console.log(`    view live: http://localhost:7827/?gym=${name}&seed=${GYM_SEED}`);
  const png = runScenario(name, sc);
  console.log(score(png));
}
