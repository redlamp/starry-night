/** 2026-07-25 review round probe: skyline band at the real default pose, latch clear on R,
 * compass bearing stability at low elevations, ortho-entry level clamp, low-angle pan speed
 * cap, and the scene→directory district reverse hover. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
const PORT = 9353;
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
    "--user-data-dir=" + process.env.TEMP + "\\reviewprobe-profile",
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
        return { el: +c.liveElevationDeg.toFixed(3), sky: c.liveSkyline,
                 north: +c.liveNorthScreenDeg.toFixed(2), az: +c.liveAzimuthDeg.toFixed(2),
                 proj: s.projection, tgt: s.orbit ? [ +s.orbit.centerX?.toFixed?.(1) ] : null }; })()`,
    ) as Promise<{ el: number; sky: boolean; north: number; az: number; proj: string }>;
  const tilt = (deg: number) =>
    evalJs(ws, `(window).__cameraCommand.setTiltDeg(${deg}, false)`).then(() => sleep(350));
  const key = (k: string) =>
    evalJs(
      ws,
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, code: "Key${k.toUpperCase()}", bubbles: true }))`,
    );
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

  // ---- A. Rest state: default pose must be OUTSIDE the (dynamic) band.
  const a = await snap();
  console.log(
    `A rest: el=${a.el} sky=${a.sky} north=${a.north} proj=${a.proj}  => ${!a.sky ? "PASS" : "FAIL"} (standard at default)`,
  );

  // ---- B. Band + latch: enter well below, release above the dynamic exit, R clears.
  await tilt(0.2);
  const b1 = await snap();
  await tilt(1.2);
  const b2 = await snap();
  await tilt(0.3);
  const b3 = await snap();
  await key("r");
  await sleep(2600);
  const b4 = await snap();
  console.log(
    `B band: 0.2deg sky=${b1.sky} (want true) | 1.2deg sky=${b2.sky} (want false) | 0.3deg sky=${b3.sky} (want true) | after R el=${b4.el} sky=${b4.sky} (want false)  => ${b1.sky && !b2.sky && b3.sky && !b4.sky ? "PASS" : "FAIL"}`,
  );

  // ---- C. Compass bearing stability across elevations (azimuth fixed): the old
  // screen projection spun near-flat; the ground-plane bearing must hold steady.
  const els = [10, 5, 2, 1, 0.5, 0.2];
  const norths: number[] = [];
  for (const e of els) {
    await tilt(e);
    norths.push((await snap()).north);
  }
  const spread = Math.max(...norths) - Math.min(...norths);
  console.log(
    `C compass: north at el ${els.join("/")} = ${norths.join(", ")} spread=${spread.toFixed(2)}deg  => ${spread < 3 ? "PASS" : "FAIL"}`,
  );
  await evalJs(ws, `(window).__cameraCommand.rotateNorthUp()`);
  await sleep(1600);
  const cN = await snap();
  console.log(
    `C north-up: north=${cN.north} (want ~0)  => ${Math.abs(cN.north) < 2 ? "PASS" : "FAIL"}`,
  );

  // ---- D. Ortho entry from the (looking-up) default: level clamp.
  await key("r");
  await sleep(2600);
  const d0 = await snap();
  await key("p");
  await sleep(2800);
  const d1 = await snap();
  console.log(
    `D ortho entry: before el=${d0.el} -> after proj=${d1.proj} el=${d1.el} (want >= -0.05)  => ${d1.proj === "orthographic" && d1.el >= -0.05 ? "PASS" : "FAIL"}`,
  );
  await key("p");
  await sleep(2800);

  // ---- E. Pan speed cap at a low angle: a 120px vertical LMB drag must move the
  // focal by at most ~pixels x worldPerPx x 3.5 (+slack).
  await key("r");
  await sleep(2600);
  await tilt(2.5);
  const before = (await evalJs(
    ws,
    `(() => { const o = (window).__sceneStore.getState().orbit; return { x: o.centerX, z: o.centerZ, r: o.radius }; })()`,
  )) as { x: number; z: number; r: number };
  const cx = 800;
  const cy = 520;
  await mouse("mousePressed", cx, cy, { button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    await mouse("mouseMoved", cx, cy - i * 10, { button: "left", buttons: 1 });
    await sleep(16);
  }
  await mouse("mouseReleased", cx, cy - 120, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(500);
  const after = (await evalJs(
    ws,
    `(() => { const o = (window).__sceneStore.getState().orbit; return { x: o.centerX, z: o.centerZ, r: o.radius }; })()`,
  )) as { x: number; z: number; r: number };
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  const fov = (await evalJs(
    ws,
    `(window).__sceneStore.getState().cameraIntent.fov`,
  )) as number;
  const worldPerPx = (2 * before.r * Math.tan(((fov / 2) * Math.PI) / 180)) / 1000;
  const cap = 120 * worldPerPx * 3.5 * 1.25; // +25% slack (radius drifts during the drag)
  console.log(
    `E pan cap @2.5deg: moved=${moved.toFixed(0)}m cap~${cap.toFixed(0)}m (r=${before.r.toFixed(0)})  => ${moved <= cap ? "PASS" : "FAIL"}`,
  );

  // ---- F. Scene -> directory district reverse hover.
  await key("r");
  await sleep(2600);
  await tilt(35); // look down at the city — at the default (looking-up) pose a centre-screen ray hits SKY
  await evalJs(ws, `(window).__sceneStore.getState().setDirectoryOpen(true)`);
  await sleep(4000); // directory cold build
  const vis = await evalJs(
    ws,
    `(window).__sceneStore.getState().directoryDistrictsVisible`,
  );
  for (let i = 0; i < 6; i++) {
    await mouse("mouseMoved", 900 + i * 4, 560 + i * 3);
    await sleep(60);
  }
  await sleep(400);
  const hov = await evalJs(ws, `(window).__sceneStore.getState().hoverDistrictId`);
  await evalJs(ws, `(window).__sceneStore.getState().setDirectoryOpen(false)`);
  await sleep(300);
  const hov2 = await evalJs(ws, `(window).__sceneStore.getState().hoverDistrictId`);
  console.log(
    `F district hover: listVisible=${vis} hover=${hov} afterClose=${hov2}  => ${vis === true && typeof hov === "string" && hov2 === null ? "PASS" : "FAIL"}`,
  );
} finally {
  proc.kill();
}
