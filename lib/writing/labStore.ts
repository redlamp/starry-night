// Writing-lab persistence: per-entry overrides (edited text) and editorial
// metadata (authorship, status) in localStorage. The generation modules do
// NOT read this — content ships by exporting a pool and pasting it back into
// its source array, so the determinism contract never depends on browser
// state. Entry identity is (poolId, entryId): entryId is the stable id from
// lib/writing/contentIds.ts (contentRegistry.ts zips it in as each pool's
// entryIds), NOT the source array's index — an index shifts if anything above
// it is ever cut or inserted; an id survives an in-place text edit (that's
// the whole point — see contentIds.ts / scripts/genContentIds.ts).

import type { ContentPool } from "@/lib/writing/contentRegistry";
import { CONTENT_IDS } from "@/lib/writing/contentIds";

export type Authorship = "ai" | "human" | "edited";
export type ReviewStatus = "draft" | "review" | "final" | "cut";

export type EntryMeta = {
  text?: string; // override; undefined = source text unchanged
  author: Authorship;
  status: ReviewStatus;
  // True only for a "Duplicate"-created entry: it has no counterpart in the
  // source array at all (text is its ONLY text, not an override of one), and
  // the guarded exporter always blocks it (adding to an array is the same
  // determinism footgun a cut is). Absent/false for every ordinary,
  // source-backed entry.
  isAdded?: boolean;
  // Epoch ms, stamped by setEntryMeta — editorial bookkeeping for the writing
  // lab's own "date added / date modified" sort, NOT scene/generation state,
  // so Date.now() here doesn't touch the determinism contract (same
  // reasoning as lib/seed/rng.ts's randomSeedForReroll: UI-only, never read
  // by anything that draws a persona/city). createdAt is set once, the first
  // time an entry is ever touched; updatedAt refreshes on every change.
  createdAt?: number;
  updatedAt?: number;
};

export type LabState = Record<string, Record<string, EntryMeta>>; // poolId -> entryId -> meta

const KEY = "starry-night.writing-lab.v2";
// v1 was (poolId, index)-keyed — read once by the migration below, never
// written to again. Left in place untouched as a safety net, not deleted.
const V1_KEY = "starry-night.writing-lab.v1";

// Everything generated so far was model-written: ai + draft is the default.
export const DEFAULT_META: EntryMeta = { author: "ai", status: "draft" };

type LabStateV1 = Record<string, Record<number, EntryMeta>>;

// One-time (poolId, index) -> (poolId, entryId) re-key. contentIds.ts's ids
// are minted in array order the first time scripts/genContentIds.ts ever sees
// a pool (see that script's header), so CONTENT_IDS[poolId][index] is exactly
// the id a v1 override at that index means — for any pool/index the sidecar
// still recognises. A v1 index with no corresponding id today (pool shrank,
// was renamed, or no longer exists) is dropped rather than guessed at.
function migrateV1ToV2(v1: LabStateV1): LabState {
  const v2: LabState = {};
  for (const [poolId, byIndex] of Object.entries(v1)) {
    const ids = CONTENT_IDS[poolId];
    if (!ids) continue;
    const byId: Record<string, EntryMeta> = {};
    for (const [indexStr, meta] of Object.entries(byIndex)) {
      const entryId = ids[Number(indexStr)];
      if (entryId === undefined) continue;
      byId[entryId] = meta;
    }
    if (Object.keys(byId).length > 0) v2[poolId] = byId;
  }
  return v2;
}

