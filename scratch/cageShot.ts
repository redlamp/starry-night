/** Building cage alignment + unit borders (2026-07-27): select + focus a building, zoom
 * toward its map pin, screenshot. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
const PORT = 9366;
const url = "http://localhost:7827/?probe=1";
const OUT = process.env.TEMP + "\\cage-shots";
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
    "--user-data-dir=" + process.env.TEMP + "\\cageshot2-profile",
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
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(12, false)`); // side-ish view for height judgment
  await sleep(400);
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState(); s.setSelectedBuildingId(29); s.setFocusedBuildingId(29); })()`,
  );
  await sleep(6000); // persona directory cold build for the unit boxes

  // Frame building 29 (storefront-eligible, 15 floors @ (247, 511), h 49) via the
  // focus glide — the same mechanism the building cards use.
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState();
       s.setFocusPivot([247, 25, 511]);
       s.setFocusRequest({ x: 247, y: 25, z: 511, radius: 40, fit: "fill" }); })()`,
  );
  await sleep(4000);
  const r = await call(ws, "Page.captureScreenshot", {
    format: "png",
    clip: { x: 500, y: 150, width: 700, height: 700, scale: 1.3 },
  });
  writeFileSync(`${OUT}\\cage.png`, Buffer.from(String(r.data), "base64"));
  console.log(`${OUT}\\cage.png`);
} finally {
  proc.kill();
}
