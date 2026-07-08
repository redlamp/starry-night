"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { useEntityIndexes } from "./entityData";
import { ColumnStat, ShowMore } from "./EntityColumns";

const LIST_CAP = 8;

const TIER_LABEL = { highway: "Highway", arterial: "Arterial", minor: "Local street" } as const;

export function StreetColumn({ id }: { id: string }) {
  const push = useSceneStore((s) => s.pushColumn);
  const indexes = useEntityIndexes();
  const [allBuildings, setAllBuildings] = useState(false);
  const [allCompanies, setAllCompanies] = useState(false);
  const [allPeople, setAllPeople] = useState(false);
  const agg = indexes.streetAgg(id);
  if (!agg) return <div className="text-sm text-muted-foreground">Street not found.</div>;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{TIER_LABEL[agg.road.tier]}</Badge>
        {agg.districts.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => push({ kind: "district", id: d.id })}
          >
            <Badge variant="secondary" style={{ color: d.color }}>
              {indexes.names.districtNames.get(d.id) ?? d.displayName}
            </Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <ColumnStat label="Buildings" value={agg.buildingIds.length.toLocaleString()} />
        <ColumnStat label="Companies" value={agg.companies.length.toLocaleString()} />
        <ColumnStat label="Residents" value={agg.residentCount.toLocaleString()} />
      </div>

      {agg.buildingIds.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">Buildings</div>
            {(allBuildings ? agg.buildingIds : agg.buildingIds.slice(0, LIST_CAP)).map((buildingId) => {
              const address = indexes.names.addresses.get(buildingId);
              const name = indexes.names.buildingNames.get(buildingId);
              return (
                <button
                  key={buildingId}
                  type="button"
                  onClick={() => push({ kind: "building", id: buildingId })}
                  className="-mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm hover:bg-foreground/10"
                >
                  <span className="truncate">
                    {name ?? (address ? `${address.number} ${address.street}` : `#${buildingId}`)}
                  </span>
                  {name && address && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {address.number}
                    </span>
                  )}
                </button>
              );
            })}
            <ShowMore
              total={agg.buildingIds.length}
              cap={LIST_CAP}
              expanded={allBuildings}
              onToggle={() => setAllBuildings(!allBuildings)}
            />
          </div>
        </>
      )}

      {agg.companies.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">Companies</div>
            {(allCompanies ? agg.companies : agg.companies.slice(0, LIST_CAP)).map((biz) => (
              <button
                key={biz.id}
                type="button"
                onClick={() => push({ kind: "company", id: biz.id })}
                className="-mx-1 flex items-center justify-between gap-2 rounded px-1 text-left text-sm hover:bg-foreground/10"
              >
                <span className="truncate">{biz.name}</span>
                <Badge variant="outline" className="shrink-0 capitalize">
                  {biz.kind}
                </Badge>
              </button>
            ))}
            <ShowMore
              total={agg.companies.length}
              cap={LIST_CAP}
              expanded={allCompanies}
              onToggle={() => setAllCompanies(!allCompanies)}
            />
          </div>
        </>
      )}

      {agg.residentsSample.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">People</div>
            {(allPeople ? agg.residentsSample : agg.residentsSample.slice(0, LIST_CAP)).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => push({ kind: "persona", id: p.id })}
                className="-mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm hover:bg-foreground/10"
              >
                <span className="truncate">{p.fullName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{p.age}</span>
              </button>
            ))}
            <ShowMore
              total={Math.min(agg.residentCount, agg.residentsSample.length)}
              cap={LIST_CAP}
              expanded={allPeople}
              onToggle={() => setAllPeople(!allPeople)}
              noun="residents"
            />
            {allPeople && agg.residentCount > agg.residentsSample.length && (
              <div className="px-1 text-sm text-muted-foreground">
                {agg.residentCount - agg.residentsSample.length} more live here; open a building
                for its full households.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
