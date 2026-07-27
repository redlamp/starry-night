/** Touch flip (2026-07-26): 1-finger drag must PAN (focal moves, azimuth stable);
 * 2-finger midpoint drag must ROTATE (azimuth moves); pinch must zoom. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9363;
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
    "--user-data-dir=" + process.env.TEMP + "\\touchflip-profile",
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
        return { az: +c.liveAzimuthDeg.toFixed(1), el: +c.liveElevationDeg.toFixed(1),
                 cx: s.orbit.centerX, cz: s.orbit.centerZ, r: s.orbit.radius }; })()`,
    ) as Promise<{ az: number; el: number; cx: number; cz: number; r: number }>;

  // A) 1-finger drag: PAN — focal centre moves, azimuth holds.
  const a0 = await snap();
  await touch("touchStart", [{ x: 800, y: 500, id: 1 }]);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", [{ x: 800 - i * 12, y: 500 - i * 6, id: 1 }]);
    await sleep(16);
  }
  await touch("touchEnd", []);
  await sleep(400);
  const a1 = await snap();
  const panDist = Math.hypot(a1.cx - a0.cx, a1.cz - a0.cz);
  const azHeld = Math.abs(a1.az - a0.az) < 1;
  console.log(
    `A 1-finger: focal moved ${panDist.toFixed(0)}m (want >50), az ${a0.az} -> ${a1.az} (held: ${azHeld})  => ${panDist > 50 && azHeld ? "PASS" : "FAIL"}`,
  );

  const twoFingerDrag = async (mk: (i: number) => [Pt, Pt], steps = 10) => {
    await touch("touchStart", [mk(0)[0]]);
    await touch("touchStart", mk(0));
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", mk(i));
      await sleep(16);
    }
    await touch("touchEnd", []);
    await sleep(400);
  };
  const dAng = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(((b - a) * Math.PI) / 180), Math.cos(((b - a) * Math.PI) / 180))) * (180 / Math.PI);

  // B) Horizontal swipe: ORBIT — azimuth moves, elevation holds (latched: no tilt bleed).
  const b0 = await snap();
  await twoFingerDrag((i) => [
    { x: 700 + i * 10, y: 500, id: 1 },
    { x: 900 + i * 10, y: 500, id: 2 },
  ]);
  const b1 = await snap();
  const bPass = dAng(b0.az, b1.az) > 5 && Math.abs(b1.el - b0.el) < 0.5;
  console.log(
    `B swipe LR (orbit): az ${b0.az} -> ${b1.az}, el ${b0.el} -> ${b1.el} (az moves, el holds)  => ${bPass ? "PASS" : "FAIL"}`,
  );

  // C) Vertical swipe: TILT — elevation moves, azimuth holds.
  const c0 = await snap();
  await twoFingerDrag((i) => [
    { x: 700, y: 500 + i * 8, id: 1 },
    { x: 900, y: 500 + i * 8, id: 2 },
  ]);
  const c1 = await snap();
  const cPass = Math.abs(c1.el - c0.el) > 3 && dAng(c0.az, c1.az) < 0.5;
  console.log(
    `C swipe UD (tilt): el ${c0.el} -> ${c1.el}, az ${c0.az} -> ${c1.az} (el moves, az holds)  => ${cPass ? "PASS" : "FAIL"}`,
  );

  // D) Twist: ROTATE — azimuth moves; the city turns WITH the fingers (north bearing
  // follows the twist direction: clockwise twist -> bearing increases).
  const north0 = (await evalJs(
    ws,
    `+(window).__cameraCommand.liveNorthScreenDeg.toFixed(2)`,
  )) as number;
  const d0 = await snap();
  const cxm = 800;
  const cym = 500;
  const R = 110;
  await twoFingerDrag((i) => {
    const a = (i * 4 * Math.PI) / 180; // 4 deg per step, clockwise in screen coords
    return [
      { x: cxm + R * Math.cos(a), y: cym + R * Math.sin(a), id: 1 },
      { x: cxm - R * Math.cos(a), y: cym - R * Math.sin(a), id: 2 },
    ];
  }, 12);
  const d1 = await snap();
  const north1 = (await evalJs(
    ws,
    `+(window).__cameraCommand.liveNorthScreenDeg.toFixed(2)`,
  )) as number;
  const twistMoved = dAng(d0.az, d1.az) > 5;
  const northDelta = Math.atan2(
    Math.sin(((north1 - north0) * Math.PI) / 180),
    Math.cos(((north1 - north0) * Math.PI) / 180),
  ) * (180 / Math.PI);
  console.log(
    `D twist CW: az ${d0.az} -> ${d1.az} (moved: ${twistMoved}); north bearing ${north0} -> ${north1} (delta ${northDelta.toFixed(1)}, want positive = city turns with fingers)  => ${twistMoved && northDelta > 5 ? "PASS" : "FAIL"}`,
  );

  // E) Pinch out: ZOOM only — radius shrinks, az + el hold.
  const e0 = await snap();
  await twoFingerDrag((i) => [
    { x: 750 - i * 10, y: 500, id: 1 },
    { x: 850 + i * 10, y: 500, id: 2 },
  ]);
  const e1 = await snap();
  const ePass = e1.r < e0.r && dAng(e0.az, e1.az) < 0.5 && Math.abs(e1.el - e0.el) < 0.5;
  console.log(
    `E pinch out: radius ${e0.r} -> ${e1.r}, az/el held: ${dAng(e0.az, e1.az) < 0.5 && Math.abs(e1.el - e0.el) < 0.5}  => ${ePass ? "PASS" : "FAIL"}`,
  );
} finally {
  proc.kill();
}
