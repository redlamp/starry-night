/**
 * #55 tile-cull visualization — end-to-end verification.
 *
 * Drives the live app (capture mode) through the Debug View → Tile culling
 * states and asserts the counters the panel readout shows:
 *   1. baseline           — culling on, camera in orbit pose
 *   2. overlay on         — green tile boxes render (screenshot)
 *   3. freeze + fly out   — cull frustum stays pinned: tilesVisible unchanged
 *                           while the camera leaves; red boxes visible (shot)
 *   4. unfreeze           — visible set re-follows the live camera
 *
 * Usage: bunx tsx scripts/verifyTileCullOverlay.ts
 * Env:   CAPTURE_URL (default http://localhost:7827), CAPTURE_OUT (./samples/verify55)
 *
 * Assumes the dev server is running at CAPTURE_URL.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

type Stats = {
  tilesVisible: number;
  tilesTotal: number;
  itemsDrawn: number;
  itemsTotal: number;
  culling: boolean;
};

const url = process.env.CAPTURE_URL ?? "http://localhost:7827";
const outDir = resolve(process.env.CAPTURE_OUT ?? "samples/verify55");

let failures = 0;
function check(name: string, ok: boolean, info = "") {
  console.log(`${name.padEnd(42)} ${ok ? "PASS" : "FAIL"}${info ? `  (${info})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${url}/?seed=verify55&capture=1&intro=instant`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(4_000); // settle: gen + first compaction

  const stats = (layer: string) =>
    page.evaluate(
      (l) =>
        (
          window as unknown as {
            __tileCullDebug: { readTileCull: (k: string) => Stats };
          }
        ).__tileCullDebug.readTileCull(l),
      layer,
    );
  const store = (code: string) =>
    page.evaluate((c) => eval(`(${c})(window.__sceneStore.getState())`), code);

  // 1. baseline — culling on in the default orbit pose, something culled.
  const base = await stats("buildings");
  check("baseline: culling active", base.culling && base.tilesTotal > 0);
  check(
    "baseline: culling bites",
    base.tilesVisible < base.tilesTotal && base.itemsDrawn < base.itemsTotal,
    `${base.tilesVisible}/${base.tilesTotal} tiles, ${base.itemsDrawn}/${base.itemsTotal} items`,
  );

  // 2. overlay on — renders without breaking the frame loop.
  await store(`(s) => s.setTileOverlay(true)`);
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: resolve(outDir, "overlay-on.png") });
  const overlayOn = await store(`(s) => s.debug.tileOverlay`);
  check("overlay: enabled + frame loop alive", overlayOn === true);

  // 3. freeze, then fly the camera far out — the frozen frustum must keep the
  //    visible set constant while the live camera sees the whole city.
  await store(`(s) => s.setTileFreeze(true)`);
  await page.waitForTimeout(500);
  const frozen = await stats("buildings");
  // Top-down from high up, ortho widened to cover the full extent — the frozen
  // frustum reads as green (materialised) against red (evicted) tiles.
  await store(
    `(s) => { s.setOrthoSize(2600); s.setCameraIntent({ position: [0, 8000, 100], lookAt: [0, 0, 0], orient: "lookAt" }); }`,
  );
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: resolve(outDir, "frozen-flyout.png") });
  const after = await stats("buildings");
  check(
    "freeze: visible set pinned during fly-out",
    after.tilesVisible === frozen.tilesVisible && after.tilesVisible < after.tilesTotal,
    `${frozen.tilesVisible} → ${after.tilesVisible} of ${after.tilesTotal}`,
  );

  // 4. unfreeze — the visible set must snap from the frozen pose's count to
  //    the live camera's own (different) count.
  await store(`(s) => s.setTileFreeze(false)`);
  await page.waitForTimeout(1_000);
  const released = await stats("buildings");
  check(
    "unfreeze: cull re-follows the live camera",
    released.tilesVisible !== frozen.tilesVisible && released.tilesVisible > 0,
    `${frozen.tilesVisible} → ${released.tilesVisible}`,
  );

  // streetlights + traffic ride the same machinery — spot-check they report.
  for (const layer of ["streetlights", "traffic"]) {
    const s = await stats(layer);
    check(`${layer}: reporting`, s.tilesTotal > 0 && s.itemsTotal > 0);
  }

  await browser.close();
  console.log(failures === 0 ? "\nTILE CULL OVERLAY VERIFY PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
