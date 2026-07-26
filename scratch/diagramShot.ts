/** Screenshot the side-view diagram in three poses (perspective default / ortho standard /
 * ortho skyline) to see the "odd appearance from the ortho view" (review 2026-07-26 3.*). */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
const PORT = 9355;
const url = "http://localhost:7827/?probe=1";
const OUT = process.env.TEMP + "\\diagram-shots";
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
async function httpJson(path: string): Promise<unknown> {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no CDP");
}
type CdpResult = { exceptionDetails?: unknown; result?: { value?: unknown }; data?: string };
let seq = 0;
function call(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown> = {},
): Promise<CdpResult> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data));
      if (m.id === id) {
        ws.removeEventListener("message", onMsg);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result as CdpResult);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(ws: WebSocket, expression: string): Promise<unknown> {
  const r = await call(ws, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result?.value;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const proc: ChildProcess = spawn(
  findBrowser(),
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=" + process.env.TEMP + "\\diagramshot-profile",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);
try {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(OUT, { recursive: true });
  await httpJson("/json/version");
  const targets = (await httpJson("/json/list")) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = targets.find((t) => t.type === "page")!;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  await call(ws, "Page.enable");
  await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await sleep(10000);
  await evalJs(ws, `(window).__sceneStore.getState().setShowSideView(true)`);
  await sleep(600);

  const shot = async (name: string) => {
    const r = await call(ws, "Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 560, width: 420, height: 420, scale: 1 },
    });
    writeFileSync(`${OUT}\\${name}.png`, Buffer.from(String(r.data), "base64"));
    console.log(`${OUT}\\${name}.png`);
  };
  const key = (k: string) =>
    evalJs(
      ws,
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, code: "Key${k.toUpperCase()}", bubbles: true }))`,
    );

  await shot("1-persp-default");
  await key("p");
  await sleep(3000);
  await shot("2-ortho-level");
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(0.2, false)`);
  await sleep(1200);
  await shot("3-ortho-skyline");
  // Pedestal (lens-shift) inside ortho skyline: vertical LMB drag — the diagram should
  // keep a LEVEL axis with the frame riding up (user 2026-07-26 3.3).
  const mouse = (type: string, x: number, y: number, o: Record<string, unknown> = {}) =>
    call(ws, "Input.dispatchMouseEvent", { type, x, y, button: "none", buttons: 0, ...o });
  await mouse("mousePressed", 800, 600, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    await mouse("mouseMoved", 800, 600 + i * 12, { button: "left", buttons: 1 });
    await sleep(16);
  }
  await mouse("mouseReleased", 800, 744, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(900);
  await shot("3b-ortho-skyline-pedestal");
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(25, false)`);
  await sleep(1200);
  await shot("4-ortho-25deg");
} finally {
  proc.kill();
}
