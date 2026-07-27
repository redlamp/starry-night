/** Touch 2-finger latch after twist removal (2026-07-27): a twist must do NOTHING,
 * and a latched swipe must mark only ITS action ("rotate" for LR, "tilt" for UD) so
 * the controls guide lights one row. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9374;
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
    "--user-data-dir=" + process.env.TEMP + "\\notwist-profile",
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
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(25, false)`);
  await sleep(500);

  type Pt = { x: number; y: number; id: number };
  const touch = (type: string, points: Pt[]) =>
    call(ws, "Input.dispatchTouchEvent", { type, touchPoints: points });
  const snap = () =>
    evalJs(
      ws,
      `(() => { const s = (window).__sceneStore.getState(); const c = (window).__cameraCommand;
        const a = (window).__cameraActivity;
        return { az: +c.liveAzimuthDeg.toFixed(2), el: +c.liveElevationDeg.toFixed(2),
                 r: +s.orbit.radius.toFixed(1), action: a.action }; })()`,
    ) as Promise<{ az: number; el: number; r: number; action: string | null }>;
  const twoFingerDrag = async (mk: (i: number) => [Pt, Pt], steps = 12) => {
    await touch("touchStart", [mk(0)[0]]);
    await touch("touchStart", mk(0));
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", mk(i));
      await sleep(16);
    }
  };
  const endTouch = async () => {
    await touch("touchEnd", []);
    await sleep(400);
  };
  const dAng = (a: number, b: number) =>
    Math.abs(Math.atan2(Math.sin(((b - a) * Math.PI) / 180), Math.cos(((b - a) * Math.PI) / 180))) *
    (180 / Math.PI);

  // A) Swipe left-right: orbit, and the ACTIVE action is "rotate" (Orbit row only).
  const a0 = await snap();
  await twoFingerDrag((i) => [
    { x: 700 + i * 10, y: 500, id: 1 },
    { x: 900 + i * 10, y: 500, id: 2 },
  ]);
  const aMid = await snap(); // sampled while the fingers are still down
  await endTouch();
  const aPass = dAng(a0.az, aMid.az) > 5 && Math.abs(aMid.el - a0.el) < 0.5 && aMid.action === "rotate";
  console.log(
    `A swipe LR: az ${a0.az} -> ${aMid.az}, el held ${Math.abs(aMid.el - a0.el) < 0.5}, action "${aMid.action}" (want rotate) => ${aPass ? "PASS" : "FAIL"}`,
  );

  // B) Swipe up-down: tilt, and the ACTIVE action is "tilt" (Tilt row only).
  const b0 = await snap();
  await twoFingerDrag((i) => [
    { x: 700, y: 500 + i * 8, id: 1 },
    { x: 900, y: 500 + i * 8, id: 2 },
  ]);
  const bMid = await snap();
  await endTouch();
  const bPass = Math.abs(bMid.el - b0.el) > 3 && dAng(b0.az, bMid.az) < 0.5 && bMid.action === "tilt";
  console.log(
    `B swipe UD: el ${b0.el} -> ${bMid.el}, az held ${dAng(b0.az, bMid.az) < 0.5}, action "${bMid.action}" (want tilt) => ${bPass ? "PASS" : "FAIL"}`,
  );

  // C) Twist about the midpoint: nothing latches, so the camera must not move.
  const c0 = await snap();
  const cx = 800;
  const cy = 500;
  const R = 110;
  await twoFingerDrag((i) => {
    const a = (i * 5 * Math.PI) / 180; // 60° of twist over 12 steps
    return [
      { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), id: 1 },
      { x: cx - R * Math.cos(a), y: cy - R * Math.sin(a), id: 2 },
    ];
  });
  const cMid = await snap();
  await endTouch();
  const cPass =
    dAng(c0.az, cMid.az) < 0.5 && Math.abs(cMid.el - c0.el) < 0.5 && Math.abs(cMid.r - c0.r) < 1;
  console.log(
    `C twist 60deg: az ${c0.az} -> ${cMid.az}, el ${c0.el} -> ${cMid.el}, radius ${c0.r} -> ${cMid.r} (all held) => ${cPass ? "PASS" : "FAIL"}`,
  );

  // D) Pinch still zooms (the twist removal must not touch it).
  const d0 = await snap();
  await twoFingerDrag((i) => [
    { x: 750 - i * 10, y: 500, id: 1 },
    { x: 850 + i * 10, y: 500, id: 2 },
  ]);
  const dMid = await snap();
  await endTouch();
  const dPass = dMid.r < d0.r && dMid.action === "zoom";
  console.log(
    `D pinch out: radius ${d0.r} -> ${dMid.r}, action "${dMid.action}" => ${dPass ? "PASS" : "FAIL"}`,
  );
} finally {
  proc.kill();
}
