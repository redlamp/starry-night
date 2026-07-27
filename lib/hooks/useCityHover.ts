"use client";

import { useEffect } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";

// Hover-to-highlight for the entity cards (user 2026-07-27: "across cards, when
// hovering items in the list, we should highlight their related element on the
// city grid"). One rule everywhere — a row highlights what CLICKING it would
// open: a district traces its border, a road draws its polyline, a building
// gets a cage, a person/company also lights their unit inside it.
//
// Handlers read the store through getState(), so a card that only WRITES hover
// state takes no subscription and doesn't re-render when the highlight moves.
// The hook clears every channel on unmount: drilling into a row destroys the
// list mid-hover, and a stuck highlight has nothing pointing at it.

export type HoverProps = {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

function clearAll(): void {
  const s = useSceneStore.getState();
  if (s.hoverDistrictId !== null) s.setHoverDistrictId(null);
  if (s.hoverRoadId !== null) s.setHoverRoadId(null);
  if (s.hoverBuildingId !== null) s.setHoverBuildingId(null);
  if (s.hoveredTenant !== null) s.setHoveredTenant(null);
}

export type CityHover = {
  district: (districtId: string) => HoverProps;
  road: (roadId: string) => HoverProps;
  building: (buildingId: number) => HoverProps;
  /** A company: cage its building AND light its unit on the facade. */
  company: (buildingId: number, businessId: string) => HoverProps;
  /** A person: cage their home building AND light their household's unit. */
  persona: (homeBuildingId: number, householdIndex: number) => HoverProps;
  clear: () => void;
};

export function useCityHover(): CityHover {
  // Clicking a row both sets a highlight and swaps the card. React may REUSE
  // the card component for the new entity (same type, new id), so unmount
  // cleanup alone can strand the highlight — clear on every column change too.
  const columnPath = useSceneStore((s) => s.columnPath);
  const columnCursor = useSceneStore((s) => s.columnCursor);
  useEffect(() => {
    void columnPath;
    void columnCursor;
    return clearAll;
  }, [columnPath, columnCursor]);
  return HOVER;
}

// Module-level singleton — the handlers close over nothing but their arguments,
// so there's no per-render identity churn for React to chase.
const HOVER: CityHover = {
  district: (districtId) => ({
    onMouseEnter: () => useSceneStore.getState().setHoverDistrictId(districtId),
    onMouseLeave: () => useSceneStore.getState().setHoverDistrictId(null),
  }),
  road: (roadId) => ({
    onMouseEnter: () => useSceneStore.getState().setHoverRoadId(roadId),
    onMouseLeave: () => useSceneStore.getState().setHoverRoadId(null),
  }),
  building: (buildingId) => ({
    onMouseEnter: () => useSceneStore.getState().setHoverBuildingId(buildingId),
    onMouseLeave: () => useSceneStore.getState().setHoverBuildingId(null),
  }),
  company: (buildingId, businessId) => ({
    onMouseEnter: () => {
      const s = useSceneStore.getState();
      s.setHoverBuildingId(buildingId);
      s.setHoveredTenant({ buildingId, businessId });
    },
    onMouseLeave: () => {
      const s = useSceneStore.getState();
      s.setHoverBuildingId(null);
      s.setHoveredTenant(null);
    },
  }),
  persona: (homeBuildingId, householdIndex) => ({
    onMouseEnter: () => {
      const s = useSceneStore.getState();
      s.setHoverBuildingId(homeBuildingId);
      s.setHoveredTenant({ buildingId: homeBuildingId, householdIndex });
    },
    onMouseLeave: () => {
      const s = useSceneStore.getState();
      s.setHoverBuildingId(null);
      s.setHoveredTenant(null);
    },
  }),
  clear: clearAll,
};
