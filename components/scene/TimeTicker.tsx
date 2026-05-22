"use client";

import { useFrame } from "@react-three/fiber";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { useSceneStore } from "@/lib/state/sceneStore";

/**
 * Advances `sharedTime.value` each frame (unless `paused`).
 * All building materials read uTime from sharedTime — single source of truth.
 */
export function TimeTicker() {
  const paused = useSceneStore((s) => s.paused);

  useFrame((state, delta) => {
    if (paused) return;
    sharedTime.value += delta;
  });

  return null;
}
