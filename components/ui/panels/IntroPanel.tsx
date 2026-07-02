"use client";

import { useSceneStore } from "@/lib/state/sceneStore";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ValueSlider } from "@/components/ui/value-slider";
import { ModeSelect, ProgressRow, SubGroup } from "./shared";

export function IntroSection() {
  const intro = useSceneStore((s) => s.intro);
  const starIntro = useSceneStore((s) => s.starIntro);
  const setIntroDuration = useSceneStore((s) => s.setIntroDuration);
  const setStreetlightDuration = useSceneStore((s) => s.setStreetlightDuration);
  const setIntroMode = useSceneStore((s) => s.setIntroMode);
  const setOffCycle = useSceneStore((s) => s.setOffCycle);
  const setRetrigger = useSceneStore((s) => s.setRetrigger);
  const setCycleJitter = useSceneStore((s) => s.setCycleJitter);
  const setStarIntroDuration = useSceneStore((s) => s.setStarIntroDuration);
  const setStarIntroMode = useSceneStore((s) => s.setStarIntroMode);
  const windowModes = ["random", "district", "outside-in", "inside-out", "far-to-near"] as const;
  const starModes = ["random", "bright-first", "horizon-first", "zenith-first"] as const;
  // Speed presets: Default = the slow ambient wake (windows 240s / stars 240s /
  // streetlights 60s); Fast = a quick 30s/30s cascade with a 10s streetlight
  // wake. Empty when durations have been hand-tuned.
  const speedPreset =
    intro.durationSec === 240 &&
    starIntro.durationSec === 240 &&
    intro.streetlightDurationSec === 60
      ? "default"
      : intro.durationSec === 30 &&
          starIntro.durationSec === 30 &&
          intro.streetlightDurationSec === 10
        ? "fast"
        : "";
  const applyIntroSpeed = (v: string) => {
    if (v === "default") {
      setIntroDuration(240);
      setStarIntroDuration(240);
      setStreetlightDuration(60);
    } else if (v === "fast") {
      setIntroDuration(30);
      setStarIntroDuration(30);
      setStreetlightDuration(10);
    }
  };
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-foreground/40 text-xs tracking-wide uppercase">speed</span>
        <Tabs value={speedPreset} onValueChange={applyIntroSpeed}>
          <TabsList className="w-full">
            <TabsTrigger value="default">Default</TabsTrigger>
            <TabsTrigger value="fast">Fast</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Expandable wake-sequence groups (user 2026-06-08), collapsed by default. */}
      <SubGroup label="Windows">
        <ValueSlider
          label="duration"
          value={intro.durationSec}
          min={1}
          max={480}
          step={1}
          onChange={(durationSec) => setIntroDuration(durationSec)}
        />
        <ValueSlider
          label="off cycle"
          value={intro.offCycleSec}
          min={1}
          max={480}
          step={1}
          onChange={(offCycleSec) => setOffCycle(offCycleSec)}
        />
        <ValueSlider
          label="retrigger"
          value={intro.retriggerSec}
          min={1}
          max={480}
          step={1}
          onChange={(retriggerSec) => setRetrigger(retriggerSec)}
        />
        <ValueSlider
          label="jitter"
          value={intro.cycleJitter}
          min={0}
          max={1}
          step={0.02}
          onChange={(cycleJitter) => setCycleJitter(cycleJitter)}
        />
        <ModeSelect
          value={intro.mode}
          modes={windowModes}
          onChange={(v) => setIntroMode(v as typeof intro.mode)}
        />
        <ProgressRow label="progress" value={intro.progress} />
      </SubGroup>

      <SubGroup label="Stars">
        <ValueSlider
          label="duration"
          value={starIntro.durationSec}
          min={1}
          max={480}
          step={1}
          onChange={(durationSec) => setStarIntroDuration(durationSec)}
        />
        <ModeSelect
          value={starIntro.mode}
          modes={starModes}
          onChange={(v) => setStarIntroMode(v as typeof starIntro.mode)}
        />
        <ProgressRow label="progress" value={starIntro.progress} />
      </SubGroup>

      <SubGroup label="Streetlights">
        <ValueSlider
          label="duration"
          value={intro.streetlightDurationSec}
          min={0.5}
          max={120}
          step={0.5}
          onChange={(streetlightDurationSec) => setStreetlightDuration(streetlightDurationSec)}
        />
      </SubGroup>
    </>
  );
}
