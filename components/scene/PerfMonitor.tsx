"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { mark, setDpr, initLongTasks } from "@/lib/perf/bootTrace";

// Triangles jump from a few hundred (sky/stars/ground) to >100k when the city
// InstancedMeshes mount — used to stamp the boot timeline's city-first-frame.
const CITY_TRI_THRESHOLD = 50_000;

export function PerfMonitor() {
  const gl = useThree((s) => s.gl);
  const setPerf = useSceneStore((s) => s.setPerf);
  const frames = useRef(0);
  const elapsed = useRef(0);
  const last = useRef(performance.now());
  const sawFirstFrame = useRef(false);
  const sawCity = useRef(false);

  useEffect(() => {
    initLongTasks();
  }, []);

  useFrame(() => {
    if (!sawFirstFrame.current) {
      sawFirstFrame.current = true;
      mark("first-frame"); // sky/stars painted
    }
    const tris = gl.info.render.triangles;
    if (!sawCity.current && tris > CITY_TRI_THRESHOLD) {
      sawCity.current = true;
      mark("city-first-frame"); // the city's first rendered frame (compile + upload land here)
    }

    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    frames.current += 1;
    elapsed.current += dt;

    if (elapsed.current >= 500) {
      const fps = (frames.current * 1000) / elapsed.current;
      setDpr(gl.getPixelRatio());
      setPerf({
        fps,
        triangles: tris,
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
