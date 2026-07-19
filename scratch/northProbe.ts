/** Sample liveAzimuthDeg + needle transform through a rotateNorthUp press in top-down. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9349;
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
function call(ws: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
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
  const r = await call(ws, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
}
const proc: ChildProcess = spawn(
  findBrowser(),
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=" + process.env.TEMP + "\\northprobe2-profile",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);
try {
  await httpJson("/json/version");
  const targets = (await httpJson("/json/list")) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === "page")!;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  await call(ws, "Page.enable");
  await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 10000));

  await evalJs(ws, `(window).__cameraCommand.toggleTopDownInModel?.(); "diving"`);
  await new Promise((r) => setTimeout(r, 4000));

  // Spin the heading well away from north while parked (RMB drag).
  await call(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "right", clickCount: 1, buttons: 2, pointerType: "mouse" });
  for (let i = 1; i <= 10; i++) {
    await call(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 800 + i * 40, y: 500, button: "right", buttons: 2, pointerType: "mouse" });
    await new Promise((r) => setTimeout(r, 30));
  }
  await call(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 1200, y: 500, button: "right", clickCount: 1, pointerType: "mouse" });
  await new Promise((r) => setTimeout(r, 900));

  const sample = () =>
    evalJs(
      ws,
      `
    (() => {
      const svg = document.querySelector('button[aria-label="Rotate North-Up"] svg');
      const m = svg ? svg.style.transform.match(/rotateZ\\(([-\\d.]+)deg\\)/) : null;
      return {
        az: Math.round((window).__cameraCommand.liveNorthScreenDeg * 10) / 10,
        needle: m ? Math.round(Number(m[1]) * 10) / 10 : "none",
        parked: (window).__sceneStore.getState().topDownParked,
      };
    })()
  `,
    );
  console.log("pre-press:", JSON.stringify(await sample()));
  await evalJs(ws, `(window).__cameraCommand.rotateNorthUp?.(); "pressed"`);
  for (let i = 0; i < 20; i++) {
    console.log(`t+${i * 50}ms:`, JSON.stringify(await sample()));
    await new Promise((r) => setTimeout(r, 50));
  }
} finally {
  proc.kill();
}
