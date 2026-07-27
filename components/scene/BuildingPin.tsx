"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { Cone, MapPin, Search } from "lucide-react";
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
//
// Cone quick-toggle (user 2026-07-27): a small button to the RIGHT of the pin
// (absolutely positioned so the pin itself stays centred on the anchor). A
// two-zone camera swap: cone icon = "Show Connections" (enter cone mode, the
// camera frames the arc set); once in cone mode it becomes a magnifier =
// "Show Building" (leave cone mode, the camera frames the building). The
// framing itself runs centrally in EntityColumns' cone-toggle effect, so the
// card's Follow button behaves identically.
const ROOF_GAP_M = 5;
const PARKED: [number, number, number] = [0, -100000, 0];

export function BuildingPin() {
  // Pin anchors to the focused building, falling back to the SELECTED one
  // (user 2026-07-27: clicking another building used to vanish the pin +
  // cone — selecting clears the focus marker, so the fallback carries the
  // pin to wherever the user is looking).
  const focusedBuildingId = useSceneStore((s) => s.focusedBuildingId);
  const selectedBuildingId = useSceneStore((s) => s.selectedBuildingId);
  const coneFollow = useSceneStore((s) => s.coneFollow);
  const setConeFollow = useSceneStore((s) => s.setConeFollow);
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

  const anchorId = focusedBuildingId ?? selectedBuildingId;
  const building = anchorId !== null ? idToBuilding.get(anchorId) : undefined;
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
          display: building ? "block" : "none",
          position: "relative", // PIN owns the anchor; the button hangs off its right
        }}
      >
        <MapPin size={28} strokeWidth={2.5} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setConeFollow(!coneFollow); // framing swap handled by EntityColumns' toggle effect
          }}
          aria-label={coneFollow ? "Show Building" : "Show Connections"}
          aria-pressed={coneFollow}
          title={coneFollow ? "Show Building" : "Show Connections"}
          style={{ position: "absolute", left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: 4 }}
          className={
            "pointer-events-auto flex size-6 items-center justify-center rounded-full border shadow-md backdrop-blur-sm " +
            (coneFollow
              ? "border-amber-300/50 bg-amber-950/70 text-amber-300"
              : "border-foreground/15 bg-popover/70 text-foreground/70 hover:text-foreground")
          }
        >
          {coneFollow ? <Search size={14} strokeWidth={2.5} /> : <Cone size={14} strokeWidth={2.5} />}
        </button>
      </div>
    </Html>
  );
}
