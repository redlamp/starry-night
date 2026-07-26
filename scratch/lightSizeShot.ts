/** #99 visual check: light sprites at several distances + projections, and any console
 * errors (a GLSL compile failure logs via three). */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
const PORT = 9361;
const url = "http://localhost:7827/?probe=1";
const OUT = process.env.TEMP + "\\light-shots";
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
const consoleErrors: string[] = [];
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
    "--user-data-dir=" + process.env.TEMP + "\\lightshot-profile",
    "--window-size=1600,1000",
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
  // Collect console errors/warnings (shader failures land here).
  ws.addEventListener("message", (ev: MessageEvent) => {
    const m = JSON.parse(String(ev.data));
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      consoleErrors.push(
        m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description ?? "").join(" ").slice(0, 300),
      );
    }
  });
  await call(ws, "Page.enable");
  await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await sleep(11000);
  const shot = async (name: string) => {
    const r = await call(ws, "Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}\\${name}.png`, Buffer.from(String(r.data), "base64"));
    console.log(`${OUT}\\${name}.png`);
  };
  const key = (k: string) =>
    evalJs(
      ws,
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, code: "Key${k.toUpperCase()}", bubbles: true }))`,
    );
  const wheel = (deltaY: number, n: number) =>
    (async () => {
      for (let i = 0; i < n; i++) {
        await call(ws, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: 800,
          y: 500,
          button: "none",
          buttons: 0,
          deltaX: 0,
          deltaY,
        });
        await sleep(50);
      }
      await sleep(1200);
    })();

  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(20, false)`); // lights-rich oblique view
  await sleep(600);
  await shot("1-persp-default");
  await wheel(-240, 14); // zoom in close
  await shot("2-persp-close");
  await wheel(240, 22); // far out
  await shot("3-persp-far");
  await key("r");
  await sleep(2600);
  await evalJs(ws, `(window).__cameraCommand.setTiltDeg(20, false)`);
  await sleep(400);
  await key("p"); // ortho
  await sleep(3000);
  await shot("4-ortho-default");
  await wheel(-240, 14);
  await shot("5-ortho-close");
  console.log("console errors/warnings:", consoleErrors.length === 0 ? "none" : "");
  for (const e of consoleErrors.slice(0, 10)) console.log("  !", e);
} finally {
  proc.kill();
}
