/**
 * Headless screenshot capture for seed sample curation.
 *
 *   bun run capture <seed1> <seed2> ...
 *   bun run capture --random <count>
 *
 * Env:
 *   CAPTURE_URL       default http://localhost:7827
 *   CAPTURE_W         default 1920
 *   CAPTURE_H         default 1080
 *   CAPTURE_SETTLE_MS default 1500   — pause after canvas appears so scene stabilises
 *   CAPTURE_OUT       default ./samples
 *
 * Assumes the dev server (or any server hosting the app) is running at CAPTURE_URL.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

function parseArgs(argv: string[]): string[] {
  const args = argv.slice(2);
  if (args[0] === "--random") {
    const n = parseInt(args[1] ?? "5", 10);
    return Array.from({ length: n }, randomSeed);
  }
  return args;
}

async function main() {
  const seeds = parseArgs(process.argv);
  if (seeds.length === 0) {
    console.error("usage: bun run capture <seed1> <seed2> ...");
    console.error("       bun run capture --random <count>");
    process.exit(1);
  }

  const url = process.env.CAPTURE_URL ?? "http://localhost:7827";
  const width = parseInt(process.env.CAPTURE_W ?? "1920", 10);
  const height = parseInt(process.env.CAPTURE_H ?? "1080", 10);
  const settle = parseInt(process.env.CAPTURE_SETTLE_MS ?? "1500", 10);
  const outDir = resolve(process.env.CAPTURE_OUT ?? "samples");

  await mkdir(outDir, { recursive: true });

  console.log(`capturing ${seeds.length} seed(s) at ${width}x${height} → ${outDir}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });

  let ok = 0;
  let fail = 0;

  for (const seed of seeds) {
    const fullUrl = `${url}/?seed=${encodeURIComponent(seed)}&capture=1`;
    const file = resolve(outDir, `${seed}.png`);
    process.stdout.write(`  ${seed} ... `);
    const page = await ctx.newPage();
    try {
      await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForSelector("canvas", { timeout: 10_000 });
      await page.waitForTimeout(settle);
      await page.screenshot({ path: file, type: "png" });
      console.log(`ok → ${file}`);
      ok++;
    } catch (err) {
      console.log(`fail (${(err as Error).message})`);
      fail++;
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(`done — ${ok} ok, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
