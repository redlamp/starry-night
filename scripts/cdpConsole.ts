// Console/error capture for a page load — companion to scripts/cdpShot.ts.
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9334;
const url = process.argv[2] ?? "http://localhost:7911/?capture=1&intro=instant";
const WAIT = Number(process.env.CON_WAIT ?? 25000);

function findBrowser(): string {
  let pw = "";
  try { pw = chromium.executablePath(); } catch { pw = ""; }
  const candidates = [pw,
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe"];
  for (const p of candidates) if (p && existsSync(p)) return p;
  throw new Error("no browser");
}

async function httpJson(path: string, method = "GET"): Promise<Record<string, unknown>> {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method }); if (r.ok) return r.json(); } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("cdp never up");
}

const proc: ChildProcess = spawn(findBrowser(), [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdpcon-"))}`,
  "--no-first-run", "--mute-audio", "--enable-unsafe-swiftshader",
], { stdio: "ignore" });

try {
  await httpJson("/json/version");
  const tab = await httpJson("/json/new?about:blank", "PUT");
  const ws = new WebSocket(tab.webSocketDebuggerUrl as string);
  await new Promise<void>((res, rej) => { ws.addEventListener("open", () => res()); ws.addEventListener("error", () => rej(new Error("ws"))); });
  let id = 1;
  const send = (method: string, params: Record<string, unknown> = {}) => ws.send(JSON.stringify({ id: id++, method, params }));
  ws.addEventListener("message", (ev: MessageEvent) => {
    const m = JSON.parse(String(ev.data));
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      console.log("EXCEPTION:", d.text, d.exception?.description?.slice(0, 1500) ?? "");
    }
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      const args = m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description ?? "").join(" ");
      console.log(`CONSOLE.${m.params.type}:`, String(args).slice(0, 1500));
    }
  });
  send("Runtime.enable");
  send("Page.enable");
  send("Page.navigate", { url });
  await new Promise((res) => setTimeout(res, WAIT));
  console.log("-- resizing to 1600x1000 --");
  send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await new Promise((res) => setTimeout(res, 6000));
  console.log("done listening");
} finally {
  proc.kill();
}
process.exit(0);
