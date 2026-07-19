/**
 * Skyline-band + pan-anywhere probe (2026-07-19 plan). Asserts against the
 * orbit store on ?probe=1 (exposes __sceneStore + __cameraCommand):
 *  1. Tilt reachability: setTiltDeg sweeps land where asked (perspective + ortho).
 *  2. Regime: vertical LMB drag pedestals (lookAtY changes) only inside the
 *     latched skyline band; hysteresis holds between 1.0 and 1.5 deg.
 *  3. Pan-anywhere: LMB drag starting on a sky pixel still pans (no dead zones).
 */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = 9346;
const url = process.argv[2] ?? "http://localhost:7827/?probe=1";
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
async function mouse(ws: WebSocket, type: string, x: number, y: number, button = "none", opts: Record<string, unknown> = {}) {
  await call(ws, "Input.dispatchMouseEvent", { type, x, y, button, pointerType: "mouse", clickCount: 0, ...opts });
}
async function lmbDrag(ws: WebSocket, fromX: number, fromY: number, dx: number, dy: number) {
  await mouse(ws, "mousePressed", fromX, fromY, "left", { clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 8; i++) {
    await mouse(ws, "mouseMoved", fromX + (dx * i) / 8, fromY + (dy * i) / 8, "left", { buttons: 1 });
    await new Promise((r) => setTimeout(r, 30));
  }
  await mouse(ws, "mouseReleased", fromX + dx, fromY + dy, "left", { clickCount: 1 });
  await new Promise((r) => setTimeout(r, 700));
}

const proc: ChildProcess = spawn(findBrowser(), [
  `--remote-debugging-port=${PORT}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=" + process.env.TEMP + "\skyprobe-profile", "--window-size=1600,1000", "about:blank",
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
  await new Promise((r) => setTimeout(r, 10000));

  const pose = async () =>
    (await evalJs(ws, `(() => { const o = (window).__sceneStore.getState().orbit; return { el: o.elevationDeg, cx: o.centerX, cz: o.centerZ, ly: o.lookAtY }; })()`)) as { el: number; cx: number; cz: number; ly: number };
  const setTilt = async (deg: number) => {
    await evalJs(ws, `(window).__cameraCommand.setTiltDeg(${deg}, false); "ok"`);
    await new Promise((r) => setTimeout(r, 600));
  };

  // 1. Reachability sweep (perspective).
  for (const t of [1.5, 1.0, 0.5, 0]) {
    await setTilt(t);
    const p = await pose();
    console.log(`setTilt(${t}) -> elevation ${p.el}`);
  }

  // 2. Regime + hysteresis via vertical LMB drag (perspective): inside skyline the
  //    drag pedestals -> lookAtY changes; outside it ground-pans -> lookAtY stays 0.
  const regimeAt = async (tilt: number) => {
    await setTilt(tilt);
    const before = await pose();
    await lmbDrag(ws, 800, 500, 0, -120);
    const after = await pose();
    const pedestal = Math.abs(after.ly - before.ly) > 2;
    console.log(`tilt ${tilt}: lookAtY ${before.ly} -> ${after.ly} => ${pedestal ? "SKYLINE reframe" : "normal pan"}`);
    return pedestal;
  };
  await regimeAt(5);    // expect normal
  await regimeAt(0.5);  // expect skyline (entered below 1.0)
  await regimeAt(1.3);  // expect STILL skyline (hysteresis: below exit 1.5)
  await regimeAt(2.5);  // expect normal again (exited above 1.5)

  // 3. Pan-anywhere: from a top-of-screen sky pixel at a normal tilt.
  await setTilt(10);
  const b3 = await pose();
  await lmbDrag(ws, 800, 60, 160, 0); // y=60: sky region
  const a3 = await pose();
  console.log(`sky-pixel LMB drag: centerDelta ${Math.hypot(a3.cx - b3.cx, a3.cz - b3.cz).toFixed(0)} (expect > 0)`);

  // 4. Ortho: reachability + sky-pixel pan.
  await evalJs(ws, `(window).__sceneStore.getState().setProjection("orthographic"); "ok"`);
  await new Promise((r) => setTimeout(r, 2500));
  await setTilt(0.5);
  console.log("ortho setTilt(0.5) -> elevation", (await pose()).el);
  await setTilt(10);
  const b4 = await pose();
  await lmbDrag(ws, 800, 60, 160, 0);
  const a4 = await pose();
  console.log(`ortho sky-pixel LMB drag: centerDelta ${Math.hypot(a4.cx - b4.cx, a4.cz - b4.cz).toFixed(0)} (expect > 0)`);
} finally {
  proc.kill();
}
