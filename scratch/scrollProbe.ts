/**
 * Live DOM probe for the directory scroll/Show More bug — raw CDP, same
 * transport pattern as scripts/cdpShot.ts (Playwright hangs on this box).
 *
 *   bun scrollProbe.ts "http://localhost:7833/?capture=1&intro=instant"
 */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = 9341;
const url = process.argv[2] ?? "http://localhost:7833/?capture=1&intro=instant";

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

let seq = 0;
function call(ws: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data));
      if (m.id === id) {
        ws.removeEventListener("message", onMsg);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(ws: WebSocket, expression: string): Promise<any> {
  const r = await call(ws, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result?.value;
}

const browser = findBrowser();
const proc: ChildProcess = spawn(browser, [
  `--remote-debugging-port=${PORT}`,
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--user-data-dir=" + process.env.TEMP + "\\scrollprobe-profile",
  "--window-size=1600,1000",
  "about:blank",
], { stdio: "ignore" });

try {
  await httpJson("/json/version");
  const targets = (await httpJson("/json/list")) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await call(ws, "Page.enable");
  await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 9000)); // boot + city gen

  // 1. Open the directory via its dock button (capture mode hides the UI, so
  //    this probe runs the NORMAL page and clicks like a user).
  const opened = await evalJs(ws, `
    (() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        (b.getAttribute("aria-label") ?? "").toLowerCase().includes("directory"));
      if (btn) btn.click();
      return btn ? (btn.getAttribute("aria-label") ?? "clicked") : "NO BUTTON";
    })()
  `);
  console.log("open directory:", opened);
  // 2. Wait for the directory build (masthead appears when built).
  for (let i = 0; i < 40; i++) {
    const built = await evalJs(ws, `!!document.querySelector('[data-slot="scroll-area-viewport"]')`);
    if (built) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // 3. Click the Companies tab (4th tab: All, Streets, Buildings, Companies, People).
  await evalJs(ws, `
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const t = tabs[3]; t && t.click(); tabs.length;
  `);
  await new Promise((r) => setTimeout(r, 1200));

  // 4. Measure the companies list scroll state.
  const probe = async () => evalJs(ws, `
    (() => {
      const vp = [...document.querySelectorAll('[data-slot="scroll-area-viewport"]')].at(-1);
      if (!vp) return { err: "no viewport" };
      const root = vp.closest('[data-slot="scroll-area"]');
      const rows = vp.querySelectorAll("button").length;
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Show More"));
      const card = root?.closest('[class*="max-h"]');
      vp.scrollTop = 400;
      const styles = getComputedStyle(vp);
      return {
        rows,
        vpClient: vp.clientHeight,
        vpScrollH: vp.scrollHeight,
        vpScrollTopAfterSet: vp.scrollTop,
        vpOverflowY: styles.overflowY,
        rootH: root?.getBoundingClientRect().height,
        rootBottom: Math.round(root?.getBoundingClientRect().bottom ?? -1),
        showMoreVisible: btn ? (btn.getBoundingClientRect().bottom <= innerHeight && btn.getBoundingClientRect().height > 0) : false,
        showMoreRect: btn ? JSON.parse(JSON.stringify(btn.getBoundingClientRect())) : null,
        showMoreText: btn?.textContent ?? null,
        winH: innerHeight,
      };
    })()
  `);
  console.log("BEFORE CLICK:", JSON.stringify(await probe(), null, 1));

  // 5. Click Show More, re-measure row count.
  await evalJs(ws, `
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Show More"));
    btn && btn.click(); !!btn;
  `);
  await new Promise((r) => setTimeout(r, 800));
  console.log("AFTER CLICK:", JSON.stringify(await probe(), null, 1));
} finally {
  proc.kill();
}
