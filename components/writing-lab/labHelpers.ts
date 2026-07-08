import type { ContentPool } from "@/lib/writing/contentRegistry";
import {
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

// Indices into pool.entries that pass the active filters, in source order.
export function filteredIndices(
  pool: ContentPool,
  labState: LabState,
  statusFilter: StatusFilter,
  authorFilter: AuthorFilter,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < pool.entries.length; i++) {
    if (matchesFilters(entryMeta(labState, pool.id, i), statusFilter, authorFilter)) out.push(i);
  }
  return out;
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
export function revertEntry(state: LabState, poolId: string, index: number): LabState {
  return setEntryMeta(state, poolId, index, { text: undefined });
}

// Advance every filtered entry currently in `from` status to `to` (bulk
// actions respect the active filters — "Mark All Reviewed" only touches what's
// on screen).
export function bulkAdvanceStatus(
  state: LabState,
  poolId: string,
  indices: number[],
  from: ReviewStatus,
  to: ReviewStatus,
): LabState {
  let next = state;
  for (const i of indices) {
    if (entryMeta(next, poolId, i).status === from) {
      next = setEntryMeta(next, poolId, i, { status: to });
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

// One pass over every entry in every pool (a few hundred to ~1000 total —
// cheap to recompute whenever labState changes rather than track deltas).
export function computeLabStats(pools: ContentPool[], labState: LabState): LabStats {
  const byStatus = emptyStatusCounts();
  const byAuthor = emptyAuthorCounts();
  const perPool: Record<string, PoolStats> = {};
  let total = 0;
  for (const pool of pools) {
    const poolByStatus = emptyStatusCounts();
    for (let i = 0; i < pool.entries.length; i++) {
      const meta = entryMeta(labState, pool.id, i);
      byStatus[meta.status]++;
      byAuthor[meta.author]++;
      poolByStatus[meta.status]++;
      total++;
    }
    perPool[pool.id] = { total: pool.entries.length, byStatus: poolByStatus };
  }
  return { total, byStatus, byAuthor, perPool };
}

export type SearchHit = {
  poolId: string;
  poolLabel: string;
  index: number;
  text: string;
  status: ReviewStatus;
};

export type SearchResult = { hits: SearchHit[]; totalMatches: number };

// Global entry-text search across every pool, independent of the selected
// pool and the status/author filters (those scope the current table; this
// scopes the whole registry). Capped at `limit` hits so a broad query over
// ~1000 entries doesn't render an unbounded list.
export function searchAllEntries(
  pools: ContentPool[],
  labState: LabState,
  query: string,
  limit: number,
): SearchResult {
  const q = query.trim().toLowerCase();
  if (!q) return { hits: [], totalMatches: 0 };
  const hits: SearchHit[] = [];
  let totalMatches = 0;
  for (const pool of pools) {
    for (let i = 0; i < pool.entries.length; i++) {
      const meta = entryMeta(labState, pool.id, i);
      const text = effectiveText(meta, pool.entries[i]);
      if (!text.toLowerCase().includes(q)) continue;
      totalMatches++;
      if (hits.length < limit) {
        hits.push({ poolId: pool.id, poolLabel: pool.label, index: i, text, status: meta.status });
      }
    }
  }
  return { hits, totalMatches };
}

export function entryRowId(poolId: string, index: number): string {
  return `entry-${poolId}-${index}`;
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
