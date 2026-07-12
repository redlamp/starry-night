"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Download, Search, Upload, X } from "lucide-react";

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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildContentRegistry } from "@/lib/writing/contentRegistry";
import {
  addEntry,
  deleteAddedEntry,
  exportLabStateAsJson,
  exportPoolGuarded,
  importLabStateFromJson,
  importPoolFromTs,
  loadLabState,
  mergeLabState,
  saveLabState,
  setEntryMeta,
  type Authorship,
  type ExportBlockedEntry,
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
  SORT_OPTIONS,
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  STATUS_OPTIONS,
  bulkAdvanceStatus,
  buildSidebarGroups,
  computeLabStats,
  effectiveText,
  entryRowId,
  poolFileBasename,
  readFileAsText,
  revertEntry,
  searchAllEntries,
  triggerDownload,
  visibleRows,
  type AuthorFilter,
  type DisplayRow,
  type SearchHit,
  type SortDir,
  type SortKey,
  type StatusFilter,
} from "./labHelpers";

// /writing-lab: a content-review workbench over buildContentRegistry()'s ~80
// pools. Edits live in localStorage via labStore — the generation modules
// never read this state, so determinism holds; content ships by exporting a
// pool (or the whole metadata blob) and pasting/loading it back into source.
// UI layout (sidebar expand state, selected pool, column widths) is a
// separate localStorage key via labUiStore, kept out of the content-shipping
// blob.

type CopyKind = "ts" | "json";
type SortKeyOrNone = SortKey | "none";

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

