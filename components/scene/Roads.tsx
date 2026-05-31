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
  const setTopologyKind = useSceneStore((s) => s.setTopologyKind);
  const setArterialCount = useSceneStore((s) => s.setArterialCount);

  const { geometries, kind, arterialCount } = useMemo(() => {
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
      arterialCount: city.arterials.length,
    };
  }, [masterSeed]);

  useEffect(() => setTopologyKind(kind), [kind, setTopologyKind]);
  useEffect(() => setArterialCount(arterialCount), [arterialCount, setArterialCount]);

  useEffect(() => {
    return () => {
      geometries.highways.dispose();
      geometries.arterials.dispose();
      geometries.streets.dispose();
    };
  }, [geometries]);

  return (
    <>
      <RoadTier geometry={geometries.streets} color={showStreets ? STREET_COLOR : ASPHALT} order={1} />
      <RoadTier
        geometry={geometries.arterials}
        color={showArterials ? ARTERIAL_COLOR : ASPHALT}
        order={2}
      />
      <RoadTier
        geometry={geometries.highways}
        color={showHighways ? HIGHWAY_COLOR : ASPHALT}
        order={3}
      />
    </>
  );
}

function RoadTier({
  geometry,
  color,
  order,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  order: number;
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
      />
    </mesh>
  );
}
