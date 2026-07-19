/** Context-menu probe: right-click the map, record what the contextmenu event did. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = 9344;
const url = process.argv[2] ?? "http://localhost:7827/?probe=1";

function findBrowser(): string {
  let pw = "";
  try { pw = chromium.executablePath(); } catch { pw = ""; }
  const candidates = [pw, "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe"];
  for (const p of candidates) if (p && existsSync(p)) return p;
  throw new Error("no browser");
}
async function httpJson(path: string): Promise<unknown> {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch {}
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

const proc: ChildProcess = spawn(findBrowser(), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=" + process.env.TEMP + "\ctxprobe-profile", "--window-size=1600,1000", "about:blank",
], { stdio: "ignore" });

try {
  await httpJson("/json/version");
  const targets = (await httpJson("/json/list")) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await call(ws, "Page.enable");
  await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 9000));

  await evalJs(ws, `
    (window).__ctxLog = [];
    window.addEventListener("contextmenu", (e) => {
      (window).__ctxLog.push({
        target: (e.target instanceof Element) ? e.target.tagName + "." + (e.target.className?.toString?.().slice(0, 60) ?? "") : String(e.target),
        prevented: e.defaultPrevented,
      });
    });
    "armed";
  `);
  // Plain RMB click mid-map.
  await call(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "right", clickCount: 1, buttons: 2, pointerType: "mouse" });
  await call(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 800, y: 500, button: "right", clickCount: 1, pointerType: "mouse" });
  await new Promise((r) => setTimeout(r, 400));
  console.log("ctx events:", JSON.stringify(await evalJs(ws, `(window).__ctxLog`), null, 1));
  console.log("canvas hit at 800,500:", await evalJs(ws, `(() => { const el = document.elementFromPoint(800, 500); return el ? el.tagName + "." + (el.className?.toString?.().slice(0, 80) ?? "") : "none"; })()`));
} finally {
  proc.kill();
}
