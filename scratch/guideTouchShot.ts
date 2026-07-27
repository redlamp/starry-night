/** Controls guide, touch tab (2026-07-27): rows after the twist removal + the
 * double-tap remap. Opens the guide, switches to Touch, screenshots the sheet. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
const PORT = 9411;
const url = "http://localhost:7827/?probe=1";
const OUT = process.env.TEMP + "\\guide-touch-shots";
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
    `--user-data-dir=${process.env.TEMP}\\guide-${PORT}-profile`,
    "--window-size=1400,1000",
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
  await sleep(9000);

  // Open the guide ("?" button), then switch to the Touch tab.
  const opened = await evalJs(
    ws,
    `(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.getAttribute("aria-label") ?? "").toLowerCase().includes("control") ||
               b.textContent?.trim() === "?");
      if (!btn) return "NO BUTTON";
      btn.click();
      return btn.getAttribute("aria-label") ?? "?";
    })()`,
  );
  console.log("guide button:", opened);
  await sleep(700);
  const tab = await evalJs(
    ws,
    `(() => {
      const t = [...document.querySelectorAll("button")].find((b) => /^touch$/i.test(b.textContent?.trim() ?? ""));
      if (!t) return "NO TAB";
      t.click();
      return "clicked";
    })()`,
  );
  console.log("touch tab:", tab);
  await sleep(600);
  console.log(
    "--- rows ---\n" +
      (await evalJs(
        ws,
        `(() => {
          const sheets = [...document.querySelectorAll("div")].filter((d) => /Move/.test(d.innerText ?? "") && /Zoom/.test(d.innerText ?? "") && d.innerText.length < 700);
          const el = sheets[sheets.length - 1];
          return el ? el.innerText : "NO SHEET";
        })()`,
      )),
  );
  const r = await call(ws, "Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}\\guide-touch.png`, Buffer.from(String(r.data), "base64"));
  console.log(`${OUT}\\guide-touch.png`);
} finally {
  proc.kill();
}
