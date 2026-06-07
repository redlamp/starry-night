// Verify: gradual star wake on load, knob cursor on top-down approach,
// hover+spacebar auto-orbit.
// Usage: bunx tsx scripts/verifyStarsOrbit.ts

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

  // --- gradual star wake: capture right after canvas, then a beat later ---
  await page.goto(`${url}/intro`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(1_500); // city warms; stars mid-fade (~12s ramp)
  await page.screenshot({ path: resolve(outDir, "wake-early.png") });
  console.log("captured wake-early (stars should be partial)");
  await page.waitForTimeout(13_000);
  await page.screenshot({ path: resolve(outDir, "wake-full.png") });
  console.log("captured wake-full (stars should be dense)");

  // --- knob cursor on a TOP-DOWN approach (enter the hotspot from above) ---
  for (let y = 600; y <= 670; y += 5) {
    await page.mouse.move(640, y);
    await page.waitForTimeout(70);
  }
  const topDown = await page.evaluate(() => document.body.style.cursor);
  console.log(
    "knob cursor after top-down sweep (expect scrub):",
    topDown.startsWith("url(") ? "scrub" : topDown || "auto",
  );

  // --- hover the screen + spacebar: city should auto-rotate while hovered ---
  await page.mouse.move(800, 420); // over the CRT
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(outDir, "hover-orbit-t0.png") });
  await page.waitForTimeout(8_000);
  await page.screenshot({ path: resolve(outDir, "hover-orbit-t8.png") });
  await page.keyboard.press("Space");
  console.log("captured hover-orbit t0/t8 (city should have rotated while hovered)");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
