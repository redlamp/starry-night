"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useSceneStore } from "@/lib/state/sceneStore";
import { generateCity } from "@/lib/seed/cityGen";
import { buildRoadGeometry, type RoadPoly } from "@/lib/seed/roadMesh";
import { buildRevealSchedule } from "@/lib/scene/roadReveal";
import { CITY_CENTER } from "@/lib/seed/topology";
import { sharedRoadRevealProgress } from "@/lib/shaders/sharedIntro";
import { roadRevealVertexShader, roadRevealFragmentShader } from "@/lib/shaders/roadReveal";

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
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);

  const { geometries, kind, highwayCount, arterialCount, streetCount } = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must rebuild
    const city = generateCity(masterSeed, cityShape, cityShapeScale);
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
    // Build the reveal schedule once per city (pure function of geometry).
    // CITY_CENTER is the topology gen-space centre used for radial ordering.
    const schedule = buildRevealSchedule(
      hwPolys.map((p) => ({ vertices: p.vertices, closed: p.closed })),
      artPolys.map((p) => ({ vertices: p.vertices })),
      stPolys.map((p) => ({ vertices: p.vertices })),
      CITY_CENTER,
    );
    return {
      geometries: {
        highways: buildRoadGeometry(hwPolys, (p, arc) => schedule.revealAt(0, p, arc)),
        arterials: buildRoadGeometry(artPolys, (p, arc) => schedule.revealAt(1, p, arc)),
        streets: buildRoadGeometry(stPolys, (p, arc) => schedule.revealAt(2, p, arc)),
      },
      kind: city.topology.kind,
      highwayCount: city.topology.highways.length,
      arterialCount: city.arterials.length,
      streetCount: city.streets.length,
    };
  }, [masterSeed, cityShape, cityShapeScale, citySize]);

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
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader: roadRevealVertexShader,
      fragmentShader: roadRevealFragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        // uProgress is the shared singleton by reference — same pattern as
        // InstancedCity.tsx:316 (sharedTime). Do NOT clone via UniformsUtils.
        uProgress: sharedRoadRevealProgress,
        uTipWidth: { value: 0.04 },
      },
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: false,
      // fog and toneMapped are irrelevant to ShaderMaterial (it manages its own
      // output), but set them to match the old meshBasicMaterial intent.
      fog: false,
      toneMapped: false,
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- material is per-mount; color applied imperatively below
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  // Apply colour + wireframe on every render so prop changes take effect without
  // remounting (useMemo deps intentionally empty to avoid re-creating the material).
  material.uniforms.uColor.value.set(color);
  material.wireframe = wireframe;
  return <mesh geometry={geometry} material={material} position={[0, ROAD_Y, 0]} renderOrder={order} />;
}
