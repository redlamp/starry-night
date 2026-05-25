"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import {
  sharedIntroProgress,
  sharedIntroMode,
  sharedIntroCompleteAt,
  sharedBreathingPeriod,
} from "@/lib/shaders/sharedIntro";
import { sharedTime } from "@/lib/shaders/sharedTime";

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
// When progress crosses 1.0 we stamp sharedIntroCompleteAt = sharedTime so the
// shader's post-intro breathing fade-in has a stable t0 reference. Replays
// reset it back to the sentinel so breathing pauses during the new cascade.
export function IntroTicker() {
  const armed = useRef(false);
  const lastPlaying = useRef(false);

  useEffect(() => {
    if (armed.current) return;
    armed.current = true;
    useSceneStore.getState().playIntro();
  }, []);

  useFrame((_, dt) => {
    const s = useSceneStore.getState();
    sharedIntroMode.value = MODE_TO_IDX[s.intro.mode] ?? 0;
    sharedBreathingPeriod.value = s.intro.breathingPeriodSec;

    // Replay started — pause breathing until the new intro completes.
    if (s.intro.playing && !lastPlaying.current) {
      sharedIntroCompleteAt.value = 1e9;
    }
    lastPlaying.current = s.intro.playing;

    if (s.intro.playing) {
      const next = Math.min(1, s.intro.progress + dt / Math.max(0.1, s.intro.durationSec));
      s.setIntroProgress(next);
      sharedIntroProgress.value = next;
      if (next >= 1) {
        s.setIntroPlaying(false);
        sharedIntroCompleteAt.value = sharedTime.value;
      }
    } else {
      sharedIntroProgress.value = s.intro.progress;
      // Edge case: intro started complete (progress=1, never played). Stamp
      // completeAt so breathing engages.
      if (s.intro.progress >= 1 && sharedIntroCompleteAt.value > 1e8) {
        sharedIntroCompleteAt.value = sharedTime.value;
      }
    }
  });

  return null;
}
