/** Highway + street cards (2026-07-27): districts a highway runs through, the
 * crossings list, directory-style building rows, and hover -> city highlight. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
const PORT = 9371;
const url = "http://localhost:7827/?probe=1";
const OUT = process.env.TEMP + "\\street-card-shots";
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
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
    "--user-data-dir=" + process.env.TEMP + "\\streetcard-profile",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);
async function shot(ws: WebSocket, name: string, clip?: Record<string, number>) {
  const r = await call(ws, "Page.captureScreenshot", clip ? { format: "png", clip } : { format: "png" });
  writeFileSync(`${OUT}\\${name}.png`, Buffer.from(String(r.data), "base64"));
  console.log(`${OUT}\\${name}.png`);
}
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
  await sleep(10000);

  // Top-down-ish so the road polylines read on screen. District boundaries OFF
  // (the directory auto-enables them) — they'd drown out the road highlights.
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(70, false)`);
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState(); s.setDirectoryOpen(true);
       s.resetColumns([{ kind: "street", id: "highway-0" }]); })()`,
  );
  await sleep(8000); // persona directory cold build
  await evalJs(ws, `(window).__sceneStore.getState().setShowDistrictBoundaries(false)`);
  await sleep(800);

  const cardText = await evalJs(
    ws,
    `(() => { const el = document.querySelector('[data-slot="entity-columns"]') ??
        [...document.querySelectorAll("div")].find((d) => d.textContent?.includes("Crossings"));
      return el ? el.innerText.slice(0, 1200) : "NO CARD"; })()`,
  );
  console.log("--- card text ---\n" + cardText);
  await shot(ws, "highway-card");

  // Hover a crossing row: the road should draw white in the scene.
  const hovered = await evalJs(
    ws,
    `(() => {
      const rows = [...document.querySelectorAll("button")];
      const head = rows.find(() => false);
      void head;
      const target = [...document.querySelectorAll("button")].find((b) => /\\d\\.\\d\\d km$/.test(b.innerText.trim()));
      if (!target) return "NO ROW";
      const r = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return { label: target.innerText.replace(/\\n/g, " | "), x: Math.round(r.x), y: Math.round(r.y) };
    })()`,
  );
  console.log("hovered:", JSON.stringify(hovered));
  await sleep(600);
  console.log(
    "hoverRoadId:",
    await evalJs(ws, `(window).__sceneStore.getState().hoverRoadId`),
  );
  await shot(ws, "crossing-hover");

  // Open that crossing — its own street card carries the building list.
  await evalJs(
    ws,
    `(() => { const t = [...document.querySelectorAll("button")].find((b) => /Edwards Street/.test(b.innerText));
      if (t) t.click(); return !!t; })()`,
  );
  await sleep(3000);
  console.log(
    "--- street card ---\n" +
      (await evalJs(
        ws,
        `(() => { const cards = [...document.querySelectorAll("div")].filter((d) => /Local street|Arterial/.test(d.innerText ?? "") && d.innerText.length < 1400);
          const el = cards[cards.length - 1];
          return el ? el.innerText.slice(0, 900) : "NO CARD"; })()`,
      )),
  );
  await shot(ws, "street-card");

  // Hover a building row: white cage on that building.
  const bHover = await evalJs(
    ws,
    `(() => {
      const rows = [...document.querySelectorAll("button")].filter((b) => /^\\s*\\d+\\s+\\w/.test(b.innerText));
      const t = rows[Math.floor(rows.length / 2)];
      if (!t) return "NO ROW";
      t.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      t.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return t.innerText.replace(/\\n/g, " | ");
    })()`,
  );
  console.log("building row hovered:", JSON.stringify(bHover));
  await sleep(600);
  // Frame 816 Edwards Street (id 11931, a 2-floor house at (-674, 2131)) so the
  // hover cage is judgeable at building scale, then re-assert the hover (the
  // camera move doesn't touch it).
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState();
       s.setFocusRequest({ x: -674, y: 6, z: 2131, radius: 30, fit: "fill" }); })()`,
  );
  await sleep(3500);
  await evalJs(ws, `(window).__sceneStore.getState().setHoverBuildingId(11931)`);
  await sleep(500);
  console.log(
    "hoverBuildingId:",
    await evalJs(ws, `(window).__sceneStore.getState().hoverBuildingId`),
    "hoveredTenant:",
    JSON.stringify(await evalJs(ws, `(window).__sceneStore.getState().hoveredTenant`)),
  );
  await shot(ws, "building-hover");
} finally {
  proc.kill();
}
