/**
 * Acceptance gate for #84 — the ortho/persp framing bridge (ProjectionBlender.tsx) must
 * hold the apparent size of the framed subject (the focal plane, at distance
 * orbit.radius) constant while `projectionBlend` and `orbit.radius` move together, the
 * way a real persp<->ortho toggle drives them (tweenProjectionTo in
 * lib/scene/cameraView.ts tweens both at once; top-down's remembered radius vs. its
 * K-matched anchor is the ~1.6x real-world gap reproduced below). Drives
 * window.__sceneStore directly (?capture=1) rather than gsap, so every step is sampled
 * at a precise, held `t` — and reads back the frustum half-height baked into the LIVE
 * projectionMatrix via window.__projectionDebug (ProjectionBlender, capture mode only):
 * a black-box measurement of the rendered frustum, not a re-derivation of the
 * framing-bridge math, so a regression in the fix (e.g. reverting the restPerspK freeze)
 * actually fails this.
 *
 *   bun scripts/verifyProjectionSizeInvariance.ts
 *
 * Requires the dev server on :7827 (bun dev). Uses cdpShot's raw-CDP transport, not
 * Playwright's chromium.launch()/connectOverCDP() — both hang on this box (see
 * ~/.claude/memory/tools/playwright-windows-launch-hang.md and scripts/cdpShot.ts).
 *
 * Method: for a view-space point at depth z = -orbit.radius (the LIVE radius at that
 * step — NOT a fixed depth: perspK/Hb are defined at the FOCAL PLANE, which sits at
 * distance `d` = orbit.radius from the camera, and d is exactly what's moving during
 * this sweep, so a fixed probe depth measures a moving target and reports spurious
 * drift even when the fix is working — verified against a live run before settling on
 * this), the NDC-y a projection matrix maps it to is LINEAR in the point's height y for
 * any of the three matrix shapes this file ever installs (pure perspective, the blended
 * virtual-eye matrix, and pure orthographic — each has a w-clip that depends only on z,
 * not y, since row 4 of a perspective matrix is canonically (0,0,-1,0) and translating
 * that row by -dz just shifts its constant term). Solving NDC-y(Hb) = 1 (the top edge)
 * for that point's height Hb — from `m = projectionMatrix.elements` (column-major) —
 * gives the focal-plane half-height with no dependence on which branch produced the
 * matrix:
 *   clipW = m[11]*z + m[15]
 *   c0    = (m[9]*z + m[13]) / clipW      // NDC-y at y=0
 *   slope = m[5] / clipW                   // d(NDC-y)/dy
 *   Hb    = (1 - c0) / slope
 */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9335;
const W = 1600;
const H = 900; // landscape (aspect > 1) so orbitFramingFactor === 1 — keeps the oracle formula f-free
const URL_ = process.env.CAPTURE_URL ?? "http://localhost:7827/?capture=1&intro=instant";
const BOOT_SETTLE_MS = Number(process.env.PSI_BOOT_SETTLE ?? 3500);
const STEP_SETTLE_MS = Number(process.env.PSI_STEP_SETTLE ?? 150);

const FOV_DEG = 50;
const R0 = 3000; // anchor radius — K-matched to orthoSize below
const RATIO = 1.6; // R1/R0 — the real remembered-radius gap (cameraView.ts's rememberedRadius)
const R1 = R0 * RATIO;
const TOLERANCE_PCT = 2; // #84's acceptance bound

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
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) if (p && existsSync(p)) return p;
  throw new Error("no chromium/edge/chrome binary found");
}

type Json = Record<string, unknown>;

async function httpJson(path: string, method = "GET"): Promise<Json> {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
      if (r.ok) return (await r.json()) as Json;
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`CDP endpoint ${path} never responded`);
}

function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  const open = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws open timeout")), 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error("ws error"));
    });
  });
  ws.addEventListener("message", (ev: MessageEvent) => {
    const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Json; error?: Json };
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result ?? {});
    }
  });
  const send = (method: string, params: Json = {}) =>
    new Promise<Json>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { open, send, close: () => ws.close() };
}

type Sample = { dir: "asc" | "desc"; t: number; hb: number; pct: number; pass: boolean };

