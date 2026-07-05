"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { MapPin } from "lucide-react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";

// #87 follow-up: a lucide MapPin marker anchored 5 m above the FOCUSED
// building's roof, rendered via drei <Html> as a crisp 2D icon at constant
// screen size. Same shape as the focal map-pin shown while dragging the camera
// (DreiSceneControls' pinRef): unfilled MapPin size 28 / strokeWidth 2.5, tip
// anchored on the point via translate(-50%,-100%) + transform-origin
// bottom-centre — but TINTED to the building's district colour (matching the
// selection outline + info panel), falling back to #7dd3fc. Kept MOUNTED with
// the icon `display`-toggled (mounting/unmounting drei <Html> flashes at the
// origin for a frame) and parked off-screen when nothing is focused.
const ROOF_GAP_M = 5;
const PARKED: [number, number, number] = [0, -100000, 0];

export function BuildingPin() {
  // Pin marks the FOCUSED building only (double-click / Focus button), not a
  // plain single-click selection.
  const focusedBuildingId = useSceneStore((s) => s.focusedBuildingId);
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);

  const { idToBuilding, districtColor } = useMemo(() => {
    void citySize; // tier/sketch switch is a different city — rebuild the map
    void citySketch;
    const { buildings, districts } = generateCity(masterSeed, cityShape, cityShapeScale);
    return {
      idToBuilding: new Map(buildings.map((b) => [b.id, b])),
      districtColor: new Map(districts.map((d) => [d.id, d.color])),
    };
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch]);

  const building = focusedBuildingId !== null ? idToBuilding.get(focusedBuildingId) : undefined;
  const pos: [number, number, number] = building
    ? [building.x, building.height + ROOF_GAP_M, building.z]
    : PARKED;
  // Tint the pin to the building's district colour (matches the outline + panel).
  const pinColor = (building && districtColor.get(building.districtId)) || "#7dd3fc";

  return (
    <Html position={pos} center={false} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div
        style={{
          transform: "translate(-50%, -100%)",
          transformOrigin: "50% 100%", // tip (bottom centre) sits on the point
          color: pinColor,
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
          display: building ? undefined : "none",
        }}
      >
        <MapPin size={28} strokeWidth={2.5} />
      </div>
    </Html>
  );
}
