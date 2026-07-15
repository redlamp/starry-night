"use client";

import { Crosshair, FoldVertical, Search, UnfoldVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ContentPool } from "@/lib/writing/contentRegistry";
import { isGroupExpanded, type LabUiState } from "@/lib/writing/labUiStore";
import { useRef } from "react";
import {
  aggregatePoolStats,
  filterSidebarPools,
  groupAccent,
  HOOKS_SUBGROUP_KEY,
  stripGroupPrefix,
  type LabStats,
  type SidebarGroup,
} from "./labHelpers";

// The sidebar's information architecture: collapsible groups (Story / Names /
// Places / Businesses / Traits), each with a pool count, entry count, and a
// thin "fraction finalized" progress bar. Story's ~17 "Hooks · *" pools nest
// under one more collapsible level so they don't flood the top-level list.
// Expand state + selected pool live in labUiStore, not labStore — this is
// presentation, not content.

function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-green-500 dark:bg-green-400"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function PoolRow({
  pool,
  stats,
  active,
  onSelect,
  stripPrefix,
  accent,
}: {
  pool: ContentPool;
  stats: LabStats;
  active: boolean;
  onSelect: (poolId: string) => void;
  stripPrefix: boolean;
  accent: string;
}) {
  const s = stats.perPool[pool.id];
  const pct = s.total > 0 ? Math.round((s.byStatus.final / s.total) * 100) : 0;
  const label = stripPrefix ? stripGroupPrefix(pool.label) : pool.label;
  return (
    <button
      type="button"
      id={`pool-row-${pool.id}`}
      onClick={() => onSelect(pool.id)}
      className={cn(
        "flex flex-col gap-1 rounded-md border-l-2 px-2 py-1.5 text-left transition-colors",
        active
          ? "bg-muted text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
      style={active ? { borderLeftColor: accent } : undefined}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {s.byStatus.final}/{s.total}
        </span>
      </span>
      <ProgressBar pct={pct} className="h-0.5" />
    </button>
  );
}

function GroupSection({
  sidebarGroup,
  stats,
  selectedPoolId,
  onSelectPool,
  uiState,
  onSetGroupExpanded,
  filter,
}: {
  sidebarGroup: SidebarGroup;
  stats: LabStats;
  selectedPoolId: string;
  onSelectPool: (poolId: string) => void;
  uiState: LabUiState;
  onSetGroupExpanded: (key: string, open: boolean) => void;
  filter: string;
}) {
  const visiblePools = filterSidebarPools(sidebarGroup.pools, filter);
  const visibleHooks = filterSidebarPools(sidebarGroup.hookPools, filter);
  if (filter && visiblePools.length === 0 && visibleHooks.length === 0) return null;

  const allPools = [...sidebarGroup.pools, ...sidebarGroup.hookPools];
  const { total, final } = aggregatePoolStats(allPools, stats);
  const pct = total > 0 ? Math.round((final / total) * 100) : 0;
  const forceOpen = filter.length > 0;
  const open = forceOpen || isGroupExpanded(uiState, sidebarGroup.group);

  const accent = groupAccent(sidebarGroup.group);
  const hooksAgg = aggregatePoolStats(sidebarGroup.hookPools, stats);
  const hooksPct = hooksAgg.total > 0 ? Math.round((hooksAgg.final / hooksAgg.total) * 100) : 0;
  const hooksOpen = forceOpen || isGroupExpanded(uiState, HOOKS_SUBGROUP_KEY);

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => onSetGroupExpanded(sidebarGroup.group, next)}
    >
      <CollapsibleTrigger className="px-2 py-1.5 hover:bg-muted/60">
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: accent }}
                aria-hidden
              />
              <span className="truncate font-mono text-xs tracking-wider text-muted-foreground uppercase">
                {sidebarGroup.group}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {allPools.length} pools · {total} entries
            </span>
          </span>
          <ProgressBar pct={pct} className="mt-1" />
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-1 py-1 pl-1">
          {visiblePools.map((pool) => (
            <PoolRow
              key={pool.id}
              pool={pool}
              stats={stats}
              active={pool.id === selectedPoolId}
              onSelect={onSelectPool}
              stripPrefix={false}
              accent={accent}
            />
          ))}
          {sidebarGroup.hookPools.length > 0 && visibleHooks.length > 0 && (
            <Collapsible
              open={hooksOpen}
              onOpenChange={(next) => onSetGroupExpanded(HOOKS_SUBGROUP_KEY, next)}
            >
              <CollapsibleTrigger className="py-1 pl-2 hover:bg-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-muted-foreground">
                      Hooks
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {sidebarGroup.hookPools.length} pools · {hooksAgg.total} entries
                    </span>
                  </span>
                  <ProgressBar pct={hooksPct} className="mt-1 h-0.5" />
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="flex flex-col gap-1 py-1 pl-4">
                  {visibleHooks.map((pool) => (
                    <PoolRow
                      key={pool.id}
                      pool={pool}
                      stats={stats}
                      active={pool.id === selectedPoolId}
                      onSelect={onSelectPool}
                      stripPrefix
                      accent={accent}
                    />
                  ))}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          )}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function Sidebar({
  groups,
  stats,
  selectedPoolId,
  onSelectPool,
  uiState,
  onSetGroupExpanded,
  poolFilter,
  onPoolFilterChange,
  width,
  onResize,
  onSetAllExpanded,
  onLocateSelected,
}: {
  groups: SidebarGroup[];
  stats: LabStats;
  selectedPoolId: string;
  onSelectPool: (poolId: string) => void;
  uiState: LabUiState;
  onSetGroupExpanded: (key: string, open: boolean) => void;
  poolFilter: string;
  onPoolFilterChange: (value: string) => void;
  width: number;
  onResize: (deltaPx: number) => void;
  onSetAllExpanded: (open: boolean) => void;
  onLocateSelected: () => void;
}) {
  const filter = poolFilter.trim().toLowerCase();
  const lastXRef = useRef(0);

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-border"
      style={{ width }}
    >
      {/* Drag the dividing bar to widen/narrow the pools column (persisted). */}
      <div
        role="separator"
        aria-orientation="vertical"
        className="absolute inset-y-0 -right-0.5 z-10 w-1.5 cursor-col-resize touch-none select-none hover:bg-ring/50"
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
      <div className="relative shrink-0 px-3 pt-3 pb-2">
        <Search
          className="pointer-events-none absolute top-1/2 left-5.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={poolFilter}
          onChange={(e) => onPoolFilterChange(e.target.value)}
          placeholder="Filter Pools"
          className="h-7 pr-7 pl-7 text-xs"
        />
        {poolFilter && (
          <button
            type="button"
            onClick={() => onPoolFilterChange("")}
            className="absolute top-1/2 right-5.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear Pool Filter"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {/* Tree toolbar: bulk expand/collapse + reveal the selected pool. */}
      <TooltipProvider delay={300}>
        <div className="flex shrink-0 items-center gap-0.5 px-3 pb-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onSetAllExpanded(true)}
                  aria-label="Expand all groups"
                >
                  <UnfoldVertical />
                </Button>
              }
            />
            <TooltipContent>Expand All</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onSetAllExpanded(false)}
                  aria-label="Collapse all groups"
                >
                  <FoldVertical />
                </Button>
              }
            />
            <TooltipContent>Collapse All</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onLocateSelected}
                  aria-label="Reveal the selected pool"
                >
                  <Crosshair />
                </Button>
              }
            />
            <TooltipContent>Locate Selected</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-2 p-3 pt-1">
          {groups.map((sidebarGroup) => (
            <GroupSection
              key={sidebarGroup.group}
              sidebarGroup={sidebarGroup}
              stats={stats}
              selectedPoolId={selectedPoolId}
              onSelectPool={onSelectPool}
              uiState={uiState}
              onSetGroupExpanded={onSetGroupExpanded}
              filter={filter}
            />
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}
