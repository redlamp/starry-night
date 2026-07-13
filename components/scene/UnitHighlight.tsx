"use client";

import { useMemo } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { usePersonaDirectoryDeferred } from "@/lib/hooks/usePersonaDirectory";
import { generateCity } from "@/lib/seed/cityGen";
import { seededRng } from "@/lib/seed/rng";
import { SELECT_OUTLINE_COLOR } from "@/lib/state/sceneDefaults";
import { tenancyLayout, regionForHousehold, regionForBusiness } from "@/lib/seed/tenancyLayout";
import { UnitBox, brighten } from "./UnitBox";

// Highlights a FEATURED tenant's unit: driven by a tenant hovered on a building
// card (`hoveredTenant`, wins) or the selected resident's home. The focused-
// building 3D hover is handled separately (FocusedBuildingHover).
export function UnitHighlight({ masterSeed }: { masterSeed: string }) {
  const selectedPersonaId = useSceneStore((s) => s.selectedPersonaId);
  const hoveredTenant = useSceneStore((s) => s.hoveredTenant);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const directory = usePersonaDirectoryDeferred(Boolean(hoveredTenant || selectedPersonaId));
  const hoverKey = hoveredTenant
    ? `${hoveredTenant.buildingId}:${hoveredTenant.householdIndex ?? ""}:${hoveredTenant.businessId ?? ""}`
    : null;

  const resolved = useMemo(() => {
    void citySize;
    void citySketch;
    if (!directory) return null;

    let buildingId: number | undefined;
    let householdIndex: number | undefined;
    let businessId: string | undefined;
    if (hoveredTenant) {
      buildingId = hoveredTenant.buildingId;
      householdIndex = hoveredTenant.householdIndex;
      businessId = hoveredTenant.businessId;
    } else if (selectedPersonaId) {
      const persona = directory.personas.get(selectedPersonaId);
      if (!persona) return null;
      buildingId = persona.homeBuildingId;
      householdIndex = persona.householdIndex;
    }
    if (buildingId === undefined) return null;

    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    const building = buildings.find((b) => b.id === buildingId);
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
    const region =
      businessId !== undefined
        ? regionForBusiness(regions, businessId)
        : householdIndex !== undefined
          ? regionForHousehold(regions, householdIndex)
          : undefined;
    if (!region) return null;
    void district;
    return { building, region, color: brighten(SELECT_OUTLINE_COLOR) };
    // reads hoveredTenant but keyed by hoverKey to avoid identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverKey, selectedPersonaId, directory, masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  if (!resolved) return null;
  return <UnitBox building={resolved.building} region={resolved.region} color={resolved.color} opacity={0.62} />;
}
