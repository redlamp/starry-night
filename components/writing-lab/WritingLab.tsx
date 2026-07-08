"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildContentRegistry } from "@/lib/writing/contentRegistry";
import {
  entryMeta,
  exportLabStateAsJson,
  exportPoolAsTs,
  loadLabState,
  saveLabState,
  setEntryMeta,
  type Authorship,
  type LabState,
  type ReviewStatus,
} from "@/lib/writing/labStore";
import {
  DEFAULT_UI_STATE,
  loadLabUiState,
  resizeColumn,
  resizeSidebar,
  saveLabUiState,
  setGroupExpanded,
  setSelectedPoolId as persistSelectedPoolId,
  type LabUiColumnWidths,
  type LabUiState,
} from "@/lib/writing/labUiStore";
import { EntryRow } from "./EntryRow";
import { Sidebar } from "./Sidebar";
import { Tutorial } from "./Tutorial";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SearchResults } from "./SearchResults";
import {
  HOOKS_SUBGROUP_KEY,
  AUTHOR_DOT_CLASS,
  AUTHOR_LABEL,
  AUTHOR_OPTIONS,
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  STATUS_OPTIONS,
  bulkAdvanceStatus,
  buildSidebarGroups,
  computeLabStats,
  entryRowId,
  filteredIndices,
  revertEntry,
  searchAllEntries,
  type AuthorFilter,
  type SearchHit,
  type StatusFilter,
} from "./labHelpers";

// /writing-lab: a content-review workbench over buildContentRegistry()'s ~50
// pools. Edits live in localStorage via labStore — the generation modules
// never read this state, so determinism holds; content ships by exporting a
// pool (or the whole metadata blob) and pasting it back into source. UI
// layout (sidebar expand state, selected pool, column widths) is a separate
// localStorage key via labUiStore, kept out of the content-shipping blob.

type CopyKind = "ts" | "json";

const GLOBAL_SEARCH_LIMIT = 100;

function StatChips({ byStatus }: { byStatus: Record<ReviewStatus, number> }) {
  return (
    <div className="flex items-center gap-1.5">
      {STATUS_OPTIONS.map((opt) => (
        <Badge key={opt.value} variant="muted" className="gap-1.5">
          <span className={cn("size-1.5 rounded-full", STATUS_DOT_CLASS[opt.value])} aria-hidden />
          {opt.label} {byStatus[opt.value]}
        </Badge>
      ))}
    </div>
  );
}

function ColumnResizeHandle({ onResize }: { onResize: (deltaPx: number) => void }) {
  const lastXRef = useRef(0);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none select-none hover:bg-ring/50"
      onPointerDown={(e) => {
        e.preventDefault();
        lastXRef.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        const delta = e.clientX - lastXRef.current;
        lastXRef.current = e.clientX;
        if (delta !== 0) onResize(delta);
      }}
    />
  );
}

