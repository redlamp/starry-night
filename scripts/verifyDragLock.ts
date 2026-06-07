// Verify the one-drag-at-a-time input lock on /intro.
// Usage: bunx tsx scripts/verifyDragLock.ts
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

  await shot("draglock-home");

  // 1) studio drag that CROSSES the CRT: starts on the stage, sweeps right
  // through the screen area. Pre-lock this stalled the moment the cursor
  // hovered the glass; now the studio orbit must carry the full delta.
  await page.mouse.move(300, 430);
  await page.mouse.down();
  await page.mouse.move(1250, 430, { steps: 40 }); // straight through the CRT
  const midCursor = await page.evaluate(() => document.body.style.cursor);
  console.log("cursor mid studio drag (over CRT):", midCursor.slice(0, 40) || "(default)");
  await page.mouse.up();
  await page.waitForTimeout(1_200);
  await shot("draglock-studio-cross");

  // reset to home pose
  await page.mouse.dblclick(300, 750);
  await page.waitForTimeout(2_200);

  // 2) city drag that EXITS the CRT: starts on the glass, releases on the
  // stage. The city camera must keep the gesture all the way; the studio
  // camera must not move an inch.
  await page.mouse.move(800, 430);
  await page.waitForTimeout(300);
  const hoverCursor = await page.evaluate(() => document.body.style.cursor);
  console.log("cursor over CRT pre-drag (expect pointer):", hoverCursor || "(default)");
  await page.mouse.down();
  await page.mouse.move(1200, 700, { steps: 30 }); // exit the glass mid-drag
  await page.mouse.up();
  await page.mouse.move(200, 800);
  await page.waitForTimeout(1_800); // unhover: pose adopts as new foundation
  await shot("draglock-city-exit");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
