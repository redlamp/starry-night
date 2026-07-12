import type { ContentPool } from "@/lib/writing/contentRegistry";
import {
  addedEntries,
  entryMeta,
  setEntryMeta,
  type Authorship,
  type EntryMeta,
  type LabState,
  type ReviewStatus,
} from "@/lib/writing/labStore";

// Pure helpers for the /writing-lab page. Kept out of labStore.ts (which is
// storage + merge primitives only) and out of the components (which stay
// focused on rendering) — filtering, stats, and the revert workaround below
// are UI-specific, not persistence primitives.

export const GROUP_ORDER = ["Story", "Names", "Places", "Businesses", "Traits"] as const;

export type StatusFilter = "all" | ReviewStatus;
export type AuthorFilter = "all" | Authorship;

export const STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "final", label: "Final" },
  { value: "cut", label: "Cut" },
];

export const AUTHOR_OPTIONS: { value: Authorship; label: string }[] = [
  { value: "ai", label: "AI" },
  { value: "human", label: "Human" },
  { value: "edited", label: "Edited" },
];

export const STATUS_LABEL: Record<ReviewStatus, string> = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ReviewStatus, string>;

export const AUTHOR_LABEL: Record<Authorship, string> = Object.fromEntries(
  AUTHOR_OPTIONS.map((o) => [o.value, o.label]),
) as Record<Authorship, string>;

// The brief's one explicit exception to token-only styling: status/author
// accent dots are hardcoded so they read at a glance in a dense table.
export const STATUS_DOT_CLASS: Record<ReviewStatus, string> = {
  draft: "bg-muted-foreground/50",
  review: "bg-blue-400 dark:bg-blue-300",
  final: "bg-green-400 dark:bg-green-300",
  cut: "bg-red-400 dark:bg-red-300",
};

export const AUTHOR_DOT_CLASS: Record<Authorship, string> = {
  ai: "bg-violet-400 dark:bg-violet-300",
  human: "bg-amber-400 dark:bg-amber-300",
  edited: "bg-teal-400 dark:bg-teal-300",
};

// Group pools by their `group` field, in the fixed tab order — any group not
// in GROUP_ORDER (shouldn't happen; registry is closed-world) still renders,
// appended at the end rather than silently dropped.
export function groupPools(pools: ContentPool[]): Array<readonly [string, ContentPool[]]> {
  const byGroup = new Map<string, ContentPool[]>();
  for (const pool of pools) {
    const list = byGroup.get(pool.group);
    if (list) list.push(pool);
    else byGroup.set(pool.group, [pool]);
  }
  const ordered: Array<readonly [string, ContentPool[]]> = [];
  for (const g of GROUP_ORDER) {
    const list = byGroup.get(g);
    if (list) {
      ordered.push([g, list] as const);
      byGroup.delete(g);
    }
  }
  for (const [g, list] of byGroup) ordered.push([g, list] as const);
  return ordered;
}

export function effectiveText(meta: EntryMeta, sourceText: string): string {
  return meta.text ?? sourceText;
}

// Sidebar tree shape: one node per group, with the Story group's ~17
// "Hooks · *" pools split out into a nested subsection so they don't flood
// the top-level list. Every other group's pools render flat.
export const HOOKS_PREFIX = "Hooks · ";
export const HOOKS_SUBGROUP_KEY = "Story::Hooks";

export type SidebarGroup = {
  group: string;
  pools: ContentPool[];
  hookPools: ContentPool[]; // non-empty only for "Story"
};

export function buildSidebarGroups(pools: ContentPool[]): SidebarGroup[] {
  return groupPools(pools).map(([group, list]) => {
    if (group !== "Story") return { group, pools: list, hookPools: [] };
    const hookPools = list.filter((p) => p.label.startsWith(HOOKS_PREFIX));
    const rest = list.filter((p) => !p.label.startsWith(HOOKS_PREFIX));
    return { group, pools: rest, hookPools };
  });
}

// Strip the "Hooks · " prefix once a pool is nested under the Hooks
// subsection header — the prefix is redundant there.
export function stripGroupPrefix(label: string): string {
  return label.startsWith(HOOKS_PREFIX) ? label.slice(HOOKS_PREFIX.length) : label;
}

export function aggregatePoolStats(
  pools: ContentPool[],
  stats: LabStats,
): { total: number; final: number } {
  let total = 0;
  let final = 0;
  for (const p of pools) {
    const s = stats.perPool[p.id];
    total += s.total;
    final += s.byStatus.final;
  }
  return { total, final };
}

function poolMatchesFilter(pool: ContentPool, filter: string): boolean {
  return pool.label.toLowerCase().includes(filter) || pool.id.toLowerCase().includes(filter);
}

export function filterSidebarPools(pools: ContentPool[], filter: string): ContentPool[] {
  if (!filter) return pools;
  return pools.filter((p) => poolMatchesFilter(p, filter));
}

