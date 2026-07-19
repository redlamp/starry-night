/** Enumerate contextmenu listeners on window + canvas of the live page (DOMDebugger). */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = 9345;
const url = process.argv[2] ?? "http://localhost:7827/";
function findBrowser(): string {
  let pw = "";
  try { pw = chromium.executablePath(); } catch { pw = ""; }
  for (const p of [pw, "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Google\Chrome\Application\chrome.exe"]) if (p && existsSync(p)) return p;
  throw new Error("no browser");
}
async function httpJson(path: string): Promise<unknown> {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no CDP");
}
type CdpListener = { type: string; useCapture?: boolean; passive?: boolean };
type CdpResult = { result?: { objectId?: string }; listeners?: CdpListener[] };
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
const proc: ChildProcess = spawn(findBrowser(), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=" + process.env.TEMP + "\lprobe-profile", "--window-size=1600,1000", "about:blank",
], { stdio: "ignore" });
try {
  await httpJson("/json/version");
  const targets = (await httpJson("/json/list")) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === "page")!;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await call(ws, "Page.enable");
  await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 9000));

  const winObj = await call(ws, "Runtime.evaluate", { expression: "window" });
  const win = await call(ws, "DOMDebugger.getEventListeners", { objectId: winObj.result!.objectId });
  const canvasObj = await call(ws, "Runtime.evaluate", { expression: `document.querySelector("canvas")` });
  const cv = canvasObj.result?.objectId
    ? await call(ws, "DOMDebugger.getEventListeners", { objectId: canvasObj.result.objectId! })
    : { listeners: [] };
  const fmt = (l: CdpListener) => `${l.type}${l.useCapture ? " (capture)" : ""}${l.passive ? " passive" : ""}`;
  console.log("WINDOW ctx listeners:", (win.listeners ?? []).filter((l) => l.type === "contextmenu").map(fmt));
  console.log("CANVAS ctx listeners:", (cv.listeners ?? []).filter((l) => l.type === "contextmenu").map(fmt));
  console.log("CANVAS all listener types:", [...new Set((cv.listeners ?? []).map((l) => l.type))].join(", "));
} finally {
  proc.kill();
}
