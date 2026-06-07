// Probe cursor zones around the knob/badge cluster — the two hotspots must
// not bleed into each other.
// Usage: bunx tsx scripts/probeCursorZones.ts

import { chromium } from "playwright";

const POINTS: [string, number, number, string][] = [
  ["badge centre", 646, 604, "pointer"],
  ["badge bottom edge", 644, 620, "pointer"],
  ["gap below badge", 643, 628, "grab (mac body)"],
  ["gap above wheel", 642, 636, "grab (mac body)"],
  ["visible wheel sliver", 640, 648, "scrub svg"],
  ["wheel centre-low", 640, 655, "scrub svg"],
];

async function main() {
  const url = process.env.CAPTURE_URL ?? "http://localhost:7828";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${url}/intro`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(2_500);

  for (const [label, x, y, expect] of POINTS) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(250);
    const cursor = await page.evaluate(() => document.body.style.cursor);
    const short = cursor.startsWith('url("data:image/svg+xml') ? "scrub svg" : cursor || "auto";
    console.log(`${label} (${x},${y}): ${short}  [expect ${expect}]`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