async function main() {
  const exe = findBrowser();
  console.log("browser:", exe);
  const userDataDir = mkdtempSync(join(tmpdir(), "psi-"));
  const proc: ChildProcess = spawn(
    exe,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--mute-audio",
      "--hide-scrollbars",
      "--enable-unsafe-swiftshader",
      `--window-size=${W},${H}`,
    ],
    { stdio: "ignore" },
  );

  let code = 1;
  try {
    await httpJson("/json/version");
    const tab = await httpJson(`/json/new?${encodeURIComponent(URL_)}`, "PUT");
    const client = cdp(tab.webSocketDebuggerUrl as string);
    await client.open;
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: W,
      height: H,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const evalJson = async (expr: string): Promise<unknown> => {
      const r = (await client.send("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
      })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result?.value;
    };
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

    await sleep(BOOT_SETTLE_MS);

    // Rest in pure perspective at the K-matched anchor: orthoSize = R0*tan(fov/2) so the
    // perspective and ortho ends already agree at blend 0 — this is what makes restPerspK's
    // freeze (the #84 fix) equivalent to "size stays put" rather than merely "size stops
    // drifting from a still-wrong baseline".
    const fovRad = (FOV_DEG * Math.PI) / 180;
    const orthoSizeK = R0 * Math.tan(fovRad / 2);
    const setupExpr = `
      (() => {
        const st = window.__sceneStore.getState();
        st.setProjection("perspective");
        st.setCameraIntent({ fov: ${FOV_DEG} });
        st.setOrbit({ radius: ${R0} });
        st.setOrthoSize(${orthoSizeK});
        st.setProjectionBlend(0);
        return "ready";
      })()`;
    const ready = await evalJson(setupExpr);
    if (ready !== "ready") throw new Error(`setup did not report ready: ${JSON.stringify(ready)}`);
    await sleep(STEP_SETTLE_MS * 4); // extra beat — let restPerspK actually get captured at rest

    // probeRadius = the depth to measure at — the LIVE orbit.radius for that step (see the
    // module doc: probing a fixed depth measures a moving target).
    const readHb = async (probeRadius: number): Promise<number | null> => {
      const expr = `
        (() => {
          const dbg = window.__projectionDebug;
          const cam = dbg && dbg.camera;
          if (!cam) return null;
          const m = cam.projectionMatrix.elements;
          const z = -(${probeRadius});
          const clipW = m[11] * z + m[15];
          const c0 = (m[9] * z + m[13]) / clipW;
          const slope = m[5] / clipW;
          return (1 - c0) / slope;
        })()`;
      return (await evalJson(expr)) as number | null;
    };
    const radiusAt = (t: number) => R0 + (R1 - R0) * t;
    const driveStep = async (t: number) => {
      const expr = `
        (() => {
          const st = window.__sceneStore.getState();
          st.setProjectionBlend(${t});
          st.setOrbit({ radius: ${radiusAt(t)} });
          return "ok";
        })()`;
      await evalJson(expr);
      await sleep(STEP_SETTLE_MS);
    };

    const anchor = await readHb(R0);
    if (anchor == null) {
      throw new Error(
        "window.__projectionDebug.camera unavailable — is ProjectionBlender's capture-mode debug hook wired up?",
      );
    }
    console.log(`anchor Hb (t=0): ${anchor.toFixed(3)}  (K-matched target: ${orthoSizeK.toFixed(3)})`);

    const STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const samples: Sample[] = [];

    for (const t of STEPS) {
      await driveStep(t);
      const hb = await readHb(radiusAt(t));
      if (hb == null) throw new Error(`ascending t=${t}: __projectionDebug disappeared`);
      const pct = (Math.abs(hb - anchor) / anchor) * 100;
      samples.push({ dir: "asc", t, hb, pct, pass: pct <= TOLERANCE_PCT });
    }
    for (const t of [...STEPS].reverse().slice(1).concat(0)) {
      await driveStep(t);
      const hb = await readHb(radiusAt(t));
      if (hb == null) throw new Error(`descending t=${t}: __projectionDebug disappeared`);
      const pct = (Math.abs(hb - anchor) / anchor) * 100;
      samples.push({ dir: "desc", t, hb, pct, pass: pct <= TOLERANCE_PCT });
    }

    console.log(
      "\ndir   t     Hb          dev%    result",
    );
    let fail = 0;
    for (const s of samples) {
      if (!s.pass) fail++;
      console.log(
        `${s.dir.padEnd(5)} ${s.t.toFixed(1).padEnd(5)} ${s.hb.toFixed(3).padEnd(11)} ${s.pct.toFixed(2).padEnd(7)} ${s.pass ? "PASS" : "FAIL"}`,
      );
    }
    const worst = samples.reduce((a, b) => (b.pct > a.pct ? b : a));
    console.log(
      `\nworst deviation: ${worst.pct.toFixed(2)}% (${worst.dir} t=${worst.t}) — tolerance ${TOLERANCE_PCT}%`,
    );
    console.log(fail === 0 ? "PROJECTION-SIZE-INVARIANCE: PASS" : `PROJECTION-SIZE-INVARIANCE: FAIL (${fail})`);
    client.close();
    code = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error("FAILED:", (err as Error).message);
  } finally {
    proc.kill();
  }
  process.exit(code);
}

main();
