// Verify the brightness-knob sync + low-orbit changes on /intro.
// Usage: bunx tsx scripts/verifyKnob.ts
// Env: CAPTURE_URL (default http://localhost:7828), CAPTURE_OUT (default samples/intro)
//      KNOB_X / KNOB_Y — screen px of the knob hotspot (pass after locating
//      it in knob-home.png; skip the drag scenario when unset)

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

  await shot("knob-home");

  // 1) orbit DOWN (drag up = phi increases): camera should sink toward the
  // sweep and look up under the chin overhang — previously clamped at
  // pi/2 - 0.04, i.e. barely below eye level
  await page.mouse.move(800, 650);
  await page.mouse.down();
  await page.mouse.move(800, 250, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1_200);
  await shot("knob-low-orbit");

  // 2) dolly in for the chin close-up (knob lighting/shadow check)
  await page.mouse.move(800, 450);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(900);
  await shot("knob-low-closeup");

  // 2b) wheel-roll check: scroll over the knob hotspot spins the wheel
  // around its facade-normal axle (ribs shift, no coin-wobble) and sets
  // brightness — min, then max
  await page.mouse.move(500, 730);
  await page.waitForTimeout(400);
  for (let i = 0; i < 15; i++) await page.mouse.wheel(0, 100); // scroll down = dim
  await page.waitForTimeout(500);
  await shot("knob-roll-min");
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -100); // scroll up = bright
  await page.waitForTimeout(500);
  await shot("knob-roll-max");

  // reset to home pose before the drag scenario
  await page.mouse.dblclick(300, 750);
  await page.waitForTimeout(2_200);

  // 3) knob drag (coordinates from a prior knob-home.png read)
  const kx = Number(process.env.KNOB_X ?? NaN);
  const ky = Number(process.env.KNOB_Y ?? NaN);
  if (Number.isFinite(kx) && Number.isFinite(ky)) {
    await page.mouse.move(kx, ky);
    await page.waitForTimeout(400);
    const cursor = await page.evaluate(() => document.body.style.cursor);
    console.log(
      "cursor over knob:",
      cursor.startsWith('url("data:image/svg+xml')
        ? `custom svg scrub cursor (fallback: ${cursor.split(", ").pop()})`
        : cursor || "(default)",
    );
    // diagonal drag left+down = dim on BOTH axes — and the Mac must NOT
    // orbit while the knob owns the drag
    await page.mouse.down();
    await page.mouse.move(kx - 80, ky + 80, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    await shot("knob-dragged-dim");

    // two-way check: the slider should read the dragged value
    await page.click('[data-testid="intro-settings-gear"]');
    await page.waitForTimeout(500);
    await shot("knob-settings-after-drag");

    // dblclick the knob: full screen-settings reset (brightness back to 1.00)
    await page.mouse.dblclick(kx, ky);
    await page.waitForTimeout(600);
    await shot("knob-dblclick-reset");

    // the card's Reset button does the same
    await page.click('[data-testid="screen-settings-reset"]');
    await page.waitForTimeout(600);
    await shot("knob-after-reset");
  } else {
    console.log("KNOB_X/KNOB_Y unset — skipped drag scenario");
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
