// Perf triage: compare fps + tile-cull stats between / and /intro in the
// same headless browser. Usage: bunx tsx scripts/perfProbe.ts

import { chromium } from "playwright";

const URL = process.env.CAPTURE_URL ?? "http://localhost:7828";

type Probe = {
  fps: number;
  calls: number;
  triangles: number;
  cull?: unknown;
};

async function probe(path: string, settleMs: number): Promise<Probe> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${URL}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas", { timeout: 15_000 });
  await page.waitForTimeout(settleMs);
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      __sceneStore?: { getState: () => { perf: { fps: number; calls: number; triangles: number } } };
      __tileCullDebug?: { readTileCull: (layer: string) => unknown };
    };
    const perf = w.__sceneStore?.getState().perf;
    let cull: unknown;
    try {
      cull = w.__tileCullDebug?.readTileCull("buildings");
    } catch {
      cull = "n/a";
    }
    return { fps: perf?.fps ?? -1, calls: perf?.calls ?? -1, triangles: perf?.triangles ?? -1, cull };
  });
  await browser.close();
  return result;
}

async function main() {
  const root = await probe("/?capture=1&intro=instant", 10_000);
  console.log("MAIN /      :", JSON.stringify(root));
  const intro = await probe("/intro", 10_000);
  console.log("INTRO /intro:", JSON.stringify(intro));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
