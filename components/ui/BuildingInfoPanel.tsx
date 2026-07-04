"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { Crosshair, MapPin, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { focusBuilding } from "@/lib/scene/focusBuilding";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";
import { buildingPopulation } from "@/lib/seed/population";
import { generateWindowTexture } from "@/lib/seed/lightingGen";
import { meanLitStats } from "@/lib/scene/windowStats";
import { tileKeyFor } from "@/lib/scene/tileCull";
import { ARCHETYPE_LABELS, ARCHETYPE_ICONS } from "@/components/ui/panels/WindowsPanel";

/**
 * #87 single-click building info panel.
 *
 * Standalone floating overlay — a sibling of CameraPanel/SeedControls in
 * app/page.tsx, NOT a settings-drawer child (the feature stays outside the
 * settings accordion by design). Docked bottom-left, above SeedControls.
 *
 * Every field is recomputed from the seed, never stored: the building comes
 * from the SAME module-cached generateCity() call InstancedCity's buildMeshes
 * makes (the shared cache keeps repeat calls free), the district name from that
 * call's district list, the population from the shared buildingPopulation()
 * model (the one the heat-map + traffic use), and the lit fraction from the
 * same generateWindowTexture + meanLitStats the renderer's far-field mean uses.
 */

function Stat({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", muted ? "text-muted-foreground" : "font-medium")}>
        {value}
      </span>
    </div>
  );
}

export function BuildingInfoPanel() {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const setSelectedBuildingId = useSceneStore((s) => s.setSelectedBuildingId);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  // citySize/citySketch don't feed generateCity's ARGS directly — they drive
  // module-level gen state (tier extent / sketch field) that generateCity's own
  // cache key already accounts for — but are listed as memo deps here (matching
  // InstancedCity's buildMeshes memo) so a tier/sketch switch rebuilds the maps
  // instead of serving a stale one.
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  // Escape closes — same window-keydown idiom as ControlsGuide's Esc dismiss,
  // gated on the panel actually being open. (InstancedCity separately clears
  // selection on regen and on an empty-space click via onPointerMissed.)
  useEffect(() => {
    if (selectedBuildingId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedBuildingId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedBuildingId, setSelectedBuildingId]);

  const { idToBuilding, idToDistrict } = useMemo(() => {
    void citySize;
    void citySketch;
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    return {
      idToBuilding: new Map(buildings.map((b) => [b.id, b])),
      idToDistrict: new Map(districts.map((d) => [d.id, d])),
    };
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  const building =
    selectedBuildingId !== null ? idToBuilding.get(selectedBuildingId) : undefined;

  // Expected on-fraction of lit window cells (aMeanLit.w in the renderer).
  const litFraction = useMemo(() => {
    if (!building) return null;
    const tex = generateWindowTexture(masterSeed, building);
    const data = tex.texture.image.data as Uint8Array;
    const stats = meanLitStats(data, tex.cols * tex.rows);
    tex.texture.dispose();
    return stats[3];
  }, [building, masterSeed]);

  if (!building) return null;

  const Icon = ARCHETYPE_ICONS[building.archetype];
  const district = idToDistrict.get(building.districtId);
  const floorArea = building.width * building.depth * building.floors;
  const population = Math.round(buildingPopulation(building));
  const close = () => setSelectedBuildingId(null);

  return (
    <div className="pointer-events-auto fixed bottom-16 left-3 z-30 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-2.5 rounded-xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <Badge variant="secondary" className="gap-1.5 text-[0.8rem]">
            <Icon />
            {ARCHETYPE_LABELS[building.archetype]}
          </Badge>
          {district && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" />
              {district.displayName}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => focusBuilding(building)}
            title="Focus this building (also: double-click it)"
          >
            <Crosshair />
            Focus
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close building info">
            <X />
          </Button>
        </div>
      </div>

      <Separator />

      <Stat label="Est. Population" value={`~${population.toLocaleString()}`} />

      <Separator />

      <div className="flex flex-col gap-1">
        <Stat label="Height" value={`${Math.round(building.height)} m`} />
        <Stat label="Floors" value={building.floors} />
        <Stat
          label="Footprint"
          value={`${Math.round(building.width)} × ${Math.round(building.depth)} m`}
        />
        <Stat label="Floor Area" value={`${Math.round(floorArea).toLocaleString()} m²`} />
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <Stat
          label="Window Grid"
          value={`${building.colsPerFace} × ${building.rowsPerFloor}/floor`}
        />
        {litFraction !== null && <Stat label="Lit" value={`${Math.round(litFraction * 100)}%`} />}
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <Stat label="Core Proximity" value={`${Math.round(building.coreProximity * 100)}%`} muted />
        <Stat label="Tile" value={tileKeyFor(building.x, building.z)} muted />
        <Stat label="World" value={`${Math.round(building.x)}, ${Math.round(building.z)}`} muted />
        <Stat label="Building ID" value={`#${building.id}`} muted />
      </div>
    </div>
  );
}
