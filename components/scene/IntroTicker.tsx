"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import {
  sharedIntroProgress,
  sharedIntroMode,
  sharedIntroStartTime,
  sharedIntroDuration,
  sharedOffCycle,
  sharedRetrigger,
  sharedCycleJitter,
  sharedStarIntroProgress,
  sharedStarIntroMode,
  sharedStreetlightIntroProgress,
} from "@/lib/shaders/sharedIntro";
import { sharedTime } from "@/lib/shaders/sharedTime";

const MODE_TO_IDX: Record<string, number> = {
  random: 0,
  district: 1,
  "outside-in": 2,
  "far-to-near": 3,
  "inside-out": 4,
};

const STAR_MODE_TO_IDX: Record<string, number> = {
  random: 0,
  "bright-first": 1,
  "horizon-first": 2,
  "zenith-first": 3,
};

// Starts the star intro on first mount; the CITY cascade (windows +
// streetlights) waits for cityReady and restarts on every false→true edge —
// boot AND each regeneration (user 2026-06-08: the timer used to start while
// the worker was still generating, so the city popped in mid-cascade with a
// band of lights already up). Each frame: mirrors mode + cycle settings into
// the shared singletons; on each replay stamps sharedIntroStartTime =
// sharedTime so the city shader can compute per-cell wake = startTime +
// baseline * duration.
export function IntroTicker({ cityReady }: { cityReady: boolean }) {
  const armed = useRef(false);
  const firstReady = useRef(true);
  const lastPlaying = useRef(false);
  const lastProgress = useRef(0);

  useEffect(() => {
    if (armed.current) return;
    armed.current = true;
    // Stars wake immediately so the sky isn't dead during the (now ~8-10 s at
    // the 6 km default) worker gen.
    useSceneStore.getState().playStarIntro();
  }, []);

  // City cascade restarts whenever the buildings (re)materialise — boot AND
  // every regen. The FIRST ready edge skips the star replay (stars already
  // woke at mount); later edges (regen) retrigger stars too (user 2026-06-08),
  // so a re-rolled city and its sky wake together.
  useEffect(() => {
    if (!cityReady) return;
    const s = useSceneStore.getState();
    s.playIntro();
    if (firstReady.current) firstReady.current = false;
    else s.playStarIntro();
  }, [cityReady]);

  useFrame((_, dt) => {
    const s = useSceneStore.getState();
    sharedIntroMode.value = MODE_TO_IDX[s.intro.mode] ?? 0;
    sharedIntroDuration.value = s.intro.durationSec;
    sharedOffCycle.value = s.intro.offCycleSec;
    sharedRetrigger.value = s.intro.retriggerSec;
    sharedCycleJitter.value = s.intro.cycleJitter;
    sharedStarIntroMode.value = STAR_MODE_TO_IDX[s.starIntro.mode] ?? 0;

    // Hold the CITY cascade clock while the worker generates — nothing below
    // consumes it (the city layers are unmounted), and ticking here is exactly
    // what lit half the town before the buildings landed.
    if (cityReady) {
      // Stamp start-time on (a) playing-edge OR (b) progress reset to 0 while
      // already playing (covers the playIntro mid-replay case).
      const playingRose = s.intro.playing && !lastPlaying.current;
      const progressReset = s.intro.progress < 0.001 && lastProgress.current > 0.001;
      if (playingRose || progressReset) {
        sharedIntroStartTime.value = sharedTime.value;
      }
      lastPlaying.current = s.intro.playing;
      lastProgress.current = s.intro.progress;

      if (s.intro.playing) {
        const next = Math.min(1, s.intro.progress + dt / Math.max(0.1, s.intro.durationSec));
        s.setIntroProgress(next);
        sharedIntroProgress.value = next;
        if (next >= 1) s.setIntroPlaying(false);
      } else {
        sharedIntroProgress.value = s.intro.progress;
      }

      // Streetlights wake on their own (shorter) duration, derived from the
      // same timeline: elapsed = progress·durationSec; streetlightProgress =
      // elapsed / streetlightDurationSec, clamped to 1.
      sharedStreetlightIntroProgress.value = Math.min(
        1,
        (sharedIntroProgress.value * s.intro.durationSec) /
          Math.max(0.1, s.intro.streetlightDurationSec),
      );
    }

    // Star intro — progress-driven wake (no cycle), no startTime stamp needed.
    if (s.starIntro.playing) {
      const next = Math.min(1, s.starIntro.progress + dt / Math.max(0.1, s.starIntro.durationSec));
      s.setStarIntroProgress(next);
      sharedStarIntroProgress.value = next;
      if (next >= 1) s.setStarIntroPlaying(false);
    } else {
      sharedStarIntroProgress.value = s.starIntro.progress;
    }
  });

  return null;
}