export function WritingLab() {
  const pools = useMemo(() => buildContentRegistry(), []);
  const sidebarGroups = useMemo(() => buildSidebarGroups(pools), [pools]);

  const [selectedPoolId, setSelectedPoolId] = useState<string>(() => pools[0]?.id ?? "");
  const [labState, setLabState] = useState<LabState>({});
  const [uiState, setUiState] = useState<LabUiState>(DEFAULT_UI_STATE);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [authorFilter, setAuthorFilter] = useState<AuthorFilter>("all");
  const [poolFilter, setPoolFilter] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ poolId: string; index: number } | null>(null);
  const [flashTarget, setFlashTarget] = useState<{ poolId: string; index: number } | null>(null);

  // Hydrate persisted content overrides + UI layout after mount — the initial
  // render (server and client) uses defaults so there's no hydration
  // mismatch; localStorage only exists in the browser.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate from localStorage */
    setLabState(loadLabState());
    const loadedUi = loadLabUiState();
    setUiState(loadedUi);
    if (loadedUi.selectedPoolId && pools.some((p) => p.id === loadedUi.selectedPoolId)) {
      setSelectedPoolId(loadedUi.selectedPoolId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time hydrate, pools is stable
  }, []);

  const updateLab = useCallback((fn: (s: LabState) => LabState) => {
    setLabState((prev) => {
      const next = fn(prev);
      saveLabState(next);
      return next;
    });
  }, []);

  const updateUi = useCallback((fn: (s: LabUiState) => LabUiState) => {
    setUiState((prev) => {
      const next = fn(prev);
      saveLabUiState(next);
      return next;
    });
  }, []);

  const handleSelectPool = useCallback(
    (poolId: string) => {
      setSelectedPoolId(poolId);
      updateUi((s) => persistSelectedPoolId(s, poolId));
    },
    [updateUi],
  );

  const handleSetGroupExpanded = useCallback(
    (key: string, open: boolean) => updateUi((s) => setGroupExpanded(s, key, open)),
    [updateUi],
  );

  const handleResizeColumn = useCallback(
    (column: keyof LabUiColumnWidths, deltaPx: number) =>
      updateUi((s) => resizeColumn(s, column, deltaPx)),
    [updateUi],
  );

  const stats = useMemo(() => computeLabStats(pools, labState), [pools, labState]);

  const selectedPool = useMemo(
    () => pools.find((p) => p.id === selectedPoolId),
    [pools, selectedPoolId],
  );

  const visibleIndices = useMemo(
    () =>
      selectedPool
        ? filteredIndices(selectedPool, labState, statusFilter, authorFilter)
        : [],
    [selectedPool, labState, statusFilter, authorFilter],
  );

  const searchResult = useMemo(
    () =>
      globalQuery.trim()
        ? searchAllEntries(pools, labState, globalQuery, GLOBAL_SEARCH_LIMIT)
        : null,
    [pools, labState, globalQuery],
  );

  const handleSelectHit = useCallback(
    (hit: SearchHit) => {
      setSelectedPoolId(hit.poolId);
      updateUi((s) => persistSelectedPoolId(s, hit.poolId));
      setStatusFilter("all");
      setAuthorFilter("all");
      setGlobalQuery("");
      setPendingFocus({ poolId: hit.poolId, index: hit.index });
    },
    [updateUi],
  );

  // Scroll to and briefly highlight a row jumped to from the global search
  // results. Runs after the target pool's table has rendered (visibleIndices
  // depends on selectedPool, so this re-fires once the row exists in the DOM).
  useEffect(() => {
    if (!pendingFocus || pendingFocus.poolId !== selectedPool?.id) return;
    const el = document.getElementById(entryRowId(pendingFocus.poolId, pendingFocus.index));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- imperative scroll target found, not derivable from render */
    setFlashTarget(pendingFocus);
    setPendingFocus(null);
    const timer = setTimeout(() => setFlashTarget(null), 1200);
    return () => clearTimeout(timer);
  }, [pendingFocus, selectedPool, visibleIndices]);

  const flashCopied = useCallback((kind: CopyKind) => {
    setCopied(kind);
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
  }, []);

  const copyPoolAsTs = useCallback(async () => {
    if (!selectedPool) return;
    const ts = exportPoolAsTs(labState, selectedPool.id, selectedPool.entries);
    try {
      await navigator.clipboard.writeText(ts);
      flashCopied("ts");
    } catch {
      // clipboard permission denied — nothing more to do in a lab tool
    }
  }, [selectedPool, labState, flashCopied]);

  const copyAllJson = useCallback(async () => {
    const json = exportLabStateAsJson(labState);
    try {
      await navigator.clipboard.writeText(json);
      flashCopied("json");
    } catch {
      // clipboard permission denied — nothing more to do in a lab tool
    }
  }, [labState, flashCopied]);

  const markAllReviewed = useCallback(() => {
    if (!selectedPool) return;
    const poolId = selectedPool.id;
    const indices = visibleIndices;
    updateLab((s) => bulkAdvanceStatus(s, poolId, indices, "draft", "review"));
  }, [selectedPool, visibleIndices, updateLab]);

  const markAllFinal = useCallback(() => {
    if (!selectedPool) return;
    const poolId = selectedPool.id;
    const indices = visibleIndices;
    updateLab((s) => bulkAdvanceStatus(s, poolId, indices, "review", "final"));
  }, [selectedPool, visibleIndices, updateLab]);

  if (!selectedPool) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background text-muted-foreground">
        No content pools registered.
      </div>
    );
  }

  const poolStats = stats.perPool[selectedPool.id];
  const showSearchResults = searchResult !== null;

  return (
    <TooltipProvider>
      <div className="flex h-dvh w-full flex-col bg-background text-foreground">
        {/* Top bar */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h1 className="text-base font-semibold whitespace-nowrap">Writing Lab</h1>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {stats.total} entries
          </span>
          <StatChips byStatus={stats.byStatus} />
          <Separator orientation="vertical" className="h-5" />
          <div className="relative w-56">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="Search All Entries"
              className="h-7 pr-7 pl-7 text-xs"
            />
            {globalQuery && (
              <button
                type="button"
                onClick={() => setGlobalQuery("")}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear Search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Separator orientation="vertical" className="h-5" />
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue>
                {(v: StatusFilter) =>
                  v === "all" ? (
                    "All Statuses"
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASS[v])}
                        aria-hidden
                      />
                      {STATUS_LABEL[v]}
                    </span>
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASS[opt.value])}
                    aria-hidden
                  />
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={authorFilter}
            onValueChange={(v) => setAuthorFilter(v as AuthorFilter)}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue>
                {(v: AuthorFilter) =>
                  v === "all" ? (
                    "All Authors"
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn("size-1.5 shrink-0 rounded-full", AUTHOR_DOT_CLASS[v])}
                        aria-hidden
                      />
                      {AUTHOR_LABEL[v]}
                    </span>
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Authors</SelectItem>
              {AUTHOR_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", AUTHOR_DOT_CLASS[opt.value])}
                    aria-hidden
                  />
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            {copied && (
              <span className="text-xs text-muted-foreground" role="status">
                Copied
              </span>
            )}
            <ThemeToggle />
            <Tutorial />
            <Button variant="outline" size="sm" onClick={copyPoolAsTs}>
              Copy Pool as TS
            </Button>
            <Button variant="outline" size="sm" onClick={copyAllJson}>
              Copy All Metadata JSON
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <Sidebar
            groups={sidebarGroups}
            stats={stats}
            selectedPoolId={selectedPoolId}
            onSelectPool={handleSelectPool}
            uiState={uiState}
            onSetGroupExpanded={handleSetGroupExpanded}
            poolFilter={poolFilter}
            width={uiState.sidebarWidth}
            onResize={(delta) => updateUi((prev) => resizeSidebar(prev, delta))}
            onSetAllExpanded={(open) =>
              updateUi((prev) => ({
                ...prev,
                expandedGroups: Object.fromEntries(
                  [...sidebarGroups.map((g) => g.group), HOOKS_SUBGROUP_KEY].map((k) => [k, open]),
                ),
              }))
            }
            onLocateSelected={() => {
              const selected = pools.find((pool) => pool.id === selectedPoolId);
              updateUi((prev) => {
                const expanded = { ...prev.expandedGroups };
                if (selected) expanded[selected.group] = true;
                if (selectedPoolId.startsWith("story.hooks.")) expanded[HOOKS_SUBGROUP_KEY] = true;
                return { ...prev, expandedGroups: expanded };
              });
              // After the groups open, bring the row into view.
              window.setTimeout(() => {
                document
                  .getElementById(`pool-row-${selectedPoolId}`)
                  ?.scrollIntoView({ block: "center" });
              }, 50);
            }}
            onPoolFilterChange={setPoolFilter}
          />

          {/* Main */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {showSearchResults ? (
              <SearchResults
                query={globalQuery}
                hits={searchResult.hits}
                totalMatches={searchResult.totalMatches}
                onSelectHit={handleSelectHit}
              />
            ) : (
              <>
                {/* Pool header */}
                <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">{selectedPool.label}</h2>
                    <p className="font-mono text-xs text-muted-foreground">{selectedPool.source}</p>
                    {selectedPool.slots && (
                      <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                        Slots: {selectedPool.slots}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{poolStats.total} entries</span>
                      <StatChips byStatus={poolStats.byStatus} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={markAllReviewed}>
                      Mark All Reviewed
                    </Button>
                    <Button variant="secondary" size="sm" onClick={markAllFinal}>
                      Mark All Final
                    </Button>
                  </div>
                </div>

                {/* Table */}
                <div className="min-h-0 flex-1">
                  <ScrollArea className="h-full">
                    <table className="w-full border-collapse text-left text-sm" style={{ tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: "2.75rem" }} />
                        <col />
                        <col style={{ width: `${uiState.columnWidths.author}px` }} />
                        <col style={{ width: `${uiState.columnWidths.status}px` }} />
                        <col style={{ width: "2.5rem" }} />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-background">
                        <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                          <th className="px-2 py-2 text-right font-medium">#</th>
                          <th className="px-2 py-2 font-medium">Content</th>
                          <th className="relative px-2 py-2 font-medium">
                            Author
                            <ColumnResizeHandle
                              onResize={(delta) => handleResizeColumn("author", delta)}
                            />
                          </th>
                          <th className="relative px-2 py-2 font-medium">
                            Status
                            <ColumnResizeHandle
                              onResize={(delta) => handleResizeColumn("status", delta)}
                            />
                          </th>
                          <th className="px-1 py-2 font-medium">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleIndices.map((index) => {
                          const poolId = selectedPool.id;
                          const meta = entryMeta(labState, poolId, index);
                          const rowId = entryRowId(poolId, index);
                          return (
                            <EntryRow
                              key={index}
                              id={rowId}
                              index={index}
                              sourceText={selectedPool.entries[index]}
                              meta={meta}
                              flash={
                                flashTarget?.poolId === poolId && flashTarget.index === index
                              }
                              onSaveText={(text) =>
                                updateLab((s) =>
                                  setEntryMeta(s, poolId, index, {
                                    text,
                                    author: meta.author === "ai" ? "edited" : meta.author,
                                  }),
                                )
                              }
                              onRevertText={() => updateLab((s) => revertEntry(s, poolId, index))}
                              onAuthorChange={(author: Authorship) =>
                                updateLab((s) => setEntryMeta(s, poolId, index, { author }))
                              }
                              onStatusChange={(status: ReviewStatus) =>
                                updateLab((s) => setEntryMeta(s, poolId, index, { status }))
                              }
                            />
                          );
                        })}
                        {visibleIndices.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                              No entries match the active filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </ScrollArea>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
