"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";

export function PerfMonitor() {
  const gl = useThree((s) => s.gl);
  const setPerf = useSceneStore((s) => s.setPerf);
  const frames = useRef(0);
  const elapsed = useRef(0);
  const last = useRef(performance.now());

  useFrame(() => {
    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    frames.current += 1;
    elapsed.current += dt;

    if (elapsed.current >= 500) {
      const fps = (frames.current * 1000) / elapsed.current;
      setPerf({
        fps,
        triangles: gl.info.render.triangles,
        calls: gl.info.render.calls,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      });
      frames.current = 0;
      elapsed.current = 0;
    }
  });

  return null;
}
