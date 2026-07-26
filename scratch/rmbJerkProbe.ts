/** 1.2 (2026-07-25 round 2): measure the pose around an RMB press+tiny-drag from the
 * default pose. Theory: the orbit tilt clamp snaps a below-floor pose (default looks UP
 * ~1.06 deg, floor 0) to the floor on the first move event — a ~1 deg instant pitch. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9354;
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
    "--user-data-dir=" + process.env.TEMP + "\\rmbjerk-profile",
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

  const el = () =>
    evalJs(ws, `+(window).__cameraCommand.liveElevationDeg.toFixed(4)`) as Promise<number>;
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

  const before = await el();
  await mouse("mousePressed", 800, 500, { button: "right", buttons: 2, clickCount: 1 });
  await sleep(100);
  const onPress = await el();
  // One 4px horizontal move — a pure yaw intent, dy=0: any pitch change is the clamp snapping.
  await mouse("mouseMoved", 804, 500, { button: "right", buttons: 2 });
  await sleep(150);
  const afterMoveH = await el();
  // Then 4px down (tilt-down intent): should tilt smoothly BY ~0.1 deg, not TO the floor.
  await mouse("mouseMoved", 804, 504, { button: "right", buttons: 2 });
  await sleep(150);
  const afterMoveV = await el();
  await mouse("mouseReleased", 804, 504, { button: "right", buttons: 0, clickCount: 1 });
  console.log(
    `el before=${before} onPress=${onPress} after 4px horiz=${afterMoveH} after +4px down=${afterMoveV}`,
  );
  console.log(
    `horiz-move pitch jump: ${(afterMoveH - onPress).toFixed(3)} deg (snap-to-floor bug if ~+${(-onPress).toFixed(2)})`,
  );
} finally {
  proc.kill();
}