export function loadLabState(): LabState {
  if (typeof window === "undefined") return {};
  try {
    const rawV2 = window.localStorage.getItem(KEY);
    if (rawV2) return JSON.parse(rawV2) as LabState;

    // No v2 yet in this browser: migrate v1 if present. One-time — once this
    // returns, the caller's next save writes KEY, so this branch never runs
    // again here.
    const rawV1 = window.localStorage.getItem(V1_KEY);
    if (rawV1) {
      const migrated = migrateV1ToV2(JSON.parse(rawV1) as LabStateV1);
      saveLabState(migrated);
      return migrated;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveLabState(state: LabState): void {
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function entryMeta(state: LabState, poolId: string, entryId: string): EntryMeta {
  return state[poolId]?.[entryId] ?? DEFAULT_META;
}

export function setEntryMeta(
  state: LabState,
  poolId: string,
  entryId: string,
  patch: Partial<EntryMeta>,
): LabState {
  const pool = { ...(state[poolId] ?? {}) };
  const prev = pool[entryId] ?? DEFAULT_META;
  const now = Date.now();
  pool[entryId] = { ...prev, ...patch, createdAt: prev.createdAt ?? now, updatedAt: now };
  return { ...state, [poolId]: pool };
}

// --- Added entries (Duplicate / Delete) ---------------------------------------
//
// "Duplicate" creates a new entry that exists ONLY in labState — it has no
// source-array position, so it's addressed purely by entryId (never an
// index). Ids are minted with a "~new-" ordinal segment that can't collide
// with a scripts/genContentIds.ts-committed id (those are always
// "~<plain ordinal>" or, for the trait pools, "~<dict key>" — neither shape
// contains "new-"), so an added entry can never be mistaken for (or clash
// with) a real source entry once genContentIds.ts next runs.
let addedIdCounter = 0;

function mintAddedEntryId(poolId: string): string {
  addedIdCounter += 1;
  // Date.now() + a session counter, not crypto.randomUUID(): this is local
  // editorial bookkeeping (never fed back into generation — see EntryMeta's
  // createdAt/updatedAt comment), so a simple collision-free id is enough.
  return `${poolId}~new-${Date.now().toString(36)}-${addedIdCounter.toString(36)}`;
}

// Creates a brand-new, source-less entry seeded with `text` (Duplicate passes
// the row it's copying; a from-scratch "Add" would pass ""). Always starts
// `draft`/`ai` — matching DEFAULT_META's own "nothing here has been reviewed
// yet" stance — but the caller can override author immediately after (e.g.
// Duplicate carries the original's author forward instead).
export function addEntry(
  state: LabState,
  poolId: string,
  text: string,
  author: Authorship = "ai",
): { state: LabState; entryId: string } {
  const entryId = mintAddedEntryId(poolId);
  const now = Date.now();
  const pool = { ...(state[poolId] ?? {}) };
  pool[entryId] = { text, author, status: "draft", isAdded: true, createdAt: now, updatedAt: now };
  return { state: { ...state, [poolId]: pool }, entryId };
}

// True removal — only ever valid for an added (isAdded) entry: it never
// shipped anywhere, so deleting its labState record is the whole story. A
// SOURCE entry can't be removed this way (it still exists in the array
// regardless of what labState says); "delete" on one of those means setting
// status to "cut" instead (setEntryMeta(..., { status: "cut" })), which the
// guarded exporter already knows how to keep out of a shipped array. Callers
// are expected to route the two cases through the right function — this one
// silently no-ops on a source entryId's meta rather than guessing.
export function deleteAddedEntry(state: LabState, poolId: string, entryId: string): LabState {
  const pool = state[poolId];
  if (!pool || !pool[entryId]?.isAdded) return state;
  const next = { ...pool };
  delete next[entryId];
  return { ...state, [poolId]: next };
}

// Every added entry currently on record for a pool, in insertion order
// (mintAddedEntryId's "~new-<time>-<counter>" ids sort lexicographically in
// creation order for ids minted in the same tool session, which is the only
// case that matters here — this is a display convenience, not a contract).
export function addedEntries(state: LabState, poolId: string): Array<{ entryId: string; meta: EntryMeta }> {
  const pool = state[poolId];
  if (!pool) return [];
  return Object.entries(pool)
    .filter(([, meta]) => meta.isAdded)
    .map(([entryId, meta]) => ({ entryId, meta }))
    .sort((a, b) => (a.meta.createdAt ?? 0) - (b.meta.createdAt ?? 0));
}

// --- Guarded export -----------------------------------------------------------
//
// lib/seed/personaStory.ts's fill() interpolates two families of slot token:
// FREE tokens are plain lookups against persona/context fields (no rng draw —
// editing how often they appear, or removing them, never touches the rng
// stream). RNG tokens each cost a determinism-relevant rng() draw when
// present in a template: {N} and the {kin}/{kinrole} pair are each computed
// ONCE per fill() call (a non-function replacer arg — occurrence count within
// one entry doesn't matter, only presence/absence does); each {lore:*} token
// is computed by a per-match replacer function, so occurrence count DOES
// matter there (two {lore:place} tokens draw twice). Rather than encode that
// count-vs-presence distinction per token, this treats ALL rng tokens as
// count-sensitive (a stricter, safe-by-construction simplification — at worst
// it blocks a handful of edits that fill() would've actually tolerated, never
// the reverse). {T}/{Tfirst} are story.relations-only (substituted before
// fill() runs, in personaStory.ts's weavePersonaRelation) and free; listed
// here too so they don't misread as an unknown-token typo in that one pool.
const FREE_TOKENS = new Set([
  "given",
  "family",
  "domain",
  "street",
  "district",
  "city",
  "paper",
  "transit",
  "biz",
  "his",
  "he",
  "T",
  "Tfirst",
]);
const RNG_TOKENS = new Set([
  "N",
  "kin",
  "kinrole",
  "lore:place",
  "lore:event",
  "lore:band",
  "lore:scandal",
  "lore:past",
]);
const ALL_KNOWN_TOKENS = new Set<string>([...FREE_TOKENS, ...RNG_TOKENS]);

const TOKEN_RE = /\{([a-zA-Z][a-zA-Z:]*)\}/g;

function tokenCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(TOKEN_RE)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

function unknownTokens(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    if (!ALL_KNOWN_TOKENS.has(m[1])) found.add(m[1]);
  }
  return [...found];
}

// The multiset of RNG-consuming tokens only — the "slot-token signature" an
// in-place text edit must preserve exactly for the edit to be safe.
// FREE tokens can be reworded, added, or removed at will; they never touch
// the rng stream.
function rngSignature(text: string): Map<string, number> {
  const sig = new Map<string, number>();
  for (const [tok, count] of tokenCounts(text)) {
    if (RNG_TOKENS.has(tok)) sig.set(tok, count);
  }
  return sig;
}

function signaturesEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [tok, count] of a) {
    if (b.get(tok) !== count) return false;
  }
  return true;
}

export type ExportBlockReason = "cut" | "added" | "unknown-token" | "signature-changed";

export type ExportBlockedEntry = {
  index: number | null; // null for an added entry — it has no source position
  entryId: string;
  reason: ExportBlockReason;
  detail: string;
};

export type PoolExportResult = {
  // TS array literal, always the same length and order as the pool's source
  // `entries` — safe to paste back over the source array unconditionally.
  // Blocked entries fall back to their original source text here; they still
  // exist (as pending changes) in labState, just not reflected in this
  // string.
  ts: string;
  blocked: ExportBlockedEntry[];
};

// Guarded replacement for the old exportPoolAsTs, which silently DROPPED
// "cut" entries — shortening the array shifts every index after the cut,
// which reshuffles what `pick()` (lib/seed/personaStory.ts,
// lib/seed/personas.ts) returns for every draw downstream of it. That's
// exactly the class of change this function exists to catch.
//
// Per entry: unedited (or edited back to the source text) → ships as-is.
// Cut → BLOCKED, ships the original text (cutting shortens the array; not
// safe without an explicit re-roll acknowledgment this tool doesn't offer
// yet — see the report/TODO on this). Unknown brace token in the edit →
// BLOCKED (most likely a typo against fill()'s slot grammar — see the token
// vocab above). Edit whose rng-token multiset differs from the source's →
// BLOCKED (would change which/how many rng() draws this line costs, and so
// every draw after it). Anything else → SAFE, ships the edited text.
//
// This can't represent (and so can't detect) a reorder, insert, or length
// change at the ARRAY level: it always emits exactly sourceEntries.length
// lines in sourceEntries' order, because labState only ever carries
// per-entry text/author/status against an existing entryId — there's no
// affordance in this tool yet to reorder or insert a whole new entry. If one
// is ever added, whatever produces the "new" array shape will need its own
// guard here; this function's per-entry checks alone won't cover it.
export function exportPoolGuarded(
  state: LabState,
  pool: Pick<ContentPool, "id" | "entries" | "entryIds">,
): PoolExportResult {
  const blocked: ExportBlockedEntry[] = [];

  const lines = pool.entries.map((sourceText, i) => {
    const entryId = pool.entryIds[i];
    const meta = entryMeta(state, pool.id, entryId);

    if (meta.status === "cut") {
      blocked.push({
        index: i,
        entryId,
        reason: "cut",
        detail:
          "Cutting shortens the array and re-rolls every draw after it — blocked until there's an explicit re-roll path. Ships unchanged.",
      });
      return sourceText;
    }

    const editedText = meta.text;
    if (editedText === undefined || editedText === sourceText) return sourceText;

    const unknown = unknownTokens(editedText);
    if (unknown.length > 0) {
      blocked.push({
        index: i,
        entryId,
        reason: "unknown-token",
        detail: `Unrecognised token${unknown.length > 1 ? "s" : ""} ${unknown
          .map((t) => `{${t}}`)
          .join(", ")} — check for a typo against fill()'s slot grammar. Ships unchanged.`,
      });
      return sourceText;
    }

    if (!signaturesEqual(rngSignature(sourceText), rngSignature(editedText))) {
      blocked.push({
        index: i,
        entryId,
        reason: "signature-changed",
        detail:
          "Edit changes which (or how many) random-draw tokens this line uses — that would shift every draw downstream of it. Ships unchanged.",
      });
      return sourceText;
    }

    return editedText;
  });

  // Duplicated/added entries never ship: appending to the array is the same
  // footgun a cut is (lib/seed/personaStory.ts's/personas.ts's pick() indexes
  // by array length, so every entry's array position is load-bearing for
  // every draw after it). Listed here purely so the UI can say what's
  // pending, same as a blocked cut or edit.
  for (const { entryId } of addedEntries(state, pool.id)) {
    blocked.push({
      index: null,
      entryId,
      reason: "added",
      detail:
        "New entries can't ship into the array yet (same reason a cut can't) — blocked until there's an explicit re-roll path.",
    });
  }

  const ts = `[\n${lines.map((t) => `  ${JSON.stringify(t)},`).join("\n")}\n]`;
  return { ts, blocked };
}

export function exportLabStateAsJson(state: LabState): string {
  return JSON.stringify(state, null, 2);
}

// --- Import ---------------------------------------------------------------------

// Parses a previously-exported metadata JSON file back into a LabState. Merge
// semantics live in mergeLabState below (kept separate so a caller can
// inspect what was parsed — e.g. count entries — before deciding to apply
// it). Returns null (never throws) on anything that isn't a plausible
// LabState, so the caller can show a friendly "that doesn't look like a
// writing-lab export" instead of an uncaught exception from an arbitrary
// uploaded file.
export function importLabStateFromJson(raw: string): LabState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  for (const pool of Object.values(parsed as Record<string, unknown>)) {
    if (!pool || typeof pool !== "object" || Array.isArray(pool)) return null;
  }
  return parsed as LabState;
}

