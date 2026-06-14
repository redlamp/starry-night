/**
 * Screenshot capture that sidesteps the Windows Playwright hang entirely.
 *
 *   bun scripts/cdpShot.ts "<url>" "<outfile.png>"
 *
 * Both of Playwright's transports hang on this box: chromium.launch() on the
 * --remote-debugging-PIPE handshake, and connectOverCDP() on the DevTools
 * WebSocket (its driver subprocess never completes the upgrade). See
 * ~/.claude/memory/tools/playwright-windows-launch-hang.md.
 *
 * So we don't use Playwright's connection at all: spawn chrome with
 * --remote-debugging-port ourselves, open a RAW WebSocket from this process to
 * the page target, and drive it with the CDP wire protocol (Page.navigate +
 * Page.captureScreenshot). Playwright is imported only for executablePath().
 *
 * Assumes the dev server is already running (default http://localhost:7827).
 */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9333;
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 1000);
const SETTLE = Number(process.env.SHOT_SETTLE ?? 3500);
const url = process.argv[2] ?? "http://localhost:7827/?capture=1&intro=instant";
const out = process.argv[3] ?? "samples/_shot.png";

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
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) if (p && existsSync(p)) return p;
  throw new Error("no chromium/edge/chrome binary found");
}

type Json = Record<string, unknown>;

async function httpJson(path: string, method = "GET"): Promise<Json> {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
      if (r.ok) return (await r.json()) as Json;
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`CDP endpoint ${path} never responded`);
}

// Minimal CDP client over a raw WebSocket (Bun/Node global WebSocket).
function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  const open = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws open timeout")), 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error("ws error"));
    });
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

const exe = findBrowser();
console.log("browser:", exe);
const userDataDir = mkdtempSync(join(tmpdir(), "cdpshot-"));
const proc: ChildProcess = spawn(
  exe,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    "--hide-scrollbars",
    "--enable-unsafe-swiftshader", // software WebGL when there's no GPU
    `--window-size=${W},${H}`,
  ],
  { stdio: "ignore" },
);

let code = 1;
try {
  const ver = await httpJson("/json/version");
  console.log("CDP up:", ver.Browser);
  // Create a tab already navigated to the target (PUT required on Chrome >= 111).
  const tab = await httpJson(`/json/new?${encodeURIComponent(url)}`, "PUT");
  console.log("page ws:", tab.webSocketDebuggerUrl);
  const client = cdp(tab.webSocketDebuggerUrl as string);
  await client.open;
  console.log("raw ws OPEN");
  await client.send("Page.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((res) => setTimeout(res, SETTLE));
  const setup = process.env.SHOT_SETUP;
  if (setup) {
    await client.send("Runtime.evaluate", { expression: setup, returnByValue: true });
    await new Promise((res) => setTimeout(res, 2200)); // let the pose settle after the setup nudge
  }
  const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(String(shot.data), "base64"));
  console.log("shot →", out);
  const evalExpr = process.argv[4];
  if (evalExpr) {
    const r = (await client.send("Runtime.evaluate", {
      expression: evalExpr,
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    console.log("EVAL:", JSON.stringify(r.result?.value ?? r.exceptionDetails ?? r));
  }
  client.close();
  code = 0;
} catch (err) {
  console.error("FAILED:", (err as Error).message);
} finally {
  proc.kill();
}
process.exit(code);
