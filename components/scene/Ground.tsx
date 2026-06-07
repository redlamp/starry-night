"use client";

import * as THREE from "three";
import { useSceneStore, DEBUG_WIRE_COLOR } from "@/lib/state/sceneStore";
import { CITY_CENTER, CITY_TIERS } from "@/lib/seed/topology";

// Ground disc = the CURRENT tier's half-extent (#58) + a 200 m apron, centred
// on CITY_CENTER. User-tuned (2026-06-07): a much larger disc (the old 2×)
// combined with the haze sphere read as planet curvature — "the city on a
// globe" — so the ground now hugs the city and the edge fades into the fog.
// The tier is runtime state, so this follows the store's citySize.
// Round footprint avoids the visible square corners a plane shows when the
// orbit camera swings around; 48 segments are enough to read as a circle at
// orbit distance without chasing perfection. Far ground still fades into the
// fog colour (== sky bg) so the edge stays invisible against the sky.
//
// DoubleSide (#38): in ortho at a low elevation, zooming out drops the bottom of
// the frame below y=0; a single-sided (FrontSide) disc culls its backface there,
// so you see THROUGH the ground to the sky ("under the world"). Rendering both
// sides makes that dip read as dark ground instead. Zero framing change — the
// disc is unchanged from above; only the underside now draws.
export const GROUND_APRON_M = 200;

export function Ground() {
  const mode = useSceneStore((s) => s.debug.renderModes.ground);
  const citySize = useSceneStore((s) => s.citySize);
  const wireframe = mode === "wireframe";
  const radius = CITY_TIERS[citySize] + GROUND_APRON_M;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[CITY_CENTER.x, 0, CITY_CENTER.z]}
      visible={mode !== "hidden"}
    >
      <circleGeometry args={[radius, 48]} />
      <meshBasicMaterial
        color={wireframe ? DEBUG_WIRE_COLOR : "#04060c"}
        toneMapped={false}
        wireframe={wireframe}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
