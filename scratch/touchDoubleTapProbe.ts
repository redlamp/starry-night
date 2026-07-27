/** Touch double-taps (2026-07-27): 1-finger double-tap = PAN TO the tapped ground
 * point (focus moves, distance held); 2-finger double-tap = ZOOM IN on the midpoint. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9376;
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
                 r: +s.orbit.radius.toFixed(1), cx: +s.orbit.centerX.toFixed(1),
                 cz: +s.orbit.centerZ.toFixed(1), action: a.action }; })()`,
    ) as Promise<{
    az: number;
    el: number;
    r: number;
    cx: number;
    cz: number;
    action: string | null;
  }>;

  // Inspect mode owns the 1-finger double-tap (building focus), so the camera
  // gesture only runs with it off - mirror that for the test.
  await evalJs(ws, `(window).__sceneStore.getState().setInspectMode(false)`);
  await sleep(300);

  const tap1 = async (x: number, y: number) => {
    await touch("touchStart", [{ x, y, id: 1 }]);
    await sleep(40);
    await touch("touchEnd", []);
  };
  const tap2 = async (x: number, y: number, spread = 90) => {
    await touch("touchStart", [{ x: x - spread, y, id: 1 }]);
    await touch("touchStart", [
      { x: x - spread, y, id: 1 },
      { x: x + spread, y, id: 2 },
    ]);
    await sleep(40);
    await touch("touchEnd", [{ x: x + spread, y, id: 2 }]); // finger 1 lifts
    await touch("touchEnd", []); // finger 2 lifts
  };

  // A) 1-finger double-tap: PAN TO - the focus centre moves, the radius holds.
  const a0 = await snap();
  await tap1(1100, 620);
  await sleep(120);
  await tap1(1100, 620);
  await sleep(1600); // the moveTo tween
  const a1 = await snap();
  const moved = Math.hypot(a1.cx - a0.cx, a1.cz - a0.cz);
  const aPass = moved > 40 && Math.abs(a1.r - a0.r) / a0.r < 0.05 && a1.action === "panTo";
  console.log(
    `A 1-finger x2: focus moved ${moved.toFixed(0)}m (want >40), radius ${a0.r} -> ${a1.r} (held), action "${a1.action}" (want panTo) => ${aPass ? "PASS" : "FAIL"}`,
  );

  // B) A SINGLE 1-finger tap must do nothing (no accidental pan-to).
  const b0 = await snap();
  await tap1(700, 400);
  await sleep(900);
  const b1 = await snap();
  const bPass = Math.hypot(b1.cx - b0.cx, b1.cz - b0.cz) < 1;
  console.log(
    `B 1-finger x1: focus moved ${Math.hypot(b1.cx - b0.cx, b1.cz - b0.cz).toFixed(1)}m (want ~0) => ${bPass ? "PASS" : "FAIL"}`,
  );

  // C) 2-finger double-tap: ZOOM IN - radius drops, orientation holds.
  const c0 = await snap();
  await tap2(800, 500);
  await sleep(140);
  await tap2(800, 500);
  await sleep(1800); // the zoom glide
  const c1 = await snap();
  const dAng = (a: number, b: number) =>
    Math.abs(Math.atan2(Math.sin(((b - a) * Math.PI) / 180), Math.cos(((b - a) * Math.PI) / 180))) *
    (180 / Math.PI);
  const cPass = c1.r < c0.r * 0.9 && dAng(c0.az, c1.az) < 1 && Math.abs(c1.el - c0.el) < 1;
  console.log(
    `C 2-finger x2: radius ${c0.r} -> ${c1.r} (want smaller), az/el held ${dAng(c0.az, c1.az) < 1 && Math.abs(c1.el - c0.el) < 1}, action "${c1.action}" => ${cPass ? "PASS" : "FAIL"}`,
  );

  // D) A SINGLE 2-finger tap must do nothing.
  await sleep(900); // let C's glide fully settle before measuring
  const d0 = await snap();
  await tap2(800, 500);
  await sleep(1200);
  const d1 = await snap();
  const dPass =
    Math.abs(d1.r - d0.r) / d0.r < 0.01 && Math.hypot(d1.cx - d0.cx, d1.cz - d0.cz) < 2;
  console.log(
    `D 2-finger x1: radius ${d0.r} -> ${d1.r}, focus held => ${dPass ? "PASS" : "FAIL"}`,
  );

  // E) 2-finger double-tap ALSO works in inspect mode (no building-focus conflict).
  await evalJs(ws, `(window).__sceneStore.getState().setInspectMode(true)`);
  await sleep(300);
  const sel = () =>
    evalJs(
      ws,
      `(() => { const s = (window).__sceneStore.getState();
        return { b: s.selectedBuildingId, path: s.columnPath.length, cursor: s.columnCursor }; })()`,
    ) as Promise<{ b: number | null; path: number; cursor: number }>;
  const e0 = await snap();
  const es0 = await sel();
  await tap2(800, 500);
  await sleep(140);
  await tap2(800, 500);
  await sleep(400);
  const eAct = (await snap()).action;
  await sleep(1800);
  const e1 = await snap();
  const es1 = await sel();
  console.log(
    `E 2-finger x2 (inspect on): action "${eAct}" (want zoomIn) => ${eAct === "zoomIn" ? "PASS" : "FAIL"}`,
  );
  console.log(
    `  radius ${e0.r} -> ${e1.r}; selection ${JSON.stringify(es0)} -> ${JSON.stringify(es1)}`,
  );
  // F) REGRESSION: the multi-touch gate must not block a ONE-finger pick. Inspect
  // mode is still on from E; a single tap has to still select something.
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState(); s.closeColumns(); s.setSelectedBuildingId(null); })()`,
  );
  await sleep(600);
  await tap1(800, 620);
  await sleep(1200);
  const fs = await sel();
  console.log(
    `F 1-finger x1 (inspect on): selection ${JSON.stringify(fs)} => ${fs.b !== null || fs.path > 0 ? "PASS" : "FAIL"}`,
  );
} finally {
  proc.kill();
}
