"use client";

import * as THREE from "three";
import { useSceneStore, DEBUG_WIRE_COLOR } from "@/lib/state/sceneStore";
import { CITY_SCALE } from "@/lib/seed/topology";

// 3 000 m radius disc at City scale (2× the city half-extent). Round footprint
// avoids the visible square corners a plane shows when the orbit camera swings
// around; 48 segments are enough to read as a circle at orbit distance without
// chasing perfection. Far ground still fades into the fog colour (== sky bg)
// so the edge stays invisible against the sky.
//
// DoubleSide (#38): in ortho at a low elevation, zooming out drops the bottom of
// the frame below y=0; a single-sided (FrontSide) disc culls its backface there,
// so you see THROUGH the ground to the sky ("under the world"). Rendering both
// sides makes that dip read as dark ground instead. Zero framing change — the
// disc is unchanged from above; only the underside now draws.
export function Ground() {
  const mode = useSceneStore((s) => s.debug.renderModes.ground);
  const wireframe = mode === "wireframe";
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} visible={mode !== "hidden"}>
      <circleGeometry args={[1500 * CITY_SCALE, 48]} />
      <meshBasicMaterial
        color={wireframe ? DEBUG_WIRE_COLOR : "#04060c"}
        toneMapped={false}
        wireframe={wireframe}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
