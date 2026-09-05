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
      <div className="border-border text-muted-foreground shrink-0 border-b px-4 py-2 text-xs">
        {totalMatches} {totalMatches === 1 ? "match" : "matches"} for &ldquo;{query}&rdquo; across
        all pools
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {hits.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">
            No entries match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {hits.map((hit) => (
              <li key={`${hit.poolId}-${hit.index}`}>
                <button
                  type="button"
                  onClick={() => onSelectHit(hit)}
                  className="hover:bg-muted/40 flex w-full items-start gap-2.5 px-4 py-2 text-left"
                >
                  <Badge variant="outline" className="mt-0.5 shrink-0 font-mono text-xs">
                    {hit.poolLabel}
                  </Badge>
                  <span
                    className={cn(
                      "text-foreground min-w-0 flex-1 truncate text-sm",
                      hit.status === "cut" && "text-muted-foreground line-through",
                    )}
                  >
                    {hit.text}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-muted-foreground mt-0.5 shrink-0 font-mono text-xs font-normal select-all"
                  >
                    {hit.entryId}
                  </Badge>
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
          <p className="text-muted-foreground px-4 py-3 text-xs">
            {totalMatches - hits.length} more not shown
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
