import { chromium } from "playwright";

const active = (page: import("playwright").Page) =>
  page.evaluate(() => {
    // active chip carries "bg-foreground" (solid); inactive carries
    // "bg-foreground/10". Report which one is the active (solid) chip.
    const re = /(^|\s)bg-foreground(\s|$)/;
    const s = document.querySelector('[data-testid="viewport-mode-screen"]');
    const g = document.querySelector('[data-testid="viewport-mode-snowglobe"]');
    if (s && re.test(s.className)) return "screen";
    if (g && re.test(g.className)) return "snowglobe";
    return "none";
  });

async function main() {
  const url = process.env.CAPTURE_URL ?? "http://localhost:7828";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${url}/intro`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(2_500);

  console.log("initial (screen active):", JSON.stringify(await active(page)));
  await page.keyboard.press("KeyS");
  await page.waitForTimeout(300);
  console.log("after S (globe active):", JSON.stringify(await active(page)));
  await page.keyboard.press("KeyS");
  await page.waitForTimeout(300);
  console.log("after S again (screen active):", JSON.stringify(await active(page)));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
