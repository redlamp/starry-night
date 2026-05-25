"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { sharedIntroProgress, sharedIntroMode } from "@/lib/shaders/sharedIntro";

const MODE_TO_IDX: Record<string, number> = {
  random: 0,
  district: 1,
  "outside-in": 2,
  "far-to-near": 3,
  "inside-out": 4,
};

// Auto-fires playIntro on first mount; thereafter the panel button drives replays.
// Each frame: advances progress toward 1 when playing; mirrors progress + mode
// into the shared singletons consumed by the city + streetlights shaders.
export function IntroTicker() {
  const armed = useRef(false);

  useEffect(() => {
    if (armed.current) return;
    armed.current = true;
    useSceneStore.getState().playIntro();
  }, []);

  useFrame((_, dt) => {
    const s = useSceneStore.getState();
    sharedIntroMode.value = MODE_TO_IDX[s.intro.mode] ?? 0;

    if (s.intro.playing) {
      const next = Math.min(1, s.intro.progress + dt / Math.max(0.1, s.intro.durationSec));
      s.setIntroProgress(next);
      sharedIntroProgress.value = next;
      if (next >= 1) s.setIntroPlaying(false);
    } else {
      sharedIntroProgress.value = s.intro.progress;
    }
  });

  return null;
}