function matchesFilters(
  meta: EntryMeta,
  statusFilter: StatusFilter,
  authorFilter: AuthorFilter,
): boolean {
  if (statusFilter !== "all" && meta.status !== statusFilter) return false;
  if (authorFilter !== "all" && meta.author !== authorFilter) return false;
  return true;
}

// One addressable table row: either source-backed (index/sourceText present
// — the array position matters, it's the entry's identity in the shipped
// pool) or locally-added via "Duplicate" (index/sourceText null — it has no
// array position, addressed purely by entryId; see labStore.ts's
// addEntry/addedEntries).
export type DisplayRow = {
  entryId: string;
  index: number | null;
  sourceText: string | null;
  meta: EntryMeta;
};

// A pool's full row set — every source entry, plus any locally-added
// ("Duplicate") entries appended after them in creation order — before
// filtering/sorting.
export function poolRows(pool: ContentPool, labState: LabState): DisplayRow[] {
  const rows: DisplayRow[] = [];
  for (let i = 0; i < pool.entries.length; i++) {
    const entryId = pool.entryIds[i];
    rows.push({ entryId, index: i, sourceText: pool.entries[i], meta: entryMeta(labState, pool.id, entryId) });
  }
  for (const { entryId, meta } of addedEntries(labState, pool.id)) {
    rows.push({ entryId, index: null, sourceText: null, meta });
  }
  return rows;
}

export type SortKey = "id" | "content" | "author" | "status" | "createdAt" | "updatedAt";
export type SortDir = "asc" | "desc";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "id", label: "Id" },
  { value: "content", label: "Content" },
  { value: "author", label: "Author" },
  { value: "status", label: "Status" },
  { value: "createdAt", label: "Date Added" },
  { value: "updatedAt", label: "Date Modified" },
];

const STATUS_SORT_ORDER: Record<ReviewStatus, number> = { draft: 0, review: 1, final: 2, cut: 3 };
const AUTHOR_SORT_ORDER: Record<Authorship, number> = { ai: 0, human: 1, edited: 2 };

function compareRows(a: DisplayRow, b: DisplayRow, key: SortKey): number {
  switch (key) {
    case "id":
      return a.entryId.localeCompare(b.entryId);
    case "content":
      return effectiveText(a.meta, a.sourceText ?? "").localeCompare(effectiveText(b.meta, b.sourceText ?? ""));
    case "author":
      return AUTHOR_SORT_ORDER[a.meta.author] - AUTHOR_SORT_ORDER[b.meta.author];
    case "status":
      return STATUS_SORT_ORDER[a.meta.status] - STATUS_SORT_ORDER[b.meta.status];
    // Untouched entries carry no timestamp (never written via setEntryMeta) —
    // they sort as "oldest" (0), which reads right for both keys: never-
    // touched is the oldest possible "date added", and (for "date modified")
    // it puts everything that's ever been edited above everything that
    // hasn't when sorting newest-first.
    case "createdAt":
      return (a.meta.createdAt ?? 0) - (b.meta.createdAt ?? 0);
    case "updatedAt":
      return (a.meta.updatedAt ?? 0) - (b.meta.updatedAt ?? 0);
  }
}

// Filters (status/author) + optional sort over a pool's full row set (source
// entries + any locally-added ones). Omitting `sort` keeps the default
// order: source order, then added entries in creation order.
export function visibleRows(
  pool: ContentPool,
  labState: LabState,
  statusFilter: StatusFilter,
  authorFilter: AuthorFilter,
  sort?: { key: SortKey; dir: SortDir },
): DisplayRow[] {
  const rows = poolRows(pool, labState).filter((r) => matchesFilters(r.meta, statusFilter, authorFilter));
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * compareRows(a, b, sort.key));
}

// Revert an override: clears `text` back to "unchanged" (reads as the source
// entry again via effectiveText's `meta.text ?? sourceText`).
//
// Verified against setEntryMeta's merge: `{ ...prev, ...patch }` with
// `patch = { text: undefined }` sets the property to `undefined` (not
// exactOptionalPropertyTypes, so this type-checks against `Partial<EntryMeta>`
// without a cast). Every read goes through `?? sourceText`, so an
// explicit-undefined `text` behaves identically to an absent one, and
// JSON.stringify drops undefined-valued keys, so exportLabStateAsJson stays
// clean. No labStore change needed — this is just the one call, named for the
// page's use sites.
export function revertEntry(state: LabState, poolId: string, entryId: string): LabState {
  return setEntryMeta(state, poolId, entryId, { text: undefined });
}

// Advance every filtered entry currently in `from` status to `to` (bulk
// actions respect the active filters — "Mark All Reviewed" only touches what's
// on screen). Takes entryIds directly — callers resolve indices to ids via
// pool.entryIds before calling (see WritingLab.tsx).
export function bulkAdvanceStatus(
  state: LabState,
  poolId: string,
  entryIds: string[],
  from: ReviewStatus,
  to: ReviewStatus,
): LabState {
  let next = state;
  for (const entryId of entryIds) {
    if (entryMeta(next, poolId, entryId).status === from) {
      next = setEntryMeta(next, poolId, entryId, { status: to });
    }
  }
  return next;
}

