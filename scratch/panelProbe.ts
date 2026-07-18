/**
 * Live probe: directory glass + demographics panel expand/restore.
 * Same raw-CDP transport as scrollProbe.ts.
 *
 *   bun scratch/panelProbe.ts "http://localhost:7827/"
 */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = 9342;
const url = process.argv[2] ?? "http://localhost:7827/";

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

const proc: ChildProcess = spawn(
  findBrowser(),
  [
    `--remote-debugging-port=${PORT}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=" + process.env.TEMP + "\\panelprobe-profile",
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
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  await call(ws, "Page.enable");
  await call(ws, "Runtime.enable");
  await call(ws, "Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 9000));

  await evalJs(
    ws,
    `[...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").toLowerCase().includes("directory"))?.click(); "ok"`,
  );
  for (let i = 0; i < 40; i++) {
    const built = await evalJs(ws, `!!document.querySelector('[data-slot="scroll-area-viewport"]')`);
    if (built) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(
    "directory glass:",
    await evalJs(
      ws,
      `
    (() => {
      const card = document.querySelector(".bg-popover\\\\/70.fixed.top-16");
      if (!card) return "CARD NOT FOUND (glass class)";
      const cs = getComputedStyle(card);
      return { backdropFilter: cs.backdropFilter, background: cs.backgroundColor };
    })()
  `,
    ),
  );

  await evalJs(
    ws,
    `[...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Demographics"))?.click(); "ok"`,
  );
  await new Promise((r) => setTimeout(r, 2500));

  const panelState = () =>
    evalJs(
      ws,
      `
    (() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="Demographics"]');
      if (!dlg) return "NO PANEL";
      const r = dlg.getBoundingClientRect();
      const expand = [...dlg.querySelectorAll("button")].find((b) => ["Expand","Restore"].includes(b.getAttribute("aria-label") ?? ""));
      return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width), winH: innerHeight, btn: expand?.getAttribute("aria-label") ?? "NO BUTTON" };
    })()
  `,
    );
  console.log("panel initial:", await panelState());
  await evalJs(
    ws,
    `[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.getAttribute("aria-label") === "Expand")?.click(); "ok"`,
  );
  await new Promise((r) => setTimeout(r, 400));
  console.log("after expand:", await panelState());
  await evalJs(
    ws,
    `[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.getAttribute("aria-label") === "Restore")?.click(); "ok"`,
  );
  await new Promise((r) => setTimeout(r, 400));
  console.log("after restore:", await panelState());
} finally {
  proc.kill();
}
