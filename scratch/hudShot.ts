/** Screenshot the top-right HUD row: compass must sit BETWEEN drift and settings at the
 * same size (2026-07-26), and honor Off/Auto/On. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
const PORT = 9357;
const url = "http://localhost:7827/?probe=1";
const OUT = process.env.TEMP + "\\hud-shots";
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
    "--user-data-dir=" + process.env.TEMP + "\\hudshot-profile",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);
try {
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
  const wake = async () => {
    // useIdle fades the chrome after ~5s without input — nudge the mouse first.
    await call(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 400 });
    await call(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 705, y: 402 });
    await sleep(900);
  };
  const shot = async (name: string) => {
    await wake();
    const r = await call(ws, "Page.captureScreenshot", {
      format: "png",
      clip: { x: 1350, y: 0, width: 250, height: 70, scale: 2 },
    });
    writeFileSync(`${OUT}\\${name}.png`, Buffer.from(String(r.data), "base64"));
    console.log(`${OUT}\\${name}.png`);
  };
  await evalJs(ws, `(window).__sceneStore.getState().setCompassMode("auto")`);
  await sleep(500);
  await shot("1-auto");
  await evalJs(ws, `(window).__sceneStore.getState().setCompassMode("off")`);
  await sleep(500);
  await shot("2-off");
  await evalJs(ws, `(window).__sceneStore.getState().setCompassMode("on")`);
  await sleep(500);
  await shot("3-on");
} finally {
  proc.kill();
}
