"use client";

import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { useSceneStore } from "@/lib/state/sceneStore";
import { focusBuilding, unfocusBuilding } from "@/lib/scene/focusBuilding";
import { residentialCapacity } from "@/lib/seed/population";
import { siftBuilding } from "@/lib/seed/personaStory";
import { ARCHETYPE_LABELS } from "@/components/ui/panels/WindowsPanel";
import { useEntityIndexes } from "./entityData";
import { ColumnStat, IconTip } from "./EntityColumns";

// Column port of the old BuildingInfoPanel: stats + the occupants list split
// between companies and households, every entry a push into the next column.

export function BuildingColumn({ id, part }: { id: number; part: "pinned" | "rest" }) {
  const push = useSceneStore((s) => s.pushColumn);
  const focusedBuildingId = useSceneStore((s) => s.focusedBuildingId);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const setHoveredTenant = useSceneStore((s) => s.setHoveredTenant);
  // Occupants disclosure — same shared-across-instances idiom as the
  // resident card's cardDetailsOpen (2026-09-05).
  const cardOccupantsOpen = useSceneStore((s) => s.cardOccupantsOpen);
  const setCardOccupantsOpen = useSceneStore((s) => s.setCardOccupantsOpen);
  const indexes = useEntityIndexes();
  const building = indexes.buildingById.get(id);
  if (!building) {
    return part === "pinned" ? null : (
      <div className="text-muted-foreground text-sm">Building not found.</div>
    );
  }

  const district = indexes.districtById.get(building.districtId);
  const address = indexes.names.addresses.get(id);
  const companies = indexes.companiesInBuilding(id);
  const households = indexes.householdsInBuilding(id);
  // Self-materializes this building's stories (lazy since 2026-07-10).
  const siftLine = siftBuilding(masterSeed, indexes.directory, id);
  // Census capacity (mixed-use aware, #96 recalibration) — 0 for archetypes
  // nobody lives in, which hides the stat below.
  const population = Math.round(residentialCapacity(building));
  const isFocused = focusedBuildingId === id;

  if (part === "pinned") {
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">{ARCHETYPE_LABELS[building.archetype]}</Badge>
          <IconTip label={isFocused ? "Unfocus" : "Focus"}>
            <Button
              variant={isFocused ? "default" : "secondary"}
              size="icon-sm"
              onClick={() => (isFocused ? unfocusBuilding() : focusBuilding(building))}
              aria-label={isFocused ? "Unfocus this building" : "Focus this building"}
              aria-pressed={isFocused}
            >
              <MapPin />
            </Button>
          </IconTip>
        </div>

        {district && (
          <button
            type="button"
            onClick={() => push({ kind: "district", id: district.id })}
            className="focus-visible:ring-ring/50 flex items-center gap-1.5 rounded-sm text-left text-sm font-medium hover:underline focus-visible:ring-3 focus-visible:outline-none"
            style={{ color: district.color }}
          >
            <MapPin className="size-4 shrink-0" />
            <span className="truncate">
              {indexes.names.districtNames.get(district.id) ?? district.displayName}
            </span>
          </button>
        )}
        {address && (
          <button
            type="button"
            onClick={() => push({ kind: "street", id: address.roadId })}
            className="text-muted-foreground focus-visible:ring-ring/50 -mt-1 rounded-sm text-left text-sm hover:underline focus-visible:ring-3 focus-visible:outline-none"
          >
            {address.number} {address.street}
          </button>
        )}

        <div className="flex flex-col gap-1">
          {population > 0 && (
            <ColumnStat label="Est. Population" value={`~${population.toLocaleString()}`} />
          )}
          {households.length > 0 && (
            <ColumnStat
              label="Listed"
              value={`${households.reduce((sum, hh) => sum + hh.memberIds.length, 0)} residents · ${households.length} ${households.length === 1 ? "household" : "households"}`}
            />
          )}
          <ColumnStat
            label="Height"
            value={`${Math.round(building.height)} m · ${building.floors} floors`}
          />
          <ColumnStat
            label="Footprint"
            value={`${Math.round(building.width)} × ${Math.round(building.depth)} m`}
            muted
          />
        </div>
      </>
    );
  }

  // Trigger label carries occupant counts (2026-09-05) so the closed state
  // still says something rather than a bare "Occupants".
  const occupantsSummary = [
    companies.length > 0
      ? `${companies.length} ${companies.length === 1 ? "company" : "companies"}`
      : null,
    households.length > 0
      ? `${households.length} ${households.length === 1 ? "household" : "households"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {siftLine && <div className="text-muted-foreground text-sm italic">{siftLine}</div>}
        {/* Companies + households/residents live behind a disclosure
            (2026-09-05, same idiom as the resident card's Details) — the
            pinned stats above are the front of the card, the occupant lists
            are the form. */}
        <Collapsible open={cardOccupantsOpen} onOpenChange={setCardOccupantsOpen}>
          <CollapsibleTrigger className="text-muted-foreground text-sm font-medium">
            Occupants{occupantsSummary && ` · ${occupantsSummary}`}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="flex flex-col gap-1.5 pt-1.5">
              {companies.length === 0 && households.length === 0 && (
                <div className="text-muted-foreground text-sm">Nobody&apos;s home tonight.</div>
              )}

              {companies.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <div className="text-muted-foreground text-xs tracking-wide uppercase">
                    Companies
                  </div>
                  {companies.map((biz) => (
                    <button
                      key={biz.id}
                      type="button"
                      onClick={() => push({ kind: "company", id: biz.id })}
                      onMouseEnter={() => setHoveredTenant({ buildingId: id, businessId: biz.id })}
                      onMouseLeave={() => setHoveredTenant(null)}
                      className="hover:bg-foreground/10 focus-visible:ring-ring/50 -mx-1 flex items-center justify-between gap-2 rounded-sm px-1 text-left text-sm focus-visible:ring-3 focus-visible:outline-none"
                    >
                      <span className="truncate">{biz.name}</span>
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {biz.kind}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}

              {companies.length > 0 && households.length > 0 && <Separator className="my-0.5" />}

              {households.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-muted-foreground flex items-baseline justify-between text-xs tracking-wide uppercase">
                    <span>Residents</span>
                    <span>Age</span>
                  </div>
                  {households.map((hh) => (
                    <div
                      key={`${hh.buildingId}:${hh.index}`}
                      className="flex flex-col gap-0.5"
                      onMouseEnter={() =>
                        setHoveredTenant({ buildingId: hh.buildingId, householdIndex: hh.index })
                      }
                      onMouseLeave={() => setHoveredTenant(null)}
                    >
                      {/* Unit right-aligned in the row, like the ages column
                          (user 2026-07-08). Pilled so it reads as metadata, distinct
                          from the plain-text ages below (user 2026-07-10). Family
                          name reads as a section label: ALL CAPS, one size down,
                          two shades darker (user 2026-07-27). */}
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-foreground/60 truncate text-xs font-medium tracking-wide uppercase">
                          {hh.label}
                        </span>
                        {hh.unit && (
                          <Badge
                            variant="outline"
                            className="shrink-0 px-1.5 py-0 text-xs font-normal"
                          >
                            Unit {hh.unit}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 pl-1">
                        {hh.memberIds.map((pid) => {
                          const persona = indexes.directory.personas.get(pid);
                          if (!persona) return null;
                          return (
                            <button
                              key={pid}
                              type="button"
                              onClick={() => push({ kind: "persona", id: pid })}
                              className="hover:bg-foreground/10 focus-visible:ring-ring/50 -mx-1 flex items-baseline justify-between gap-2 rounded-sm px-1 text-left text-sm focus-visible:ring-3 focus-visible:outline-none"
                            >
                              <span className="truncate">
                                {persona.givenName} {persona.familyName}
                              </span>
                              <span className="text-muted-foreground shrink-0 tabular-nums">
                                {persona.age}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </div>
    </>
  );
}
