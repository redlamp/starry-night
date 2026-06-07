// Capture /intro for visual verification.
// Usage: bunx tsx scripts/captureIntro.ts
// Env: CAPTURE_URL (default http://localhost:7828), CAPTURE_OUT (default samples/intro)

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

async function main() {
  const url = process.env.CAPTURE_URL ?? "http://localhost:7828";
  const outDir = resolve(process.env.CAPTURE_OUT ?? "samples/intro");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning" || msg.text().startsWith("[intro]"))
      console.log(`[console.${msg.type()}]`, msg.text().slice(0, 2000));
  });
  page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 2000)));
  await page.goto(`${url}/intro`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  const settleMs = Number(process.env.CAPTURE_SETTLE ?? 2_000);
  await page.waitForTimeout(settleMs); // settle: first frames + damping + city gen

  const out = resolve(outDir, "intro.png");
  await page.screenshot({ path: out });
  console.log("captured", out);

  // colour-depth chips are hidden for now (locked to B/W); when restored,
  // re-add the mac256/full capture loop here.

  // hover the CRT and drag: city should pan, Mac must not move
  await page.mouse.move(800, 460);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(650, 460, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const outPan = resolve(outDir, "intro-screen-pan.png");
  await page.screenshot({ path: outPan });
  console.log("captured", outPan);

  // off-hover: adjusted pose must STICK (new snow-globe foundation)
  await page.mouse.move(200, 800);
  await page.waitForTimeout(1_800);
  const outStick = resolve(outDir, "intro-screen-stick.png");
  await page.screenshot({ path: outStick });
  console.log("captured", outStick);

  // double-click the screen: city glides back to its default orbit
  await page.mouse.dblclick(800, 420);
  await page.mouse.move(200, 800);
  await page.waitForTimeout(1_800);
  const outScreenReset = resolve(outDir, "intro-screen-reset.png");
  await page.screenshot({ path: outScreenReset });
  console.log("captured", outScreenReset);

  // snow-globe mode: switch, drag-orbit on the stage (not the screen)
  await page.click('[data-testid="viewport-mode-snowglobe"]');
  await page.mouse.move(400, 700);
  await page.mouse.down();
  await page.mouse.move(650, 670, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1_200); // damping settle
  const outGlobe = resolve(outDir, "intro-snowglobe.png");
  await page.screenshot({ path: outGlobe });
  console.log("captured", outGlobe);

  // double-click the stage: GSAP orbit tween back to the start pose
  await page.mouse.dblclick(300, 750);
  await page.waitForTimeout(2_200); // 1.4s tween + settle
  const outReset = resolve(outDir, "intro-reset.png");
  await page.screenshot({ path: outReset });
  console.log("captured", outReset);

  // double-click the stock Mac (stage right): orbit rig pans over to it
  await page.mouse.dblclick(1300, 380);
  await page.waitForTimeout(1_800);
  const outSelect = resolve(outDir, "intro-select-stock.png");
  await page.screenshot({ path: outSelect });
  console.log("captured", outSelect);

  // settings panel via the gear
  await page.click('[data-testid="intro-settings-gear"]');
  await page.waitForTimeout(500);
  const outSettings = resolve(outDir, "intro-settings.png");
  await page.screenshot({ path: outSettings });
  console.log("captured", outSettings);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
