/** Card scroll structure (2026-07-27): only the HEADER may be fixed — the summary
 * details and the district list have to live inside the scrolling body, so a road
 * crossing many districts still leaves room for its own content on a short screen. */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
const PORT = 9497;
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
    "--window-size=900,620", // deliberately SHORT: the case that ran out of room
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

  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState(); s.setDirectoryOpen(true);
       s.resetColumns([{ kind: "street", id: "highway-0" }]); })()`,
  );
  await sleep(8000); // persona directory cold build

  const report = await evalJs(
    ws,
    `(() => {
      const vp = [...document.querySelectorAll('[data-slot="scroll-area-viewport"]')]
        .find((v) => /Crossings/.test(v.innerText ?? ""));
      if (!vp) return { error: "no card viewport" };
      const has = (t) => [...vp.querySelectorAll("*")].some((n) => n.textContent?.trim() === t);
      const title = [...document.querySelectorAll("*")].find(
        (n) => n.children.length === 0 && n.textContent?.trim() === "Highway 9");
      const titleInside = title ? vp.contains(title) : null;
      const before = vp.scrollTop;
      vp.scrollTop = 400;
      const moved = vp.scrollTop;
      vp.scrollTop = before;
      return {
        scrollable: vp.scrollHeight > vp.clientHeight + 4,
        scrollHeight: vp.scrollHeight,
        clientHeight: vp.clientHeight,
        scrolledTo: moved,
        statsInside: has("Length"),
        districtsInside: has("Districts"),
        crossingsInside: has("Crossings"),
        titleInsideViewport: titleInside,
      };
    })()`,
  );
  console.log("card scroll:", JSON.stringify(report, null, 1));
  await shot(ws, "card-top");

  // Scrolled down: the stats/districts must move away, proving they're in the body.
  await evalJs(
    ws,
    `(() => { const vp = [...document.querySelectorAll('[data-slot="scroll-area-viewport"]')]
       .find((v) => /Crossings/.test(v.innerText ?? "")); if (vp) vp.scrollTop = 260; })()`,
  );
  await sleep(400);
  await shot(ws, "card-scrolled");
  // Multi-column layouts: the pinned block now lives INSIDE each column's capped
  // scroll box, so check the side and deck views still read (deck slivers cap at
  // 11rem with a fade mask).
  for (const view of ["side", "deck"] as const) {
    await evalJs(
      ws,
      `(() => { const s = (window).__sceneStore.getState();
         s.setColumnsView(${JSON.stringify(view)});
         s.resetColumns([{ kind: "street", id: "highway-0" }, { kind: "street", id: "art-min-11" }]); })()`,
    );
    await sleep(2000);
    await shot(ws, `cols-${view}`);

    // Hover the LOWER card: a "Return to Card" tooltip must appear (it names the
    // jump-back the card already does on click). Dispatch real mouse events at the
    // sliver's visible left edge so base-ui's hover logic runs.
    const at = (await evalJs(
      ws,
      `(() => { const cards = [...document.querySelectorAll('[data-entity-card]')];
         if (cards.length < 2) return null;
         const r = cards[0].getBoundingClientRect();
         const deck = ${JSON.stringify(view)} === "deck";
         // deck: a ~3rem sliver of the card's LEFT edge peeks out. side: the cards
         // sit side by side, so aim right of the directory panel's overlap.
         const x = deck ? r.x + 12 : r.x + r.width - 24;
         return { x: Math.round(x), y: Math.round(r.y + 60), n: cards.length }; })()`,
    )) as { x: number; y: number; n: number } | null;
    if (!at) {
      console.log(`${view}: could not locate the lower card`);
      continue;
    }
    await call(ws, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: at.x,
      y: at.y,
      button: "none",
    });
    // No delay budget: the tooltip is configured delay={0}, so one frame is
    // enough. 120ms is generous and still proves it isn't waiting 300-400ms.
    await sleep(120);
    const tipAt1 = (await evalJs(
      ws,
      `(() => { const e = document.querySelector('[data-slot="tooltip-content"]');
         if (!e) return null; const r = e.getBoundingClientRect();
         return { text: e.textContent?.trim(), x: Math.round(r.x), y: Math.round(r.y) }; })()`,
    )) as { text: string; x: number; y: number } | null;
    // Move the cursor 60px along the card: a cursor-tracking tooltip follows.
    await call(ws, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      // Stay INSIDE the trigger: deck's sliver is ~3rem wide, and in side view
      // the card's right edge is where the top card begins, so move LEFT.
      x: at.x + (view === "deck" ? 8 : -60),
      y: at.y + 60,
      button: "none",
    });
    await sleep(200);
    const tipAt2 = (await evalJs(
      ws,
      `(() => { const e = document.querySelector('[data-slot="tooltip-content"]');
         if (!e) return null; const r = e.getBoundingClientRect();
         return { text: e.textContent?.trim(), x: Math.round(r.x), y: Math.round(r.y) }; })()`,
    )) as { text: string; x: number; y: number } | null;
    const followed =
      !!tipAt1 && !!tipAt2 && (tipAt1.x !== tipAt2.x || tipAt1.y !== tipAt2.y);
    // The hovered card also lifts its border. Compare the hovered card's computed
    // border colour against the TOP card's (same base class, never hovered).
    const borders = (await evalJs(
      ws,
      // No regex here on purpose: escapes like \\d don't survive a template
      // literal, and Chrome reports these colours as lab()/oklab() anyway. The
      // raw strings carry the alpha, and inequality is the real assertion.
      `(() => {
        const cards = [...document.querySelectorAll('[data-entity-card]')];
        const lower = cards[0], top = cards[cards.length - 1];
        if (!lower || !top) return null;
        return {
          hovered: getComputedStyle(lower).borderTopColor,
          base: getComputedStyle(top).borderTopColor,
        };
      })()`,
    )) as { hovered: string; base: string } | null;
    console.log(
      `${view} hover border: ${borders?.base} -> ${borders?.hovered} changed=${!!borders && borders.hovered !== borders.base}`,
    );
    console.log(
      `${view} hover lower card: immediate=${tipAt1 ? `"${tipAt1.text}" @120ms` : "MISSING"}, follows cursor=${followed} (${JSON.stringify(tipAt1)} -> ${JSON.stringify(tipAt2)})`,
    );
    await shot(ws, `tip-${view}`);
  }
  // Height: a long card should reach near the viewport bottom; a short one must NOT
  // stretch. Card = the outer w-72 box; compare its bottom to the window height.
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState(); s.setColumnsView("side");
       s.resetColumns([{ kind: "street", id: "highway-0" }]); })()`,
  );
  await sleep(2500);
  const heights = await evalJs(
    ws,
    `(() => {
      const cards = [...document.querySelectorAll('[data-entity-card]')];
      const card = cards[cards.length - 1]; // the TOP card is last in the row
      if (!card) return { error: "no card" };
      const r = card.getBoundingClientRect();
      const vp = card.querySelector('[data-slot="scroll-area-viewport"]');
      return {
        card: card.getAttribute("data-entity-card"),
        winH: window.innerHeight,
        cardTop: Math.round(r.top),
        cardBottom: Math.round(r.bottom),
        contentH: vp ? vp.scrollHeight : null,
        gapBelow: Math.round(window.innerHeight - r.bottom),
        bodyScrolls: vp ? vp.scrollHeight > vp.clientHeight + 4 : null,
      };
    })()`,
  );
  console.log("card @620:", JSON.stringify(heights));
  await shot(ws, "height-long");

  // Bluff Parkway (art-min-11) is a BUSY arterial - 26 buildings, 5 companies,
  // 80 listed residents - so its card content overruns any viewport and must grow
  // to the cap and scroll. Highway 9's card is the opposite case below: less
  // content than a tall display, so it must NOT stretch.
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState();
       s.resetColumns([{ kind: "street", id: "art-min-11" }]); })()`,
  );
  await sleep(2500);
  const shortCard = await evalJs(
    ws,
    `(() => {
      const cards = [...document.querySelectorAll('[data-entity-card]')];
      const card = cards[cards.length - 1]; // the TOP card is last in the row
      if (!card) return { error: "no card" };
      const r = card.getBoundingClientRect();
      const vp = card.querySelector('[data-slot="scroll-area-viewport"]');
      return {
        height: Math.round(r.height),
        gapBelow: Math.round(window.innerHeight - r.bottom),
        bodyScrolls: vp ? vp.scrollHeight > vp.clientHeight + 4 : null,
      };
    })()`,
  );
  console.log("busy card @620:", JSON.stringify(shortCard));
  await shot(ws, "height-busy");

  // Decisive check for "a short card must not stretch": on a TALL viewport the cap
  // is ~900px, so a small card has to stay near its content height while the long
  // one grows into the new room.
  await call(ws, "Emulation.setDeviceMetricsOverride", {
    width: 900,
    height: 1040,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(1200);
  const measure = (label: string) =>
    evalJs(
      ws,
      `(() => {
        const cards = [...document.querySelectorAll('[data-entity-card]')];
        const card = cards[cards.length - 1];
        if (!card) return { error: "no card" };
        const r = card.getBoundingClientRect();
        const vp = card.querySelector('[data-slot="scroll-area-viewport"]');
        return {
          card: card.getAttribute("data-entity-card"),
          winH: window.innerHeight,
          height: Math.round(r.height),
          contentH: vp ? vp.scrollHeight : null,
          gapBelow: Math.round(window.innerHeight - r.bottom),
          bodyScrolls: vp ? vp.scrollHeight > vp.clientHeight + 4 : null,
        };
      })()`,
    ).then((v) => console.log(`${label}:`, JSON.stringify(v)));
  await measure("busy card @1040");
  await shot(ws, "height-busy-tall");
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState();
       s.resetColumns([{ kind: "street", id: "highway-0" }]); })()`,
  );
  await sleep(2000);
  await measure("light card @1040 (must not stretch)");
  await shot(ws, "height-light-tall");

  // The seed chip must stay visible under a full-height card (user 2026-07-27).
  // Directory CLOSED is the tight case: the dock's left edge is 12px, the same as
  // the bottom-left HUD stack, so the column sits directly over it.
  await evalJs(
    ws,
    `(() => { const s = (window).__sceneStore.getState(); s.setDirectoryOpen(false);
       s.resetColumns([{ kind: "street", id: "art-min-11" }]); })()`,
  );
  await sleep(2500);
  const overlap = await evalJs(
    ws,
    `(() => {
      const cards = [...document.querySelectorAll('[data-entity-card]')];
      const card = cards[cards.length - 1];
      const seedText = [...document.querySelectorAll('*')].find(
        (n) => n.children.length === 0 && n.textContent?.trim() === "seed");
      const seed = seedText ? seedText.closest('div') : null;
      if (!card || !seed) return { error: !card ? "no card" : "no seed chip" };
      const c = card.getBoundingClientRect();
      const sr = seed.getBoundingClientRect();
      return {
        winH: window.innerHeight,
        cardLeft: Math.round(c.left), cardBottom: Math.round(c.bottom),
        seedTop: Math.round(sr.top), seedLeft: Math.round(sr.left),
        seedH: Math.round(sr.height), seedGapFromBottom: Math.round(window.innerHeight - sr.bottom),
        horizontallyOverlaps: c.left < sr.right && sr.left < c.right,
        coversSeed: c.bottom > sr.top && c.left < sr.right && sr.left < c.right,
      };
    })()`,
  );
  console.log("seed clearance (card):", JSON.stringify(overlap));
  await shot(ws, "seed-clearance");

  // The DIRECTORY must respect the same lower bound (user 2026-07-27).
  await evalJs(ws, `(window).__sceneStore.getState().setDirectoryOpen(true)`);
  await sleep(2500);
  const dirClear = await evalJs(
    ws,
    `(() => {
      const dir = [...document.querySelectorAll('div')].find(
        (d) => /City Directory/.test(d.innerText ?? "") && String(d.className ?? "").includes('fixed'));
      const seedText = [...document.querySelectorAll('*')].find(
        (n) => n.children.length === 0 && n.textContent?.trim() === "seed");
      const seed = seedText ? seedText.closest('div') : null;
      if (!dir || !seed) return { error: !dir ? "no directory" : "no seed chip" };
      const d = dir.getBoundingClientRect();
      const sr = seed.getBoundingClientRect();
      return {
        winH: window.innerHeight,
        dirBottom: Math.round(d.bottom),
        seedTop: Math.round(sr.top),
        coversSeed: d.bottom > sr.top && d.left < sr.right && sr.left < d.right,
      };
    })()`,
  );
  console.log("seed clearance (directory):", JSON.stringify(dirClear));
  await shot(ws, "seed-clearance-directory");
} finally {
  proc.kill();
}
