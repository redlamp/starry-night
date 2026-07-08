"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { STATUS_DOT_CLASS, type SearchHit } from "./labHelpers";

// The main-area view while the global entry search is active — replaces the
// pool table with cross-pool hits. Clicking a hit selects its pool, clears
// the query, and scrolls/flashes the row back in WritingLab.

export function SearchResults({
  query,
  hits,
  totalMatches,
  onSelectHit,
}: {
  query: string;
  hits: SearchHit[];
  totalMatches: number;
  onSelectHit: (hit: SearchHit) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        {totalMatches} {totalMatches === 1 ? "match" : "matches"} for &ldquo;{query}&rdquo; across
        all pools
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {hits.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No entries match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {hits.map((hit) => (
              <li key={`${hit.poolId}-${hit.index}`}>
                <button
                  type="button"
                  onClick={() => onSelectHit(hit)}
                  className="flex w-full items-start gap-2.5 px-4 py-2 text-left hover:bg-muted/40"
                >
                  <Badge variant="outline" className="mt-0.5 shrink-0 font-mono text-[10px]">
                    {hit.poolLabel}
                  </Badge>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm text-foreground",
                      hit.status === "cut" && "text-muted-foreground line-through",
                    )}
                  >
                    {hit.text}
                  </span>
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      STATUS_DOT_CLASS[hit.status],
                    )}
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {totalMatches > hits.length && (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            {totalMatches - hits.length} more not shown
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
