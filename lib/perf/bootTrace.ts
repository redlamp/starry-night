// Boot/runtime perf trace — a dependency-free singleton so we can measure the
// cold-load timeline (time-to-first-star, worker gen, city-first-frame) and the
// main-thread long tasks IN THE REAL BROWSER without headless tooling (Playwright
// hangs on this box). Read it from the ?perf overlay (components/ui/PerfOverlay)
// or `window.__bootTrace` in devtools.
//
// Measurement only — never an input to scene state (no determinism impact).

export type BootMark = { name: string; t: number };

type Stats = { dpr: number; longTasks: number; longTaskMs: number; lastGenMs: number; lastGenSource: string };

const t0 =
  typeof performance !== "undefined" ? performance.now() : 0; // module-eval ≈ first script execution
const marks: BootMark[] = [];
const seen = new Set<string>();
const live: Stats = { dpr: 0, longTasks: 0, longTaskMs: 0, lastGenMs: 0, lastGenSource: "" };
let longTaskInit = false;
let genT0: number | null = null;

// Per-CYCLE gen timing (every seed/shape/tier change), separate from the once-only
// boot timeline above — so switching seeds mid-session reports the new gen's real
// duration instead of a boot-relative timestamp.
export function genCycleStart(): void {
  if (typeof performance !== "undefined") genT0 = performance.now();
}
export function genCycleEnd(source: string): void {
  if (genT0 != null && typeof performance !== "undefined") {
    live.lastGenMs = performance.now() - genT0;
    live.lastGenSource = source;
    genT0 = null;
  }
}

// Record a boot milestone the FIRST time it fires (re-gen on seed change won't
// overwrite the cold-load timeline). Also emits a User Timing mark for devtools.
export function mark(name: string): void {
  if (typeof performance === "undefined" || seen.has(name)) return;
  seen.add(name);
  marks.push({ name, t: performance.now() - t0 });
  try {
    performance.mark(`boot:${name}`);
  } catch {
    /* User Timing unavailable — the timeline array is the source of truth */
  }
}

export function getTimeline(): BootMark[] {
  return marks.slice();
}

export function setDpr(dpr: number): void {
  live.dpr = dpr;
}

export function getStats(): Stats {
  return { ...live };
}

// PerformanceObserver for 'longtask' — the honest measure of a main-thread
// stall (e.g. the city-landing hitch). Init once, lazily, browser-only.
export function initLongTasks(): void {
  if (longTaskInit || typeof PerformanceObserver === "undefined") return;
  longTaskInit = true;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        live.longTasks++;
        live.longTaskMs += e.duration;
      }
    });
    obs.observe({ type: "longtask", buffered: true });
  } catch {
    /* longtask entry type unsupported (Safari/Firefox) — counters stay at 0 */
  }
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__bootTrace = { getTimeline, getStats };
}