export type StatusCounts = Record<ReviewStatus, number>;
export type AuthorCounts = Record<Authorship, number>;

const emptyStatusCounts = (): StatusCounts => ({ draft: 0, review: 0, final: 0, cut: 0 });
const emptyAuthorCounts = (): AuthorCounts => ({ ai: 0, human: 0, edited: 0 });

export type PoolStats = { total: number; byStatus: StatusCounts };
export type LabStats = {
  total: number;
  byStatus: StatusCounts;
  byAuthor: AuthorCounts;
  perPool: Record<string, PoolStats>;
};

// One pass over every entry in every pool (source + locally-added — a few
// hundred to ~1000 total normally — cheap to recompute whenever labState
// changes rather than track deltas).
export function computeLabStats(pools: ContentPool[], labState: LabState): LabStats {
  const byStatus = emptyStatusCounts();
  const byAuthor = emptyAuthorCounts();
  const perPool: Record<string, PoolStats> = {};
  let total = 0;
  for (const pool of pools) {
    const poolByStatus = emptyStatusCounts();
    const rows = poolRows(pool, labState);
    for (const row of rows) {
      byStatus[row.meta.status]++;
      byAuthor[row.meta.author]++;
      poolByStatus[row.meta.status]++;
      total++;
    }
    perPool[pool.id] = { total: rows.length, byStatus: poolByStatus };
  }
  return { total, byStatus, byAuthor, perPool };
}

export type SearchHit = {
  poolId: string;
  poolLabel: string;
  index: number | null; // null for a locally-added ("Duplicate") entry
  entryId: string;
  text: string;
  status: ReviewStatus;
};

export type SearchResult = { hits: SearchHit[]; totalMatches: number };

// Global entry-text search across every pool, independent of the selected
// pool and the status/author filters (those scope the current table; this
// scopes the whole registry). Capped at `limit` hits so a broad query over
// ~1000 entries doesn't render an unbounded list.
//
// Id-aware: a query that exactly matches a known entry id ("poolId~ordinal",
// "poolId~key" for the trait pools, or a locally-added entry's "poolId~new-…"
// id — the same string this UI shows as a mono badge on every row) resolves
// directly to that one entry instead of running the substring text scan, so
// pasting an id jumps straight there.
export function searchAllEntries(
  pools: ContentPool[],
  labState: LabState,
  query: string,
  limit: number,
): SearchResult {
  const q = query.trim();
  if (!q) return { hits: [], totalMatches: 0 };

  for (const pool of pools) {
    const row = poolRows(pool, labState).find((r) => r.entryId === q);
    if (!row) continue;
    const text = effectiveText(row.meta, row.sourceText ?? "");
    return {
      hits: [{ poolId: pool.id, poolLabel: pool.label, index: row.index, entryId: q, text, status: row.meta.status }],
      totalMatches: 1,
    };
  }

  const lower = q.toLowerCase();
  const hits: SearchHit[] = [];
  let totalMatches = 0;
  for (const pool of pools) {
    for (const row of poolRows(pool, labState)) {
      const text = effectiveText(row.meta, row.sourceText ?? "");
      if (!text.toLowerCase().includes(lower)) continue;
      totalMatches++;
      if (hits.length < limit) {
        hits.push({ poolId: pool.id, poolLabel: pool.label, index: row.index, entryId: row.entryId, text, status: row.meta.status });
      }
    }
  }
  return { hits, totalMatches };
}

// DOM row id — keyed by entryId (not index) so it works uniformly for
// source-backed AND locally-added rows (the latter have no index at all).
export function entryRowId(poolId: string, entryId: string): string {
  return `entry-${poolId}-${entryId}`;
}

// --- File export / import --------------------------------------------------------

// Triggers a browser file download for a string payload — used for both the
// TS pool export and the JSON metadata export. A transient object URL + a
// programmatic <a download> click, revoked right after (the standard
// no-library way to save a generated string as a file).
export function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Reads an uploaded <input type="file"> File as text — the async/Promise
// wrapper FileReader itself doesn't offer.
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsText(file);
  });
}

// A pool id ("story.hooks.generic") turned into a filesystem-safe basename
// ("story.hooks.generic") — the ids are already dotted-lowercase-plus-hyphen,
// so this is mostly a defensive strip of anything that isn't.
export function poolFileBasename(poolId: string): string {
  return poolId.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}


// Major content groups get a fixed accent so the sidebar, pool header, and
// search results read as one color system (user 2026-07-08). Same palette
// family as the scene overlays (violet connections, amber windows, teal
// districts, blue transit).
export const GROUP_ACCENTS: Record<string, string> = {
  Story: "#9b6bc9",
  Names: "#e8b04a",
  Places: "#3fa87e",
  Businesses: "#6fa8ff",
  Traits: "#e86f8a",
};

export function groupAccent(group: string): string {
  return GROUP_ACCENTS[group] ?? "#8a94a8";
}
