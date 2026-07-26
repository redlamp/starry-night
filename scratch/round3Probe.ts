/** 2026-07-26 round-3 checks: (A) the regime DISPLAY flips mid-drag while held (preview
 * latch) and (B) entering ortho skyline no longer auto-moves the frame (adopt-on-entry). */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9356;
const url = "http://localhost:7827/?probe=1";
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
type CdpResult = { exceptionDetails?: unknown; result?: { value?: unknown } };
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
    "--user-data-dir=" + process.env.TEMP + "\\round3probe-profile",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);
try {
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

  const snap = () =>
    evalJs(
      ws,
      `(() => { const c = (window).__cameraCommand, s = (window).__sceneStore.getState();
        return { el: +c.liveElevationDeg.toFixed(3), sky: c.liveSkyline, camY: +s.cameraLive.position[1].toFixed(1) }; })()`,
    ) as Promise<{ el: number; sky: boolean; camY: number }>;
  const mouse = (
    type: string,
    x: number,
    y: number,
    o: { button?: string; buttons?: number; clickCount?: number } = {},
  ) =>
    call(ws, "Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: o.button ?? "none",
      buttons: o.buttons ?? 0,
      clickCount: o.clickCount ?? 0,
    });
  const key = (k: string) =>
    evalJs(
      ws,
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, code: "Key${k.toUpperCase()}", bubbles: true }))`,
    );

  // ---- A. Mid-drag display preview: from 5 deg, hold RMB and tilt up THROUGH the band —
  // liveSkyline must flip to true WHILE the button is still down.
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(5, false)`);
  await sleep(400);
  const a0 = await snap();
  await mouse("mousePressed", 800, 500, { button: "right", buttons: 2, clickCount: 1 });
  for (let i = 1; i <= 15; i++) {
    await mouse("mouseMoved", 800, 500 - i, { button: "right", buttons: 2 });
    await sleep(16);
  }
  await sleep(300);
  const mid = await snap(); // still held
  await mouse("mouseReleased", 800, 485, { button: "right", buttons: 0, clickCount: 1 });
  await sleep(300);
  const rel = await snap();
  console.log(
    `A preview: start el=${a0.el} sky=${a0.sky} | HELD el=${mid.el} sky=${mid.sky} (want true mid-drag) | released sky=${rel.sky}  => ${!a0.sky && mid.sky && rel.sky ? "PASS" : "FAIL"}`,
  );

  // ---- B. Ortho skyline adopt-on-entry: after the ortho morph levels the aim (el -> 0,
  // regime engages), the camera height must NOT drift (the old preset lens tween dropped it).
  await key("r");
  await sleep(2600);
  await key("p");
  await sleep(3000);
  const b0 = await snap();
  await sleep(1500);
  const b1 = await snap();
  const drift = Math.abs(b1.camY - b0.camY);
  console.log(
    `B adopt-on-entry: ortho el=${b0.el} sky=${b0.sky} camY ${b0.camY} -> ${b1.camY} (drift ${drift.toFixed(1)}m, want < 5)  => ${drift < 5 ? "PASS" : "FAIL"}`,
  );
} finally {
  proc.kill();
}
