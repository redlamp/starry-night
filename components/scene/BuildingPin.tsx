"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { MapPin } from "lucide-react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";

// #87 follow-up: a lucide MapPin marker anchored 5 m above the SELECTED
// building's roof, rendered via drei <Html> as a crisp 2D icon at constant
// screen size. Deliberately IDENTICAL to the focal map-pin shown while dragging
// the camera (DreiSceneControls' pinRef, line ~1694): unfilled MapPin size 28 /
// strokeWidth 2.5, colour #7dd3fc, tip anchored on the point via
// translate(-50%,-100%) + transform-origin bottom-centre. Kept MOUNTED with the
// icon `display`-toggled (mounting/unmounting drei <Html> flashes at the origin
// for a frame) and parked off-screen when nothing is selected.
const ROOF_GAP_M = 5;
const PARKED: [number, number, number] = [0, -100000, 0];

export function BuildingPin() {
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const idToBuilding = useMemo(() => {
    void citySize; // tier/sketch switch is a different city — rebuild the map
    void citySketch;
    const { buildings } = generateCity(masterSeed, cityShape, cityShapeScale);
    return new Map(buildings.map((b) => [b.id, b]));
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  const building = selectedBuildingId !== null ? idToBuilding.get(selectedBuildingId) : undefined;
  const pos: [number, number, number] = building
    ? [building.x, building.height + ROOF_GAP_M, building.z]
    : PARKED;

  return (
    <Html position={pos} center={false} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div
        style={{
          transform: "translate(-50%, -100%)",
          transformOrigin: "50% 100%", // tip (bottom centre) sits on the point
          color: "#7dd3fc",
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
          display: building ? undefined : "none",
        }}
      >
        <MapPin size={28} strokeWidth={2.5} />
      </div>
    </Html>
  );
}
