/** Moon disc A/B (2026-07-27): capture mode parks the camera deterministically, so
 * two runs differ ONLY by a shader edit. Crops the moon and hashes it, to prove the
 * mediump-safe Bayer rewrite leaves the desktop dither pattern untouched.
 * Usage: bun run scratch/moonShot.ts before|after */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const label = process.argv[2] ?? "shot";
const PORT = 9421;
// Moon high in the sky, framed left of centre at the reset pose.
const url = "http://localhost:7827/?capture=1&quality=high";
const OUT = process.env.TEMP + "\\moon-shots";
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
type CdpResult = { exceptionDetails?: unknown; result?: { value?: unknown }; data?: string };
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
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
    `--user-data-dir=${process.env.TEMP}\\moonshot-${PORT}-profile`,
    "--window-size=1200,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);
try {
  mkdirSync(OUT, { recursive: true });
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
  await sleep(11000);

  // Park the moon in frame and big enough to judge the terminator, with the phase
  // pinned (the auto phase follows the real date, which would drift between runs).
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState();
       s.setMoonFollowCamera(true); // debug: park the moon opposite the camera = in view
       s.setMoon({ elevationDeg: 9, radiusRatio: 0.08,
                   phaseAuto: false, phaseManual: 0.30 }); })()`,
  );
  await sleep(1500);
  const info = await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState();
       return { term: s.moon.terminatorStyle, sharp: s.moon.edgeSharpness,
                phaseAuto: s.moon.phaseAuto, dpr: window.devicePixelRatio,
                canvas: (() => { const c = document.querySelector("canvas");
                  return c ? [c.width, c.height] : null; })() }; })()`,
  );
  console.log("moon:", JSON.stringify(info));

  const shot = await call(ws, "Page.captureScreenshot", { format: "png" });
  const full = Buffer.from(String(shot.data), "base64");
  writeFileSync(`${OUT}\\moon-${label}.png`, full);
  console.log(`${OUT}\\moon-${label}.png`);
  // A/B crop: the TERMINATOR band only. The full frame is useless for hashing (window
  // flicker and star twinkle ride uTime), but the moon body shader takes no time input,
  // so this crop must come out byte-identical across a pure-refactor shader edit.
  const band = await call(ws, "Page.captureScreenshot", {
    format: "png",
    clip: { x: 500, y: 40, width: 180, height: 150, scale: 1 },
  });
  const crop = Buffer.from(String(band.data), "base64");
  writeFileSync(`${OUT}\\band-${label}.png`, crop);
  console.log(`${OUT}\\band-${label}.png  sha256=${createHash("sha256").update(crop).digest("hex")}`);
} finally {
  proc.kill();
}