// Small icon-button-with-tooltip, matching EntryRow.tsx's action-button idiom
// (used here for the file download/import row).
function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" size="icon-sm" onClick={onClick} />}>
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
  const [sortKey, setSortKey] = useState<SortKeyOrNone>("none");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [poolFilter, setPoolFilter] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ poolId: string; entryId: string } | null>(null);
  const [flashTarget, setFlashTarget] = useState<{ poolId: string; entryId: string } | null>(null);
  // Set after "Copy/Download Pool as TS" whenever the guarded exporter
  // excluded pending changes (cuts, adds, unknown tokens, a changed rng-slot
  // signature) — the export still succeeds with the SAFE text only; this is
  // how the UI surfaces what didn't ship rather than silently dropping it.
  // Cleared on dismiss or on switching pools.
  const [exportWarning, setExportWarning] = useState<ExportBlockedEntry[]>([]);
  // Result/error message from the last file import — kept visible until
  // dismissed (import outcomes are more consequential than a "Copied" flash).
  const [importNotice, setImportNotice] = useState<string | null>(null);
  // Checkbox multi-select, keyed by entryId — batch author/status/duplicate/
  // delete apply to this set. Cleared on pool switch (ids are pool-scoped by
  // construction, but a stale cross-pool selection would just be confusing).
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());

  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const tsFileInputRef = useRef<HTMLInputElement>(null);

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
      setExportWarning([]); // a stale warning from the previous pool shouldn't linger
      setSelectedEntryIds(new Set());
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

  const rows: DisplayRow[] = useMemo(
    () =>
      selectedPool
        ? visibleRows(
            selectedPool,
            labState,
            statusFilter,
            authorFilter,
            sortKey === "none" ? undefined : { key: sortKey, dir: sortDir },
          )
        : [],
    [selectedPool, labState, statusFilter, authorFilter, sortKey, sortDir],
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
      setPendingFocus({ poolId: hit.poolId, entryId: hit.entryId });
    },
    [updateUi],
  );

  // Scroll to and briefly highlight a row jumped to from the global search
  // results. Runs after the target pool's table has rendered (rows depends on
  // selectedPool, so this re-fires once the row exists in the DOM).
  useEffect(() => {
    if (!pendingFocus || pendingFocus.poolId !== selectedPool?.id) return;
    const el = document.getElementById(entryRowId(pendingFocus.poolId, pendingFocus.entryId));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- imperative scroll target found, not derivable from render */
    setFlashTarget(pendingFocus);
    setPendingFocus(null);
    const timer = setTimeout(() => setFlashTarget(null), 1200);
    return () => clearTimeout(timer);
  }, [pendingFocus, selectedPool, rows]);

  const flashCopied = useCallback((kind: CopyKind) => {
    setCopied(kind);
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
  }, []);

  const copyPoolAsTs = useCallback(async () => {
    if (!selectedPool) return;
    const { ts, blocked } = exportPoolGuarded(labState, selectedPool);
    setExportWarning(blocked);
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

  const downloadPoolAsTs = useCallback(() => {
    if (!selectedPool) return;
    const { ts, blocked } = exportPoolGuarded(labState, selectedPool);
    setExportWarning(blocked);
    triggerDownload(`${poolFileBasename(selectedPool.id)}.ts`, ts, "text/typescript");
  }, [selectedPool, labState]);

  const downloadAllJson = useCallback(() => {
    triggerDownload("writing-lab-metadata.json", exportLabStateAsJson(labState), "application/json");
  }, [labState]);

  const handleImportJsonFile = useCallback(
    async (file: File) => {
      const imported = importLabStateFromJson(await readFileAsText(file));
      if (!imported) {
        setImportNotice("That file doesn't look like a writing-lab metadata export (expected the JSON from “Download All Metadata JSON”).");
        return;
      }
      updateLab((prev) => mergeLabState(prev, imported));
      setImportNotice("Imported metadata JSON — merged into the current state (existing edits not present in the file are untouched).");
    },
    [updateLab],
  );

  const handleImportTsFile = useCallback(
    async (file: File) => {
      if (!selectedPool) return;
      const raw = await readFileAsText(file);
      const result = importPoolFromTs(labState, selectedPool, raw);
      if (!result) {
        setImportNotice("That file doesn't look like a pool TS export (expected an array of strings).");
        return;
      }
      updateLab(() => result.state);
      setImportNotice(
        `Imported ${result.changed} changed line${result.changed === 1 ? "" : "s"} into ${selectedPool.label}.` +
          (result.truncated
            ? " The array length differed from the current source — only overlapping lines were applied."
            : ""),
      );
    },
    [selectedPool, labState, updateLab],
  );

  const markAllReviewed = useCallback(() => {
    if (!selectedPool) return;
    const poolId = selectedPool.id;
    const entryIds = rows.map((r) => r.entryId);
    updateLab((s) => bulkAdvanceStatus(s, poolId, entryIds, "draft", "review"));
  }, [selectedPool, rows, updateLab]);

  const markAllFinal = useCallback(() => {
    if (!selectedPool) return;
    const poolId = selectedPool.id;
    const entryIds = rows.map((r) => r.entryId);
    updateLab((s) => bulkAdvanceStatus(s, poolId, entryIds, "review", "final"));
  }, [selectedPool, rows, updateLab]);

  const duplicateRow = useCallback(
    (row: DisplayRow) => {
      if (!selectedPool) return;
      const text = effectiveText(row.meta, row.sourceText ?? "");
      updateLab((s) => addEntry(s, selectedPool.id, text, row.meta.author).state);
    },
    [selectedPool, updateLab],
  );

  // Source row -> mark "cut" (the existing guarded soft-delete; the row
  // itself can't leave the array). Added row -> true removal (it never
  // shipped anywhere, so there's nothing to guard).
  const deleteRow = useCallback(
    (row: DisplayRow) => {
      if (!selectedPool) return;
      const poolId = selectedPool.id;
      updateLab((s) =>
        row.index === null
          ? deleteAddedEntry(s, poolId, row.entryId)
          : setEntryMeta(s, poolId, row.entryId, { status: "cut" }),
      );
      setSelectedEntryIds((prev) => {
        if (!prev.has(row.entryId)) return prev;
        const next = new Set(prev);
        next.delete(row.entryId);
        return next;
      });
    },
    [selectedPool, updateLab],
  );

  const toggleRowChecked = useCallback((entryId: string, checked: boolean) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  }, []);

  const allVisibleChecked = rows.length > 0 && rows.every((r) => selectedEntryIds.has(r.entryId));
  const someVisibleChecked = rows.some((r) => selectedEntryIds.has(r.entryId));
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someVisibleChecked && !allVisibleChecked;
    }
  }, [someVisibleChecked, allVisibleChecked]);

  const toggleAllVisibleChecked = useCallback(
    (checked: boolean) => {
      setSelectedEntryIds((prev) => {
        const next = new Set(prev);
        for (const r of rows) {
          if (checked) next.add(r.entryId);
          else next.delete(r.entryId);
        }
        return next;
      });
    },
    [rows],
  );

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedEntryIds.has(r.entryId)),
    [rows, selectedEntryIds],
  );

  const applyToSelected = useCallback(
    (patch: { author?: Authorship; status?: ReviewStatus }) => {
      if (!selectedPool || selectedRows.length === 0) return;
      const poolId = selectedPool.id;
      updateLab((s) => {
        let next = s;
        for (const row of selectedRows) next = setEntryMeta(next, poolId, row.entryId, patch);
        return next;
      });
    },
    [selectedPool, selectedRows, updateLab],
  );

  const duplicateSelected = useCallback(() => {
    if (!selectedPool || selectedRows.length === 0) return;
    const poolId = selectedPool.id;
    updateLab((s) => {
      let next = s;
      for (const row of selectedRows) {
        const text = effectiveText(row.meta, row.sourceText ?? "");
        next = addEntry(next, poolId, text, row.meta.author).state;
      }
      return next;
    });
  }, [selectedPool, selectedRows, updateLab]);

  const deleteSelected = useCallback(() => {
    if (!selectedPool || selectedRows.length === 0) return;
    const poolId = selectedPool.id;
    updateLab((s) => {
      let next = s;
      for (const row of selectedRows) {
        next =
          row.index === null
            ? deleteAddedEntry(next, poolId, row.entryId)
            : setEntryMeta(next, poolId, row.entryId, { status: "cut" });
      }
      return next;
    });
    setSelectedEntryIds(new Set());
  }, [selectedPool, selectedRows, updateLab]);

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
          <Separator orientation="vertical" className="h-5" />
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKeyOrNone)}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue>
                {(v: SortKeyOrNone) =>
                  v === "none" ? "Original Order" : `Sort · ${SORT_OPTIONS.find((o) => o.value === v)?.label}`
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Original Order</SelectItem>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sortKey !== "none" && (
            <IconAction
              label={sortDir === "asc" ? "Ascending (click for descending)" : "Descending (click for ascending)"}
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir === "asc" ? <ArrowDownAZ /> : <ArrowUpAZ />}
            </IconAction>
          )}
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
            <Separator orientation="vertical" className="h-5" />
            <IconAction label="Download Pool as TS File" onClick={downloadPoolAsTs}>
              <Download />
            </IconAction>
            <IconAction label="Download All Metadata as JSON File" onClick={downloadAllJson}>
              <Download />
            </IconAction>
            <IconAction label="Import Pool from a TS File" onClick={() => tsFileInputRef.current?.click()}>
              <Upload />
            </IconAction>
            <IconAction label="Import Metadata from a JSON File" onClick={() => jsonFileInputRef.current?.click()}>
              <Upload />
            </IconAction>
            <input
              ref={tsFileInputRef}
              type="file"
              accept=".ts,text/typescript,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleImportTsFile(file);
              }}
            />
            <input
              ref={jsonFileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleImportJsonFile(file);
              }}
            />
          </div>
        </header>

        {importNotice && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs text-foreground">
            <p>{importNotice}</p>
            <button
              type="button"
              onClick={() => setImportNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

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

                {/* Batch bar: appears once 1+ rows are checked. Author/Status
                    apply an EXACT value to every checked row (unlike "Mark All
                    *" above, which advances a specific from->to transition
                    across everything currently visible). */}
                {selectedRows.length > 0 && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-accent/40 px-4 py-2 text-xs">
                    <span className="font-medium">
                      {selectedRows.length} selected
                    </span>
                    <Select value="" onValueChange={(v) => applyToSelected({ author: v as Authorship })}>
                      <SelectTrigger size="sm" className="w-36">
                        <SelectValue placeholder="Set Author…" />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTHOR_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value="" onValueChange={(v) => applyToSelected({ status: v as ReviewStatus })}>
                      <SelectTrigger size="sm" className="w-36">
                        <SelectValue placeholder="Set Status…" />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={duplicateSelected}>
                      Duplicate
                    </Button>
                    <Button variant="outline" size="sm" onClick={deleteSelected}>
                      Delete / Cut
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setSelectedEntryIds(new Set())}
                    >
                      Clear Selection
                    </Button>
                  </div>
                )}

                {/* Guarded-export warning: which pending changes the last
                    "Copy/Download Pool as TS" excluded, and why — the export
                    still succeeds with the safe text only; this is how that
                    stays visible instead of a silent drop. */}
                {exportWarning.length > 0 && (
                  <div className="shrink-0 border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">
                        Exported with {exportWarning.length} change{exportWarning.length === 1 ? "" : "s"} excluded
                        — {exportWarning.length === 1 ? "it" : "these"} would change the city:
                      </p>
                      <button
                        type="button"
                        onClick={() => setExportWarning([])}
                        aria-label="Dismiss"
                        className="shrink-0 text-amber-700/70 hover:text-amber-700 dark:text-amber-300/70 dark:hover:text-amber-300"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {exportWarning.map((b) => (
                        <li key={b.entryId} className="font-mono">
                          {b.index === null ? "new" : `#${b.index}`} ({b.entryId}) — {b.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Table */}
                <div className="min-h-0 flex-1">
                  <ScrollArea className="h-full">
                    <table className="w-full border-collapse text-left text-sm" style={{ tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: "2rem" }} />
                        <col style={{ width: "2.75rem" }} />
                        <col />
                        <col style={{ width: `${uiState.columnWidths.author}px` }} />
                        <col style={{ width: `${uiState.columnWidths.status}px` }} />
                        <col style={{ width: "4.5rem" }} />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-background">
                        <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                          <th className="px-2 py-2 font-medium">
                            <input
                              ref={headerCheckboxRef}
                              type="checkbox"
                              checked={allVisibleChecked}
                              onChange={(e) => toggleAllVisibleChecked(e.target.checked)}
                              aria-label="Select all visible rows"
                              className="size-3.5 cursor-pointer accent-primary"
                            />
                          </th>
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
                        {rows.map((row) => {
                          const poolId = selectedPool.id;
                          const { entryId, index, sourceText, meta } = row;
                          const rowId = entryRowId(poolId, entryId);
                          const isAdded = index === null;
                          return (
                            <EntryRow
                              key={entryId}
                              id={rowId}
                              index={index}
                              entryId={entryId}
                              isAdded={isAdded}
                              sourceText={sourceText}
                              meta={meta}
                              flash={flashTarget?.poolId === poolId && flashTarget.entryId === entryId}
                              checked={selectedEntryIds.has(entryId)}
                              onCheckedChange={(checked) => toggleRowChecked(entryId, checked)}
                              onSaveText={(text) =>
                                updateLab((s) =>
                                  setEntryMeta(s, poolId, entryId, {
                                    text,
                                    author: meta.author === "ai" ? "edited" : meta.author,
                                  }),
                                )
                              }
                              onRevertText={() => updateLab((s) => revertEntry(s, poolId, entryId))}
                              onAuthorChange={(author: Authorship) =>
                                updateLab((s) => setEntryMeta(s, poolId, entryId, { author }))
                              }
                              onStatusChange={(status: ReviewStatus) =>
                                updateLab((s) => setEntryMeta(s, poolId, entryId, { status }))
                              }
                              onDuplicate={() => duplicateRow(row)}
                              onDelete={() => deleteRow(row)}
                            />
                          );
                        })}
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
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
