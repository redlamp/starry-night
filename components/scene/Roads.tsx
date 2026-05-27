"use client";

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { generateTopology } from "@/lib/seed/topology";
import { generateDistricts } from "@/lib/seed/district";
import { generateArterials } from "@/lib/seed/arterials";
import { buildRoadGeometry, type RoadPoly } from "@/lib/seed/roadMesh";

// In-scene road surfaces: dark asphalt ribbons along the highway + arterial
// network, drawn as real ground geometry (not the debug line overlays). One
// merged BufferGeometry → single draw call. Sits just above the ground plane
// and below the planning overlays.
const ROAD_Y = 0.05;

export function Roads({ masterSeed }: { masterSeed: string }) {
  const geometry = useMemo(() => {
    const topo = generateTopology(masterSeed);
    const field = generateDistricts(masterSeed, topo);
    const arterials = generateArterials(masterSeed, topo, field);
    const polys: RoadPoly[] = [
      ...topo.highways.map((h) => ({ vertices: h.vertices, width: h.width, closed: h.closed })),
      ...arterials.map((a) => ({ vertices: a.vertices, width: a.width, closed: false })),
    ];
    return buildRoadGeometry(polys);
  }, [masterSeed]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <mesh geometry={geometry} position={[0, ROAD_Y, 0]}>
      {/* Coplanar with the ground plane → polygonOffset pulls the road's depth
          toward the camera so it wins the depth test consistently (no z-fight
          flicker/moiré). depthWrite off so it doesn't occlude buildings/lights. */}
      <meshBasicMaterial
        color="#0d1018"
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
