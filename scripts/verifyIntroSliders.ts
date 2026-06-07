// Regression check: dragging the B/W level sliders must not throw
// (base-ui Slider returns a plain number for single-thumb onValueChange).
// Usage: bunx tsx scripts/verifyIntroSliders.ts

import { chromium } from "playwright";

async function main() {
  const url = process.env.CAPTURE_URL ?? "http://localhost:7828";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(`${url}/intro`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(2_000);
  // sliders live in the gear-icon settings panel now
  await page.click('[data-testid="intro-settings-gear"]');
  await page.waitForTimeout(400);

  const thumbs = page.locator('[data-slot="slider-thumb"]');
  const count = await thumbs.count();
  if (count < 2) throw new Error(`expected 2 slider thumbs, found ${count}`);
  for (let i = 0; i < 2; i++) {
    const box = await thumbs.nth(i).boundingBox();
    if (!box) throw new Error(`thumb ${i} not visible`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  await browser.close();
  if (errors.length) {
    console.error("PAGE ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("sliders OK — no page errors after dragging both");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
