// Verify the aligned interaction model: spacebar gated on screen-hover,
// dice cursor on the Apple badge, badge press+move = drag (no reroll).
// Usage: bunx tsx scripts/verifyInteractions.ts

import { chromium } from "playwright";

async function main() {
  const url = process.env.CAPTURE_URL ?? "http://localhost:7828";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.goto(`${url}/intro`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(3_000);

  const cursor = () => page.evaluate(() => document.body.style.cursor);

  // --- UI chip cursors (element-level, not body): expect pointer ---
  for (const t of ["viewport-mode-screen", "viewport-mode-snowglobe", "intro-settings-gear"]) {
    const c = await page.$eval(`[data-testid="${t}"]`, (el) => getComputedStyle(el).cursor);
    console.log(`${t} cursor (expect pointer):`, c);
  }

  // --- cursor zones ---
  await page.mouse.move(800, 380); // over screen
  await page.waitForTimeout(200);
  const cScreen = await cursor();
  console.log("screen cursor (expect pointer):", cScreen.startsWith("url(") ? "custom" : cScreen);

  await page.mouse.move(648, 604); // over apple badge
  await page.waitForTimeout(200);
  const cBadge = await cursor();
  console.log(
    "badge cursor (expect dice svg):",
    cBadge.startsWith("url(") ? `custom svg (fallback ${cBadge.split(", ").pop()})` : cBadge,
  );

  await page.mouse.move(200, 800); // empty stage
  await page.waitForTimeout(200);
  console.log("stage cursor (expect grab):", await cursor());

  // --- spacebar gate: NOT hovering screen → no effect ---
  await page.mouse.move(200, 820);
  await page.waitForTimeout(200);
  await page.screenshot({ path: "samples/intro/intxn-prespace-offscreen.png" });
  await page.keyboard.press("Space");
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: "samples/intro/intxn-postspace-offscreen.png" });
  console.log("pressed Space while OFF screen (orbit should NOT start)");

  // --- spacebar gate: hovering screen → toggles orbit ---
  await page.mouse.move(800, 380);
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "samples/intro/intxn-space-on-t0.png" });
  await page.mouse.move(200, 820); // leave screen — record should keep spinning
  await page.waitForTimeout(7_000);
  await page.screenshot({ path: "samples/intro/intxn-space-on-t7.png" });
  console.log("pressed Space while ON screen then left (orbit should persist)");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
