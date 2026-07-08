// Writing-lab persistence: per-entry overrides (edited text) and editorial
// metadata (authorship, status) in localStorage. The generation modules do
// NOT read this — content ships by exporting a pool and pasting it back into
// its source array, so the determinism contract never depends on browser
// state. Entry identity is (poolId, index) against the source array's order.

export type Authorship = "ai" | "human" | "edited";
export type ReviewStatus = "draft" | "review" | "final" | "cut";

export type EntryMeta = {
  text?: string; // override; undefined = source text unchanged
  author: Authorship;
  status: ReviewStatus;
};

export type LabState = Record<string, Record<number, EntryMeta>>;

const KEY = "starry-night.writing-lab.v1";

// Everything generated so far was model-written: ai + draft is the default.
export const DEFAULT_META: EntryMeta = { author: "ai", status: "draft" };

export function loadLabState(): LabState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as LabState;
  } catch {
    return {};
  }
}

export function saveLabState(state: LabState): void {
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function entryMeta(state: LabState, poolId: string, index: number): EntryMeta {
  return state[poolId]?.[index] ?? DEFAULT_META;
}

export function setEntryMeta(
  state: LabState,
  poolId: string,
  index: number,
  patch: Partial<EntryMeta>,
): LabState {
  const pool = { ...(state[poolId] ?? {}) };
  const prev = pool[index] ?? DEFAULT_META;
  pool[index] = { ...prev, ...patch };
  return { ...state, [poolId]: pool };
}

// The ship-it path: the pool's entries with overrides applied, as a TS array
// literal ready to paste over the source array (cut entries dropped).
export function exportPoolAsTs(
  state: LabState,
  poolId: string,
  sourceEntries: string[],
): string {
  const lines = sourceEntries
    .map((text, i) => ({ meta: entryMeta(state, poolId, i), text }))
    .filter(({ meta }) => meta.status !== "cut")
    .map(({ meta, text }) => `  ${JSON.stringify(meta.text ?? text)},`);
  return `[\n${lines.join("\n")}\n]`;
}

export function exportLabStateAsJson(state: LabState): string {
  return JSON.stringify(state, null, 2);
}
