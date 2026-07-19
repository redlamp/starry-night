import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9347;
const url = "http://localhost:7827/?probe=1";
function findBrowser(): string {
  let pw = ""; try { pw = chromium.executablePath(); } catch {}
  for (const p of [pw, "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe"]) if (p && existsSync(p)) return p;
  throw new Error("no browser");
}
async function httpJson(path: string): Promise<unknown> {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error("no CDP");
}
type CdpResult = { exceptionDetails?: unknown; result?: { value?: unknown } };
let seq = 0;
function call(ws: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => { const m = JSON.parse(String(ev.data)); if (m.id === id) { ws.removeEventListener("message", onMsg); if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result as CdpResult); } };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(ws: WebSocket, expression: string): Promise<unknown> {
  const r = await call(ws, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
}
async function mouse(ws: WebSocket, type: string, x: number, y: number, button = "none", opts: Record<string, unknown> = {}) {
  await call(ws, "Input.dispatchMouseEvent", { type, x, y, button, pointerType: "mouse", clickCount: 0, ...opts });
}
async function lmbDrag(ws: WebSocket, fromX: number, fromY: number, dx: number, dy: number) {
  await mouse(ws, "mousePressed", fromX, fromY, "left", { clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 8; i++) { await mouse(ws, "mouseMoved", fromX + (dx * i) / 8, fromY + (dy * i) / 8, "left", { buttons: 1 }); await new Promise((r) => setTimeout(r, 30)); }
  await mouse(ws, "mouseReleased", fromX + dx, fromY + dy, "left", { clickCount: 1 });
  await new Promise((r) => setTimeout(r, 600));
}
const proc: ChildProcess = spawn(findBrowser(), [`--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + process.env.TEMP + "\skypan-profile", "--window-size=1600,1000", "about:blank"], { stdio: "ignore" });
try {
  await httpJson("/json/version");
  const targets = (await httpJson("/json/list")) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === "page")!;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await call(ws, "Page.enable"); await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 10000));
  const pose = async () => (await evalJs(ws, `(() => { const o = (window).__sceneStore.getState().orbit; return { el: o.elevationDeg, cx: o.centerX, cz: o.centerZ }; })()`)) as { el: number; cx: number; cz: number };
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(10, false); "ok"`);
  await new Promise((r) => setTimeout(r, 600));
  for (const [x, y] of [[600, 150], [800, 60], [800, 300], [400, 100]] as const) {
    const el = await evalJs(ws, `(() => { const e = document.elementFromPoint(${x}, ${y}); return e ? e.tagName : "none"; })()`);
    const b = await pose();
    await lmbDrag(ws, x, y, 160, 0);
    const a = await pose();
    console.log(`drag from (${x},${y}) on ${el}: centerDelta ${Math.hypot(a.cx - b.cx, a.cz - b.cz).toFixed(0)}`);
  }
} finally { proc.kill(); }
