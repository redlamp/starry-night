"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";
import { buildRoadGeometry, type RoadPoly } from "@/lib/seed/roadMesh";

// In-scene road surfaces: smooth asphalt ribbons (round-joined vector strokes)
// along the highway + arterial + street network. One merged BufferGeometry per
// TIER so each can be tinted independently: when a tier's planning toggle is on
// the ribbon switches from asphalt to the tier colour (instead of the old thin,
// hardware-1px line overlay that read as pixelated). Tiers stack street < art <
// highway via renderOrder; depthWrite off so none occlude buildings/lights.
const ROAD_Y = 0.05;
const ASPHALT = "#0d1018";
const HIGHWAY_COLOR = "#f0c850"; // gold
const ARTERIAL_COLOR = "#7fa8d0"; // blue
const STREET_COLOR = "#5fb89e"; // teal

export function Roads({ masterSeed }: { masterSeed: string }) {
  const showHighways = useSceneStore((s) => s.cityPlanning.showHighways);
  const showArterials = useSceneStore((s) => s.cityPlanning.showArterials);
  const showStreets = useSceneStore((s) => s.cityPlanning.showStreets);
  const roadsMode = useSceneStore((s) => s.debug.renderModes.roads);
  const setTopologyKind = useSceneStore((s) => s.setTopologyKind);
  const setHighwayCount = useSceneStore((s) => s.setHighwayCount);
  const setArterialCount = useSceneStore((s) => s.setArterialCount);
  const setStreetCount = useSceneStore((s) => s.setStreetCount);

  const { geometries, kind, highwayCount, arterialCount, streetCount } = useMemo(() => {
    const city = generateCity(masterSeed);
    const hwPolys: RoadPoly[] = city.topology.highways.map((h) => ({
      vertices: h.vertices,
      width: h.width,
      closed: h.closed,
    }));
    const artPolys: RoadPoly[] = city.arterials.map((a) => ({
      vertices: a.vertices,
      width: a.width,
      closed: false,
    }));
    const stPolys: RoadPoly[] = city.streets.map((s) => ({
      vertices: s.vertices,
      width: s.width,
      closed: false,
    }));
    return {
      geometries: {
        highways: buildRoadGeometry(hwPolys),
        arterials: buildRoadGeometry(artPolys),
        streets: buildRoadGeometry(stPolys),
      },
      kind: city.topology.kind,
      highwayCount: city.topology.highways.length,
      arterialCount: city.arterials.length,
      streetCount: city.streets.length,
    };
  }, [masterSeed]);

  useEffect(() => setTopologyKind(kind), [kind, setTopologyKind]);
  useEffect(() => setHighwayCount(highwayCount), [highwayCount, setHighwayCount]);
  useEffect(() => setArterialCount(arterialCount), [arterialCount, setArterialCount]);
  useEffect(() => setStreetCount(streetCount), [streetCount, setStreetCount]);

  useEffect(() => {
    return () => {
      geometries.highways.dispose();
      geometries.arterials.dispose();
      geometries.streets.dispose();
    };
  }, [geometries]);

  // Debug "roads" group (Slice B): Hidden drops the whole network; Wireframe
  // renders the ribbon geometry as edges.
  const wireframe = roadsMode === "wireframe";
  // In wireframe each tier strokes in its highlight colour (the same tint the
  // Roads panel toggles apply), regardless of the show toggles — so the network
  // reads by tier on the dark ground.
  return (
    <group visible={roadsMode !== "hidden"}>
      <RoadTier
        geometry={geometries.streets}
        color={wireframe || showStreets ? STREET_COLOR : ASPHALT}
        order={1}
        wireframe={wireframe}
      />
      <RoadTier
        geometry={geometries.arterials}
        color={wireframe || showArterials ? ARTERIAL_COLOR : ASPHALT}
        order={2}
        wireframe={wireframe}
      />
      <RoadTier
        geometry={geometries.highways}
        color={wireframe || showHighways ? HIGHWAY_COLOR : ASPHALT}
        order={3}
        wireframe={wireframe}
      />
    </group>
  );
}

function RoadTier({
  geometry,
  color,
  order,
  wireframe,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  order: number;
  wireframe: boolean;
}) {
  return (
    <mesh geometry={geometry} position={[0, ROAD_Y, 0]} renderOrder={order}>
      {/* Coplanar with the ground → polygonOffset pulls the road's depth toward
          the camera so it wins the depth test (no z-fight moiré). depthWrite off
          so it doesn't occlude buildings/lights. */}
      <meshBasicMaterial
        color={color}
        toneMapped={false}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
        depthWrite={false}
        wireframe={wireframe}
      />
    </mesh>
  );
}
