"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { sharedRoadRevealProgress } from "@/lib/shaders/sharedIntro";
import { cityIdentityKey } from "@/lib/seed/cityIdentity";
import type { CityTier } from "@/lib/seed/topology";

// Advances the road-reveal cascade: 0 at the moment a NEW city's data is ready,
// → 1 over the (tier-scaled) duration. Holds at 1 for a known city. Honors
// `paused` (same contract as TimeTicker). durationSec 0 or reduced-motion →
// snaps to 1 (today's behavior).
const TIER_DURATION_MUL: Record<CityTier, number> = { town: 0.7, city: 1, metro: 1.4 };

// Evaluated once at module load (not inside the component) so it is stable
// across renders and does not run during SSR.
const reducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function RoadRevealTicker({ cityReady }: { cityReady: boolean }) {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  // Key captures every gen input that produces a different city. Changing any
  // field resets elapsed so the cascade replays from 0 when the new city lands.
  const key = cityIdentityKey(masterSeed, cityShape, cityShapeScale, citySize, fieldDeviation);

  const lastKey = useRef<string | null>(null);
  const elapsed = useRef(0);
  // New city: reset DURING render (not in an effect) so no useFrame tick can
  // observe the previous city's elapsed — R3F's rAF loop runs decoupled from
  // React's passive-effect flush, and a stale value here paints the new
  // network fully revealed for a frame before the cascade restarts.
  if (lastKey.current !== key) {
    lastKey.current = key;
    elapsed.current = 0;
  }

  useFrame((_, dt) => {
    const s = useSceneStore.getState();
    const dur = s.roadReveal.durationSec * TIER_DURATION_MUL[s.citySize];
    if (dur <= 0 || reducedMotion) {
      sharedRoadRevealProgress.value = 1;
      return;
    }
    if (!cityReady) {
      // Worker hasn't landed yet — hold the cascade at 0 (nothing visible).
      sharedRoadRevealProgress.value = 0;
      return;
    }
    if (!s.paused) elapsed.current += dt;
    sharedRoadRevealProgress.value = Math.min(1, elapsed.current / dur);
  });

  return null;
}
