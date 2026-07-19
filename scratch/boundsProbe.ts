/** Store state-machine check: directory <-> district boundaries sync + sticky opt-out. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9351;
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
    "--user-data-dir=" + process.env.TEMP + "\\boundsprobe-profile",
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
  await new Promise((r) => setTimeout(r, 9000));
  const out = await evalJs(
    ws,
    `
    (() => {
      const s = () => (window).__sceneStore.getState();
      const log = [];
      const snap = (label) =>
        log.push(label + ": open=" + s().directoryOpen + " bounds=" + s().showDistrictBoundaries + " optOut=" + s().boundariesOptOut + " auto=" + s().boundariesAutoOn);
      snap("start");
      s().setDirectoryOpen(true); snap("open dir            (expect bounds ON, auto)");
      s().setDirectoryOpen(false); snap("close dir           (expect bounds OFF)");
      s().setDirectoryOpen(true); snap("reopen              (expect bounds ON)");
      s().setShowDistrictBoundaries(false); snap("manual OFF          (expect optOut)");
      s().setDirectoryOpen(false); snap("close");
      s().setDirectoryOpen(true); snap("reopen              (expect bounds STAY OFF)");
      s().setShowDistrictBoundaries(true); snap("manual ON           (expect optOut cleared)");
      s().setDirectoryOpen(false); snap("close               (manual ON survives, not auto)");
      s().setDirectoryOpen(true); snap("reopen              (bounds already on)");
      s().setDirectoryOpen(false); snap("final close");
      return log.join("\\n");
    })()
  `,
  );
  console.log(out);
} finally {
  proc.kill();
}
