// Verify the Apple-badge click rerolls the seed AND replays the wake intro.
// Usage: bunx tsx scripts/verifyBadgeReplay.ts
// Env: CAPTURE_URL (default http://localhost:7828), CAPTURE_OUT (default samples/intro)
//      BADGE_X / BADGE_Y — screen px of the working Mac's Apple badge

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

async function main() {
  const url = process.env.CAPTURE_URL ?? "http://localhost:7828";
  const outDir = resolve(process.env.CAPTURE_OUT ?? "samples/intro");
  await mkdir(outDir, { recursive: true });
  const bx = Number(process.env.BADGE_X ?? 646);
  const by = Number(process.env.BADGE_Y ?? 604);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.text().startsWith("[intro]"))
      console.log(`[console.${msg.type()}]`, msg.text().slice(0, 1500));
  });
  page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 1500)));
  await page.goto(`${url}/intro`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(Number(process.env.CAPTURE_SETTLE ?? 2_500));

  const shot = async (name: string) => {
    const p = resolve(outDir, `${name}.png`);
    await page.screenshot({ path: p });
    console.log("captured", p);
  };

  // fresh load: idle intro snaps to fully awake — screen lit, no boot crawl
  await shot("replay-loaded-awake");

  // badge click: new seed + wake replay — moments later the screen should be
  // a DIFFERENT city with most windows still dark (sequence just started)
  await page.mouse.click(bx, by);
  await page.waitForTimeout(3_000);
  await shot("replay-just-clicked");

  // ~20s in: noticeably more windows awake than at t=3s (progress advancing)
  await page.waitForTimeout(20_000);
  await shot("replay-20s-later");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
