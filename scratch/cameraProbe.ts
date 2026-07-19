/**
 * Live probe for the 2026-07-19 camera input swap (playtest feedback):
 * LMB = pan, RMB = rotate, Shift+double-LMB = pan-to-focus, double-LMB = zoom.
 * Raw-CDP transport (see scrollProbe.ts). Drives ?capture=1 (UI hidden, the
 * camera model + __sceneStore are live) with Input.dispatchMouseEvent.
 *
 *   bun scratch/cameraProbe.ts "http://localhost:7827/?capture=1&intro=instant"
 */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = 9343;
const url = process.argv[2] ?? "http://localhost:7827/?capture=1&intro=instant";

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
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
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
  throw new Error(`no CDP endpoint ${path}`);
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

const SHIFT = 8;
async function mouse(
  ws: WebSocket,
  type: "mousePressed" | "mouseReleased" | "mouseMoved",
  x: number,
  y: number,
  button: "left" | "right" | "none" = "none",
  opts: { clickCount?: number; modifiers?: number; buttons?: number } = {},
) {
  await call(ws, "Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button,
    clickCount: opts.clickCount ?? 0,
    modifiers: opts.modifiers ?? 0,
    buttons: opts.buttons ?? 0,
    pointerType: "mouse",
  });
}

async function drag(
  ws: WebSocket,
  button: "left" | "right",
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
) {
  const buttons = button === "left" ? 1 : 2;
  await mouse(ws, "mousePressed", fromX, fromY, button, { clickCount: 1, buttons });
  for (let i = 1; i <= 8; i++) {
    await mouse(ws, "mouseMoved", fromX + (dx * i) / 8, fromY + (dy * i) / 8, button, { buttons });
    await new Promise((r) => setTimeout(r, 30));
  }
  await mouse(ws, "mouseReleased", fromX + dx, fromY + dy, button, { clickCount: 1 });
  await new Promise((r) => setTimeout(r, 700)); // let damping settle + 10Hz writeback land
}

async function dblClick(ws: WebSocket, x: number, y: number, modifiers = 0) {
  for (const cc of [1, 2]) {
    await mouse(ws, "mousePressed", x, y, "left", { clickCount: cc, modifiers, buttons: 1 });
    await mouse(ws, "mouseReleased", x, y, "left", { clickCount: cc, modifiers });
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 1600)); // tween
}

const proc: ChildProcess = spawn(
  findBrowser(),
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=" + process.env.TEMP + "\\camprobe-profile",
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
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  await call(ws, "Page.enable");
  await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 10000));

  const pose = async () =>
    (await evalJs(
      ws,
      `(() => { const o = (window).__sceneStore.getState().orbit; return { az: o.azimuthDeg, el: o.elevationDeg, r: o.radius, cx: o.centerX, cz: o.centerZ }; })()`,
    )) as { az: number; el: number; r: number; cx: number; cz: number };

  const p0 = await pose();
  console.log("start:", JSON.stringify(p0));

  await drag(ws, "left", 800, 500, 160, 0);
  const p1 = await pose();
  console.log(
    "after LMB drag (expect pan: center moves, azimuth holds):",
    JSON.stringify(p1),
    "| azDelta:",
    Math.abs(p1.az - p0.az).toFixed(1),
    "centerDelta:",
    Math.hypot(p1.cx - p0.cx, p1.cz - p0.cz).toFixed(0),
  );

  await drag(ws, "right", 800, 500, 160, 0);
  const p2 = await pose();
  console.log(
    "after RMB drag (expect rotate: azimuth moves, center ~holds):",
    JSON.stringify(p2),
    "| azDelta:",
    Math.abs(p2.az - p1.az).toFixed(1),
    "centerDelta:",
    Math.hypot(p2.cx - p1.cx, p2.cz - p1.cz).toFixed(0),
  );

  await dblClick(ws, 700, 400, SHIFT);
  const p3 = await pose();
  console.log(
    "after Shift+dblclick (expect focus pan: center moves, az/el/r ~hold):",
    JSON.stringify(p3),
    "| azDelta:",
    Math.abs(p3.az - p2.az).toFixed(1),
    "elDelta:",
    Math.abs(p3.el - p2.el).toFixed(1),
    "rDelta:",
    Math.abs(p3.r - p2.r),
    "centerDelta:",
    Math.hypot(p3.cx - p2.cx, p3.cz - p2.cz).toFixed(0),
  );

  await dblClick(ws, 800, 450, 0);
  const p4 = await pose();
  console.log(
    "after plain dblclick (expect zoom-in: radius shrinks):",
    JSON.stringify(p4),
    "| rBefore:",
    p3.r,
    "rAfter:",
    p4.r,
  );
} finally {
  proc.kill();
}
