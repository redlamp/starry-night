"use client";

import { useSceneStore, DEBUG_WIRE_COLOR } from "@/lib/state/sceneStore";
import { CITY_SCALE } from "@/lib/seed/topology";

// 3 000 m radius disc at City scale (2× the city half-extent). Round footprint
// avoids the visible square corners a plane shows when the orbit camera swings
// around; 48 segments are enough to read as a circle at orbit distance without
// chasing perfection. Far ground still fades into the fog colour (== sky bg)
// so the edge stays invisible against the sky.
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
      />
    </mesh>
  );
}
