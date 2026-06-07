// Verify (a) spacebar auto-orbit revolves the city, (b) the knob hotspot is
// occlusion-gated when the case lip covers it.
// Usage: bunx tsx scripts/verifyOrbitOcclusion.ts

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

async function main() {
  const url = process.env.CAPTURE_URL ?? "http://localhost:7828";
  const outDir = resolve(process.env.CAPTURE_OUT ?? "samples/intro");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  await page.goto(`${url}/intro`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(2_500);

  const shot = async (n: string) => {
    await page.screenshot({ path: resolve(outDir, `${n}.png`) });
    console.log("captured", n);
  };

  // --- spacebar auto-orbit: city should rotate between these two shots ---
  await page.mouse.move(800, 450);
  await page.keyboard.press("Space"); // enable turntable
  await page.waitForTimeout(500);
  await shot("orbit-t0");
  await page.waitForTimeout(6_000); // ~24deg at 90s/rev
  await shot("orbit-t6");
  await page.keyboard.press("Space"); // disable
  await page.waitForTimeout(500);

  // --- knob occlusion: at the head-on home pose the wheel sliver is visible
  // (scrub cursor); orbit upward so the front lip covers the knob, the same
  // screen point should now read grab/auto, not scrub ---
  await page.mouse.move(640, 650);
  await page.waitForTimeout(300);
  const headOn = await page.evaluate(() => document.body.style.cursor);
  console.log(
    "knob @ home (expect scrub):",
    headOn.startsWith("url(") ? "scrub" : headOn || "auto",
  );

  // orbit camera DOWN-to-UP so we look down the front face and the overhang
  // hides the recessed knob (drag up = pitch the eye higher)
  await page.mouse.move(800, 600);
  await page.mouse.down();
  await page.mouse.move(800, 300, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1_000);
  // sample a vertical band where the knob projects now
  let foundScrub = false;
  for (let y = 560; y <= 760; y += 8) {
    await page.mouse.move(700, y);
    await page.waitForTimeout(60);
    const c = await page.evaluate(() => document.body.style.cursor);
    if (c.startsWith("url(")) foundScrub = true;
  }
  console.log("scrub cursor anywhere on covered knob (expect false):", foundScrub);
  await shot("orbit-knob-covered");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
