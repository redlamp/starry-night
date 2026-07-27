"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { useCityHover } from "@/lib/hooks/useCityHover";
import { approxCount, cn } from "@/lib/utils";
import { useEntityIndexes } from "./entityData";
import { AddrNum, ColumnStat, ShowMore } from "./EntityColumns";

const LIST_CAP = 8;

const TIER_LABEL = { highway: "Highway", arterial: "Arterial", minor: "Local street" } as const;

// Districts the road runs through, as a VERTICAL list under the stats (user
// 2026-07-27) ordered along the road — same reading direction as Crossings, so
// both lists walk the route from its start. Hover lights the district in the
// scene (the shared hoverDistrictId the directory rows and DistrictHover both
// drive); the km column is where the road enters it.
function DistrictRows({
  spans,
}: {
  spans: Array<{ id: string; name: string; color: string; alongM: number; lengthM: number }>;
}) {
  const push = useSceneStore((s) => s.pushColumn);
  const hoverDistrictId = useSceneStore((s) => s.hoverDistrictId);
  const hover = useCityHover();
  const [all, setAll] = useState(false);
  if (spans.length === 0) return null;
  const shown = all ? spans : spans.slice(0, LIST_CAP);
  // A single district needs no route marker — it IS the road's district.
  const showMarks = spans.length > 1;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-sm font-medium">Districts</div>
      {shown.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => push({ kind: "district", id: d.id })}
          {...hover.district(d.id)}
          className={cn(
            "hover:bg-foreground/10 -mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm",
            hoverDistrictId === d.id && "bg-foreground/10",
          )}
        >
          <span className="truncate" style={{ color: d.color }}>
            {d.name}
          </span>
          {showMarks && (
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {(d.alongM / 1000).toFixed(2)} km
            </span>
          )}
        </button>
      ))}
      <ShowMore
        total={spans.length}
        cap={LIST_CAP}
        expanded={all}
        onToggle={() => setAll(!all)}
        noun="districts"
      />
    </div>
  );
}

export function StreetColumn({ id, part }: { id: string; part: "pinned" | "rest" }) {
  const push = useSceneStore((s) => s.pushColumn);
  const hover = useCityHover();
  const indexes = useEntityIndexes();
  const [allBuildings, setAllBuildings] = useState(false);
  const [allCompanies, setAllCompanies] = useState(false);
  const [allPeople, setAllPeople] = useState(false);
  const [allCrossings, setAllCrossings] = useState(false);
  const agg = indexes.streetAgg(id);
  if (!agg) {
    return part === "pinned" ? null : (
      <div className="text-sm text-muted-foreground">Street not found.</div>
    );
  }

  if (part === "pinned") {
    return (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{TIER_LABEL[agg.road.tier]}</Badge>
        </div>

        <div className="flex flex-col gap-1">
          <ColumnStat label="Length" value={`${(agg.lengthM / 1000).toFixed(2)} km`} />
          {/* Highways carry no addresses, so their count rows would all read 0 —
              they show junctions instead (user 2026-07-27). */}
          {agg.buildingIds.length > 0 && (
            <ColumnStat label="Buildings" value={agg.buildingIds.length.toLocaleString()} />
          )}
          {agg.companies.length > 0 && (
            <ColumnStat label="Companies" value={agg.companies.length.toLocaleString()} />
          )}
          {agg.populationEst > 0 && (
            <ColumnStat label="Population" value={approxCount(agg.populationEst)} />
          )}
          {agg.residentCount > 0 && (
            <ColumnStat label="Listed" value={agg.residentCount.toLocaleString()} />
          )}
          {agg.crossings.length > 0 && (
            <ColumnStat label="Crossings" value={agg.crossings.length.toLocaleString()} />
          )}
        </div>

        <DistrictRows
          spans={agg.districtSpans.map((s) => ({
            id: s.district.id,
            name: indexes.names.districtNames.get(s.district.id) ?? s.district.displayName,
            color: s.district.color,
            alongM: s.alongM,
            lengthM: s.lengthM,
          }))}
        />
      </>
    );
  }

  return (
    <>
      {agg.buildingIds.length > 0 && (
        <>
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">Buildings</div>
            {/* Directory formatting (BuildingsView): address number in a
                right-aligned fixed-width column, then the street, with a named
                building's name as an outline badge on the right. */}
            {(allBuildings ? agg.buildingIds : agg.buildingIds.slice(0, LIST_CAP)).map((buildingId) => {
              const address = indexes.names.addresses.get(buildingId);
              const name = indexes.names.buildingNames.get(buildingId);
              return (
                <button
                  key={buildingId}
                  type="button"
                  onClick={() => push({ kind: "building", id: buildingId })}
                  {...hover.building(buildingId)}
                  className="hover:bg-foreground/10 -mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    {address ? (
                      <>
                        <AddrNum n={address.number} width={indexes.names.maxAddressDigits} />
                        <span className="truncate">{address.street}</span>
                      </>
                    ) : (
                      <span className="truncate">Building #{buildingId}</span>
                    )}
                  </span>
                  {name && (
                    <Badge variant="outline" className="max-w-[7rem] shrink-0 truncate">
                      {name}
                    </Badge>
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

      {agg.crossings.length > 0 && (
        <>
          {agg.buildingIds.length > 0 && <Separator />}
          <div className="flex flex-col gap-0.5">
          {/* Every road that crosses this one, in order along it — the junction
              list a highway has instead of an address list. Offramps aren't
              modelled yet; when they are, they attach to these points. */}
          <div className="text-sm font-medium">Crossings</div>
          {(allCrossings ? agg.crossings : agg.crossings.slice(0, LIST_CAP)).map((c) => (
            <button
              key={c.roadId}
              type="button"
              onClick={() => push({ kind: "street", id: c.roadId })}
              {...hover.road(c.roadId)}
              className="hover:bg-foreground/10 -mx-1 flex items-baseline justify-between gap-2 rounded px-1 text-left text-sm"
            >
              <span className="truncate">{c.name}</span>
              <span className="text-muted-foreground flex shrink-0 items-baseline gap-2">
                {c.tier !== "minor" && (
                  <Badge variant="outline" className="shrink-0">
                    {TIER_LABEL[c.tier]}
                  </Badge>
                )}
                <span className="tabular-nums">{(c.alongM / 1000).toFixed(2)} km</span>
              </span>
            </button>
          ))}
          <ShowMore
            total={agg.crossings.length}
            cap={LIST_CAP}
            expanded={allCrossings}
            onToggle={() => setAllCrossings(!allCrossings)}
            noun="crossings"
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
                {...hover.company(biz.buildingId, biz.id)}
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
                {...hover.persona(p.homeBuildingId, p.householdIndex)}
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
