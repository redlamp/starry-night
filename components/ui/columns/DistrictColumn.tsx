"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { useCityHover } from "@/lib/hooks/useCityHover";
import { approxCount } from "@/lib/utils";
import { useEntityIndexes } from "./entityData";
import { ColumnStat, ShowMore } from "./EntityColumns";

const STREET_CAP = 8;

export function DistrictColumn({ id, part }: { id: string; part: "pinned" | "rest" }) {
  const push = useSceneStore((s) => s.pushColumn);
  const hover = useCityHover();
  const indexes = useEntityIndexes();
  const [allStreets, setAllStreets] = useState(false);
  const [allLandmarks, setAllLandmarks] = useState(false);
  const agg = indexes.districtAgg(id);
  if (!agg) {
    return part === "pinned" ? null : (
      <div className="text-muted-foreground text-sm">District not found.</div>
    );
  }

  if (part === "pinned") {
    return (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" style={{ color: agg.district.color }}>
            {agg.district.displayName}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {agg.district.character}
          </Badge>
        </div>

        <div className="flex flex-col gap-1">
          <ColumnStat label="Population" value={approxCount(agg.populationEst)} />
          <ColumnStat label="Listed" value={agg.residentCount.toLocaleString()} />
          <ColumnStat label="Companies" value={agg.companyCount.toLocaleString()} />
          <ColumnStat label="Homes" value={agg.homeBuildingCount.toLocaleString()} />
          <ColumnStat label="Area" value={`${(agg.district.area / 1e6).toFixed(2)} km²`} muted />
        </div>
      </>
    );
  }

  return (
    <>
      {agg.streets.length > 0 && (
        <>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-medium">Streets</div>
              {/* The count column is buildings-per-street. */}
              <Building2
                className="text-muted-foreground size-3.5 shrink-0"
                aria-label="Buildings on street"
              />
            </div>
            {(allStreets ? agg.streets : agg.streets.slice(0, STREET_CAP)).map((s) => (
              <button
                key={s.roadId}
                type="button"
                onClick={() => push({ kind: "street", id: s.roadId })}
                {...hover.road(s.roadId)}
                className="hover:bg-foreground/10 focus-visible:ring-ring/50 -mx-1 flex items-baseline justify-between gap-2 rounded-sm px-1 text-left text-sm focus-visible:ring-3 focus-visible:outline-none"
              >
                <span className="truncate">{s.name}</span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {s.buildingCount}
                </span>
              </button>
            ))}
            <ShowMore
              total={agg.streets.length}
              cap={STREET_CAP}
              expanded={allStreets}
              onToggle={() => setAllStreets(!allStreets)}
            />
          </div>
        </>
      )}

      {agg.namedBuildings.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">Landmarks</div>
            {(allLandmarks ? agg.namedBuildings : agg.namedBuildings.slice(0, 6)).map((b) => (
              <button
                key={b.buildingId}
                type="button"
                onClick={() => push({ kind: "building", id: b.buildingId })}
                {...hover.building(b.buildingId)}
                className="hover:bg-foreground/10 focus-visible:ring-ring/50 -mx-1 rounded-sm px-1 text-left text-sm focus-visible:ring-3 focus-visible:outline-none"
              >
                <span className="truncate">{b.name}</span>
              </button>
            ))}
            <ShowMore
              total={agg.namedBuildings.length}
              cap={6}
              expanded={allLandmarks}
              onToggle={() => setAllLandmarks(!allLandmarks)}
            />
          </div>
        </>
      )}
    </>
  );
}
