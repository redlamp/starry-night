/** Skyline entry from a LOW camera with a CLOSE pivot (2026-07-26 seam ironing): the old
 * ground guard rejected tilt steps whose orbit arc sank the eye below MIN_EYE_Y, stalling
 * the tilt just above the band. Now the aim keeps pitching in place — a sustained tilt-up
 * drag must reach the band from anywhere, with the eye held at/above the floor. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9359;
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
    "--user-data-dir=" + process.env.TEMP + "\\skylineentry-profile",
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
        return { el: +c.liveElevationDeg.toFixed(3), sky: c.liveSkyline, camY: +s.cameraLive.position[1].toFixed(1), r: s.orbit.radius }; })()`,
    ) as Promise<{ el: number; sky: boolean; camY: number; r: number }>;
  const mouse = (
    type: string,
    x: number,
    y: number,
    o: { button?: string; buttons?: number; clickCount?: number; deltaY?: number } = {},
  ) =>
    call(ws, "Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: o.button ?? "none",
      buttons: o.buttons ?? 0,
      clickCount: o.clickCount ?? 0,
      ...(o.deltaY !== undefined ? { deltaX: 0, deltaY: o.deltaY } : {}),
    });

  // Build the stall scenario: look down 15 deg, then wheel-zoom in hard so the
  // camera sits LOW over the city.
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(15, false)`);
  await sleep(400);
  for (let i = 0; i < 30; i++) {
    await mouse("mouseWheel", 800, 500, { deltaY: -240 });
    await sleep(40);
  }
  await sleep(1200);
  const low = await snap();

  // Sustained RMB tilt-up drag with a CLOSE pivot (press low on screen = ground
  // right under the camera). 300px up at ~0.34 deg/px would sweep ~100 deg of
  // tilt intent — plenty to reach the floor pin.
  await mouse("mousePressed", 800, 700, { button: "right", buttons: 2, clickCount: 1 });
  let minEyeY = Infinity;
  const trail: string[] = [];
  for (let i = 1; i <= 30; i++) {
    await mouse("mouseMoved", 800, 700 - i * 10, { button: "right", buttons: 2 });
    await sleep(16);
    const s = await snap();
    if (s.camY < minEyeY) minEyeY = s.camY;
    if (i % 6 === 0) trail.push(`@${i * 10}px el=${s.el}`);
  }
  await mouse("mouseReleased", 800, 400, { button: "right", buttons: 0, clickCount: 1 });
  console.log("trail:", trail.join(" | "));
  await sleep(400);
  const end = await snap();
  console.log(
    `low pose: el=${low.el} camY=${low.camY} r=${low.r} | after tilt-up drag: el=${end.el} sky=${end.sky} camY=${end.camY} (min during drag ${minEyeY.toFixed(1)})`,
  );
  const pass = end.sky && end.el <= 0.6 && minEyeY >= 0.9;
  console.log(
    `skyline entered from low/close pivot: ${pass ? "PASS" : "FAIL"} (want sky=true, el<=0.6, eye never <1m)`,
  );
} finally {
  proc.kill();
}
