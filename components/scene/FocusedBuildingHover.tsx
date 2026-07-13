"use client";

import { useMemo, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { usePersonaDirectoryDeferred } from "@/lib/hooks/usePersonaDirectory";
import { generateCity, type Building } from "@/lib/seed/cityGen";
import { seededRng } from "@/lib/seed/rng";
import { SELECT_OUTLINE_COLOR } from "@/lib/state/sceneDefaults";
import { tenancyLayout, type TenantRegion } from "@/lib/seed/tenancyLayout";
import { UnitBox, brighten } from "./UnitBox";

// When a building is FOCUSED, all its selectable units show as translucent
// cubes; the unit under the cursor brightens, and clicking selects that tenant.
// Each unit box is individually interactive, so a unit on ANY face can be
// hovered/clicked — not just the one facing the camera (user 2026-07-12, §2.7).
// Only real tenants (no filler).
export function FocusedBuildingHover({ masterSeed }: { masterSeed: string }) {
  const focusedBuildingId = useSceneStore((s) => s.focusedBuildingId);
  const pushColumn = useSceneStore((s) => s.pushColumn);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const directory = usePersonaDirectoryDeferred(focusedBuildingId !== null);

  const data = useMemo(() => {
    void citySize;
    void citySketch;
    if (focusedBuildingId === null || !directory) return null;
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    const building = buildings.find((b) => b.id === focusedBuildingId);
    if (!building) return null;
    const district = districts.find((d) => d.id === building.districtId);
    const character = district?.character ?? "residential";
    const households = directory.byHomeBuilding.get(building.id) ?? [];
    const businesses = directory.byWorkBuilding.get(building.id) ?? [];
    const regions = tenancyLayout(
      building,
      households,
      businesses,
      character,
      seededRng(`${masterSeed}::personas::tenancy::${building.id}`),
    );
    void district;
    return { building, regions, households, color: brighten(SELECT_OUTLINE_COLOR) };
  }, [focusedBuildingId, directory, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  if (!data) return null;

  const onSelect = (region: TenantRegion) => {
    if (region.householdIndex !== undefined) {
      const hh = data.households.find((h) => h.index === region.householdIndex);
      const pid = hh?.memberIds[0];
      if (pid) pushColumn({ kind: "persona", id: pid });
    } else if (region.businessId) {
      pushColumn({ kind: "company", id: region.businessId });
    }
  };

  return <BuildingUnitPicker key={data.building.id} building={data.building} regions={data.regions} color={data.color} onSelect={onSelect} />;
}

function BuildingUnitPicker({
  building,
  regions,
  color,
  onSelect,
}: {
  building: Building;
  regions: TenantRegion[];
  color: string;
  onSelect: (region: TenantRegion) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <>
      {regions.map((r, i) => (
        <UnitBox
          key={i}
          building={building}
          region={r}
          color={color}
          proud
          opacity={hovered === i ? 0.62 : 0.12}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(i);
          }}
          onPointerOut={() => setHovered((prev) => (prev === i ? null : prev))}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(r);
          }}
        />
      ))}
    </>
  );
}