// Merge, not replace: an imported entry wins its (poolId, entryId) slot on
// conflict, but anything present locally and absent from the import survives
// — importing an older or partial export can't silently erase today's edits.
// A caller that wants a hard replace can pass {} as `base`.
export function mergeLabState(base: LabState, incoming: LabState): LabState {
  const merged: LabState = { ...base };
  for (const [poolId, entries] of Object.entries(incoming)) {
    merged[poolId] = { ...(merged[poolId] ?? {}), ...entries };
  }
  return merged;
}

// Parses the TS array literal exportPoolGuarded's `ts` field emits (or
// anything shaped like it): a JSON array of strings, tolerant of the one
// trailing comma our own output always has (plain JSON.parse rejects that).
// Returns null on anything else, same non-throwing contract as the JSON
// importer above.
function parseTsStringArray(raw: string): string[] | null {
  const withoutTrailingComma = raw.trim().replace(/,(\s*])/, "$1");
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutTrailingComma);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) return null;
  return parsed;
}

// The reverse of exportPoolGuarded: diffs an imported array positionally
// against the pool's CURRENT source entries and applies each differing line
// as a text override. Only ever sets text overrides — never touches
// author/status, never changes the array's length. Extra imported lines past
// the source length (or a shorter import) are ignored beyond
// min(sourceEntries.length, imported.length): this can't add or cut entries
// on import any more than exportPoolGuarded can ship them (see that
// function's note) — an import that would need to is reported via
// `truncated`, not silently acted on.
export function importPoolFromTs(
  state: LabState,
  pool: Pick<ContentPool, "id" | "entries" | "entryIds">,
  raw: string,
): { state: LabState; changed: number; truncated: boolean } | null {
  const imported = parseTsStringArray(raw);
  if (!imported) return null;

  let next = state;
  let changed = 0;
  const n = Math.min(imported.length, pool.entries.length);
  for (let i = 0; i < n; i++) {
    if (imported[i] === pool.entries[i]) continue;
    const entryId = pool.entryIds[i];
    const prevMeta = entryMeta(next, pool.id, entryId);
    next = setEntryMeta(next, pool.id, entryId, {
      text: imported[i],
      author: prevMeta.author === "ai" ? "edited" : prevMeta.author,
    });
    changed++;
  }
  return { state: next, changed, truncated: imported.length !== pool.entries.length };
}
