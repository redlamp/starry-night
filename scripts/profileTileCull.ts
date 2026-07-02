/**
 * Tile-cull recompaction frequency profiler (task 13).
 * Derived from scripts/cdpShot.ts (same raw-CDP approach, Windows-safe).
 *
 *   bun tileCullProfile.ts
 *
 * Loads the app in capture mode, then measures per-frame changes of the
 * buildings tile-cull readout (tilesVisible|itemsDrawn signature) over a
 * 12s window, twice: camera STILL (baseline) and camera in Drift orbit
 * (worst case). A signature change ≈ a recompaction frame (same-count
 * tile-set swaps are missed, so this slightly undercounts).
 */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9334;
const URL_ = "http://localhost:7827/?capture=1&intro=instant&seed=moire-hunt-1";

function findBrowser(): string {
  let pw = "";
  try {
    pw = chromium.executablePath();
  } catch {
    pw = "";
  }
  const candidates = [
    pw,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) if (p && existsSync(p)) return p;
  throw new Error("no browser");
}

type Json = Record<string, unknown>;
async function httpJson(path: string, method = "GET"): Promise<Json> {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
      if (r.ok) return (await r.json()) as Json;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("CDP never responded");
}

function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  const open = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws error")));
  });
  ws.addEventListener("message", (ev: MessageEvent) => {
    const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Json; error?: Json };
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result ?? {});
    }
  });
  const send = (method: string, params: Json = {}) =>
    new Promise<Json>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { open, send, close: () => ws.close() };
}

const SAMPLER = (label: string, ms: number) => `
(async () => {
  const read = window.__tileCullDebug.readTileCull;
  let frames = 0, changes = 0, last = "";
  await new Promise((done) => {
    const t0 = performance.now();
    function tick() {
      const r = read("buildings");
      const sig = r.tilesVisible + "|" + r.itemsDrawn;
      if (frames > 0 && sig !== last) changes++;
      last = sig; frames++;
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else done(null);
    }
    requestAnimationFrame(tick);
  });
  const r = read("buildings");
  return JSON.stringify({ label: "${label}", frames, changes,
    ratePct: +(100 * changes / Math.max(1, frames)).toFixed(2),
    tilesVisible: r.tilesVisible, tilesTotal: r.tilesTotal,
    itemsDrawn: r.itemsDrawn, itemsTotal: r.itemsTotal, culling: r.culling });
})()`;

const exe = findBrowser();
const proc: ChildProcess = spawn(
  exe,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "cullprof-"))}`,
    "--no-first-run",
    "--mute-audio",
    "--window-size=1920,1080",
  ],
  { stdio: "ignore" },
);

let code = 1;
try {
  await httpJson("/json/version");
  const tab = await httpJson(`/json/new?${encodeURIComponent(URL_)}`, "PUT");
  const client = cdp(tab.webSocketDebuggerUrl as string);
  await client.open;
  await client.send("Page.enable");
  await new Promise((r) => setTimeout(r, 9000)); // city gen + first frames

  const evalAwait = async (expr: string) => {
    const r = (await client.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      timeout: 30000,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };

  console.log("STILL:", await evalAwait(SAMPLER("still", 12000)));
  await evalAwait(
    `(async () => { const s = window.__sceneStore.getState(); s.setCameraModel("drift"); s.setCameraMode("orbit"); await new Promise(r => setTimeout(r, 2000)); return "ok"; })()`,
  );
  console.log("DRIFT:", await evalAwait(SAMPLER("drift-orbit", 12000)));
  client.close();
  code = 0;
} catch (err) {
  console.error("FAILED:", (err as Error).message);
} finally {
  proc.kill();
}
process.exit(code);
