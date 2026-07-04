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

// Star wake runs this many times faster than the ambient 240 s duration
// (DEFAULT_STAR_INTRO) until the first cityReady edge, so the sky is
// visibly waking during an 8-10 s first-visit boot instead of reading dead
// at ~4% progress. 10x ~= an effective 24 s wake, landing ~25-40% by the
// time an 8-10 s boot wait ends (#77 option 1). Ambient feel after the
// edge — and city cascade timing — are untouched.
const BOOT_STAR_INTRO_MULTIPLIER = 10;

// On mount, stars wake immediately (autoPlay, default true — the / boot) so the
// sky isn't dead during the ~8-10 s worker gen. The CITY cascade (windows +
// streetlights) waits for cityReady and restarts on every false→true edge —
// boot AND each regeneration (the timer used to start while the worker was
// still generating, so the city popped in mid-cascade with a band of lights
// already up). The first ready edge skips the star replay (stars already woke
// at mount); later edges (regen) retrigger stars too, so a re-rolled city and
// its sky wake together. Hosts that boot the city already-awake (the /intro Mac
// screen) pass autoPlay={false} and drive replays themselves. Each frame:
// mirrors mode + cycle settings into the shared singletons; on each replay
// stamps sharedIntroStartTime = sharedTime so the city shader can compute
// per-cell wake = startTime + baseline * duration.
export function IntroTicker({
  cityReady,
  autoPlay = true,
}: {
  cityReady: boolean;
  autoPlay?: boolean;
}) {
  const armed = useRef(false);
  const firstReady = useRef(true);
  const lastPlaying = useRef(false);
  const lastProgress = useRef(0);
  // True from mount until the first cityReady edge — the boot wait the star
  // rate boost exists to cover. Never re-armed, so regen edges replay stars
  // at the ambient rate like today.
  const bootBoostActive = useRef(true);

  useEffect(() => {
    if (armed.current || !autoPlay) return;
    armed.current = true;
    // Stars wake immediately so the sky isn't dead during the (now ~8-10 s at
    // the 6 km default) worker gen.
    useSceneStore.getState().playStarIntro();
  }, [autoPlay]);

  // City cascade restarts whenever the buildings (re)materialise — boot AND
  // every regen. Gated by autoPlay so the /intro screen (autoPlay=false, which
  // snaps itself awake) doesn't cascade. The FIRST ready edge skips the star
  // replay (stars already woke at mount); later edges (regen) retrigger stars
  // too, so a re-rolled city and its sky wake together.
  useEffect(() => {
    if (!cityReady || !autoPlay) return;
    const s = useSceneStore.getState();
    s.playIntro();
    if (firstReady.current) {
      firstReady.current = false;
      bootBoostActive.current = false; // boot wait is over; back to ambient rate
    } else s.playStarIntro();
  }, [cityReady, autoPlay]);

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
      const boostedDt =
        autoPlay && bootBoostActive.current ? dt * BOOT_STAR_INTRO_MULTIPLIER : dt;
      const next = Math.min(
        1,
        s.starIntro.progress + boostedDt / Math.max(0.1, s.starIntro.durationSec),
      );
      s.setStarIntroProgress(next);
      sharedStarIntroProgress.value = next;
      if (next >= 1) s.setStarIntroPlaying(false);
    } else {
      sharedStarIntroProgress.value = s.starIntro.progress;
    }
  });

  return null;
}
