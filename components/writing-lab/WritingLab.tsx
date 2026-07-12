"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Copy, Download, Search, Upload, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  AUTHOR_OPTIONS,
  SORT_OPTIONS,
  STATUS_DOT_CLASS,
  STATUS_OPTIONS,
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
import { AuthorContent, AuthorLegend, StatusContent } from "./controls";

// /writing-lab: a content-review workbench over buildContentRegistry()'s ~80
// pools. Edits live in localStorage via labStore — the generation modules
// never read this state, so determinism holds; content ships by exporting a
// pool (or the whole metadata blob) and pasting/loading it back into source.
// UI layout (sidebar expand state, selected pool, column widths) is a
// separate localStorage key via labUiStore, kept out of the content-shipping
// blob.

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
  const [copied, setCopied] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{ poolId: string; entryId: string } | null>(null);
  const [flashTarget, setFlashTarget] = useState<{ poolId: string; entryId: string } | null>(null);
  // Set after a TS export whenever the guarded exporter excluded pending
  // changes (cuts, adds, unknown tokens, a changed rng-slot signature) — the
  // export still succeeds with the SAFE text only; this surfaces what didn't
  // ship rather than silently dropping it. Cleared on dismiss or pool switch.
  const [exportWarning, setExportWarning] = useState<ExportBlockedEntry[]>([]);
  // Result/error from the last file import — kept visible until dismissed.
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // Checkbox multi-select, keyed by entryId — batch author/status/duplicate/
  // delete apply to this set. Cleared on pool switch.
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const flashCopied = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  // --- Export (one dropdown: TS or JSON, copy or download) ---
  const copyPoolAsTs = useCallback(async () => {
    if (!selectedPool) return;
    const { ts, blocked } = exportPoolGuarded(labState, selectedPool);
    setExportWarning(blocked);
    try {
      await navigator.clipboard.writeText(ts);
      flashCopied();
    } catch {
      /* clipboard permission denied — nothing more to do in a lab tool */
    }
  }, [selectedPool, labState, flashCopied]);

  const downloadPoolAsTs = useCallback(() => {
    if (!selectedPool) return;
    const { ts, blocked } = exportPoolGuarded(labState, selectedPool);
    setExportWarning(blocked);
    triggerDownload(`${poolFileBasename(selectedPool.id)}.ts`, ts, "text/typescript");
  }, [selectedPool, labState]);

  const copyAllJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportLabStateAsJson(labState));
      flashCopied();
    } catch {
      /* clipboard permission denied */
    }
  }, [labState, flashCopied]);

  const downloadAllJson = useCallback(() => {
    triggerDownload("writing-lab-metadata.json", exportLabStateAsJson(labState), "application/json");
  }, [labState]);

  // --- Import (one entry point: auto-detect .ts vs .json) ---
  const importFile = useCallback(
    async (file: File) => {
      const raw = await readFileAsText(file);
      const isJson = /\.json$/i.test(file.name) || raw.trim().startsWith("{");
      if (isJson) {
        const imported = importLabStateFromJson(raw);
        if (!imported) {
          setImportNotice(`"${file.name}" doesn't look like a writing-lab metadata export (expected the JSON from Export → Metadata JSON).`);
          return;
        }
        updateLab((prev) => mergeLabState(prev, imported));
        setImportNotice(`Imported metadata from "${file.name}" — merged into the current state (existing edits not present in the file are untouched).`);
        return;
      }
      // Otherwise treat it as a pool TS array, applied to the CURRENT pool.
      if (!selectedPool) return;
      const result = importPoolFromTs(labState, selectedPool, raw);
      if (!result) {
        setImportNotice(`"${file.name}" doesn't look like a pool TS export (expected an array of strings).`);
        return;
      }
      updateLab(() => result.state);
      setImportNotice(
        `Imported ${result.changed} changed line${result.changed === 1 ? "" : "s"} from "${file.name}" into ${selectedPool.label}.` +
          (result.truncated
            ? " The array length differed from the current source — only overlapping lines were applied."
            : ""),
      );
    },
    [selectedPool, labState, updateLab],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void importFile(file);
    },
    [importFile],
  );

  // --- Row + batch actions ---
  const duplicateRow = useCallback(
    (row: DisplayRow) => {
      if (!selectedPool) return;
      const text = effectiveText(row.meta, row.sourceText ?? "");
      updateLab((s) => addEntry(s, selectedPool.id, text, row.meta.author).state);
    },
    [selectedPool, updateLab],
  );

  // Source row -> mark "cut" (the guarded soft-delete; the row can't leave the
  // array). Added row -> true removal (it never shipped, nothing to guard).
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
  const hasSelection = selectedRows.length > 0;

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
        <header className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
          {/* Title block — total + status summary sit directly BELOW the
              "Writing Lab" heading (user 2026-07-12). */}
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-semibold whitespace-nowrap">Writing Lab</h1>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {stats.total} entries
              </span>
            </div>
            <StatChips byStatus={stats.byStatus} />
          </div>
          <Separator orientation="vertical" className="h-9" />
          <div className="flex flex-wrap items-center gap-3">
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
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue>
                  {(v: StatusFilter) => (v === "all" ? "All Statuses" : <StatusContent value={v} />)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="pl-2.5">
                  All Statuses
                </SelectItem>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="pl-2.5">
                    <StatusContent value={opt.value} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={authorFilter} onValueChange={(v) => setAuthorFilter(v as AuthorFilter)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue>
                  {(v: AuthorFilter) => (v === "all" ? "All Authors" : <AuthorContent value={v} />)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="pl-2.5">
                  All Authors
                </SelectItem>
                {AUTHOR_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="pl-2.5">
                    <AuthorContent value={opt.value} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {copied && (
              <span className="text-xs text-muted-foreground" role="status">
                Copied
              </span>
            )}
            <ThemeToggle />
            {/* One Export button; the dropdown chooses TS (this pool) vs JSON
                (all metadata), each copy or download (user 2026-07-12). */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm">
                    Export
                  </Button>
                }
              />
              <DropdownMenuContent>
                {/* base-ui requires GroupLabel to live inside a Group. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>This pool · TypeScript</DropdownMenuLabel>
                  <DropdownMenuItem onClick={copyPoolAsTs}>
                    <Copy /> Copy to clipboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={downloadPoolAsTs}>
                    <Download /> Download .ts
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>All metadata · JSON</DropdownMenuLabel>
                  <DropdownMenuItem onClick={copyAllJson}>
                    <Copy /> Copy to clipboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={downloadAllJson}>
                    <Download /> Download .json
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* One Import button; auto-detects .ts (pool) vs .json (metadata). */}
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload /> Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ts,.json,text/typescript,application/json,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
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
              window.setTimeout(() => {
                document
                  .getElementById(`pool-row-${selectedPoolId}`)
                  ?.scrollIntoView({ block: "center" });
              }, 50);
            }}
            onPoolFilterChange={setPoolFilter}
          />

          {/* Main */}
          <main
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              isDragOver && "ring-2 ring-ring ring-inset",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDragOver) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              // Only clear when the pointer actually leaves the main area.
              if (e.currentTarget === e.target) setIsDragOver(false);
            }}
            onDrop={onDrop}
          >
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
                <div className="flex shrink-0 flex-col gap-1 border-b border-border px-4 py-3">
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

                {/* List toolbar: always-visible batch actions (left) + sort
                    control (right). Supersedes the old "Mark All" buttons and
                    the header-row sort affordance (user 2026-07-12). */}
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                  <Checkbox
                    checked={allVisibleChecked}
                    indeterminate={someVisibleChecked && !allVisibleChecked}
                    onCheckedChange={(c) => toggleAllVisibleChecked(c === true)}
                    aria-label="Select all visible rows"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {selectedRows.length} selected
                  </span>
                  <Separator orientation="vertical" className="h-5" />
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="outline" size="sm" disabled={!hasSelection}>
                          Set Author
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="start">
                      {AUTHOR_OPTIONS.map((opt) => (
                        <DropdownMenuItem key={opt.value} onClick={() => applyToSelected({ author: opt.value })}>
                          <AuthorContent value={opt.value} />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="outline" size="sm" disabled={!hasSelection}>
                          Set Status
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="start">
                      {STATUS_OPTIONS.map((opt) => (
                        <DropdownMenuItem key={opt.value} onClick={() => applyToSelected({ status: opt.value })}>
                          <StatusContent value={opt.value} />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="outline" size="sm" disabled={!hasSelection} onClick={duplicateSelected}>
                    Duplicate
                  </Button>
                  <Button variant="outline" size="sm" disabled={!hasSelection} onClick={deleteSelected}>
                    Delete / Cut
                  </Button>
                  {hasSelection && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedEntryIds(new Set())}>
                      Clear
                    </Button>
                  )}

                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Sort</span>
                    <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKeyOrNone)}>
                      <SelectTrigger size="sm" className="w-40">
                        <SelectValue>
                          {(v: SortKeyOrNone) =>
                            v === "none"
                              ? "Original Order"
                              : (SORT_OPTIONS.find((o) => o.value === v)?.label ?? "Original Order")
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
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon-sm"
                            disabled={sortKey === "none"}
                            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                            aria-label={sortDir === "asc" ? "Ascending" : "Descending"}
                          />
                        }
                      >
                        {sortDir === "asc" ? <ArrowDownAZ /> : <ArrowUpAZ />}
                      </TooltipTrigger>
                      <TooltipContent>
                        {sortDir === "asc"
                          ? "Ascending — click for descending"
                          : "Descending — click for ascending"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Guarded-export warning: which pending changes the last TS
                    export excluded, and why — the export still succeeds with the
                    safe text only. */}
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
                        <col style={{ width: "2.5rem" }} />
                        <col style={{ width: "2.75rem" }} />
                        <col />
                        <col style={{ width: `${uiState.columnWidths.author}px` }} />
                        <col style={{ width: `${uiState.columnWidths.status}px` }} />
                        <col style={{ width: "4.5rem" }} />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-background">
                        <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                          <th className="py-2 pr-2 pl-4 font-medium">
                            <span className="sr-only">Select</span>
                          </th>
                          <th className="px-2 py-2 text-right font-medium">#</th>
                          <th className="px-2 py-2 font-medium">Content</th>
                          <th className="relative px-2 py-2 font-medium">
                            <span className="inline-flex items-center gap-1 normal-case">
                              <span className="uppercase">Author</span>
                              <AuthorLegend />
                            </span>
                            <ColumnResizeHandle onResize={(delta) => handleResizeColumn("author", delta)} />
                          </th>
                          <th className="relative px-2 py-2 font-medium">
                            Status
                            <ColumnResizeHandle onResize={(delta) => handleResizeColumn("status", delta)} />
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
        {/* Fixed bottom-right corner button (renders its own floating trigger). */}
        <Tutorial />
      </div>
    </TooltipProvider>
  );
}
