"use client";

import { useMemo, useState } from "react";
import { Globe, Monitor, MonitorCog, RotateCcw, Settings } from "lucide-react";
import { IntroScene } from "./IntroScene";
import { IntroFpsBadge } from "./IntroFpsBadge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BwLevels, IntroViewMode, ScreenColorMode } from "./viewMode";

const MODES = [
  { id: "screen", icon: Monitor, label: "Screen — fixed flat view" },
  { id: "snowglobe", icon: Globe, label: "Snow globe — city parallaxes with the camera" },
] as const;

const COLOR_MODES: { id: ScreenColorMode; label: string; tip: string }[] = [
  { id: "bw", label: "B/W", tip: "1-bit black & white, dithered (original Mac)" },
  { id: "grey", label: "Grey", tip: "Greyscale" },
  { id: "mac256", label: "256", tip: "Classic 8-bit palette, dithered" },
  { id: "full", label: "Full", tip: "Full colour" },
];

// Depth locked to B/W for now — flip to restore the selector.
const SHOW_DEPTH_CHIPS = false;

// Screen-settings defaults (the Reset button's target).
const SCREEN_DEFAULTS = {
  threshold: 0.27,
  softness: 0.22,
  glow: 0.8,
  halation: 0.1,
  scanline: 0.25,
  bloom: 0.15,
};

const sliderValue = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-foreground/80 flex items-center justify-between font-mono text-[10px]">
        <span>{label}</span>
        <span className="tabular-nums">{value.toFixed(2)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(sliderValue(v))}
      />
    </div>
  );
}

export function IntroApp() {
  const [mode, setMode] = useState<IntroViewMode>("screen");
  const [colorMode, setColorMode] = useState<ScreenColorMode>("bw");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 1-bit levels: threshold = cut midpoint, softness = dither knee width
  const [threshold, setThreshold] = useState(SCREEN_DEFAULTS.threshold);
  const [softness, setSoftness] = useState(SCREEN_DEFAULTS.softness);
  // phosphor self-emission strength (all depth modes)
  const [glow, setGlow] = useState(SCREEN_DEFAULTS.glow);
  // phosphor light scatter into neighbouring texels (all depth modes)
  const [halation, setHalation] = useState(SCREEN_DEFAULTS.halation);
  // raster-row mask, display-time with derivative fade (#71)
  const [scanline, setScanline] = useState(SCREEN_DEFAULTS.scanline);
  // over-the-bezel bloom (post-processing, step 2 of the glow plan)
  const [bloom, setBloom] = useState(SCREEN_DEFAULTS.bloom);

  const resetScreenSettings = () => {
    setThreshold(SCREEN_DEFAULTS.threshold);
    setSoftness(SCREEN_DEFAULTS.softness);
    setGlow(SCREEN_DEFAULTS.glow);
    setHalation(SCREEN_DEFAULTS.halation);
    setScanline(SCREEN_DEFAULTS.scanline);
    setBloom(SCREEN_DEFAULTS.bloom);
  };
  const bwLevels = useMemo<BwLevels>(
    () => ({
      lo: Math.max(0, threshold - softness / 2),
      hi: Math.min(1, threshold + softness / 2),
    }),
    [threshold, softness],
  );

  const chip = (active: boolean) =>
    cn(
      "flex h-7 items-center justify-center rounded-md transition-colors",
      active
        ? "bg-foreground text-background"
        : "bg-foreground/10 text-foreground hover:bg-foreground/20",
    );

  return (
    <>
      <IntroScene
        mode={mode}
        colorMode={colorMode}
        bwLevels={bwLevels}
        glow={glow}
        halation={halation}
        scanline={scanline}
        bloom={bloom}
      />
      <IntroFpsBadge />
      <div className="absolute top-3 right-3 z-50 flex flex-col items-end gap-1">
        <TooltipProvider>
          <div className="flex gap-1">
            <div className="flex gap-1 rounded-lg bg-black/55 p-1 backdrop-blur-sm">
              {MODES.map(({ id, icon: Icon, label }) => (
                <Tooltip key={id}>
                  <TooltipTrigger
                    data-testid={`viewport-mode-${id}`}
                    onClick={() => setMode(id)}
                    className={cn(chip(mode === id), "w-7")}
                  >
                    <Icon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <div className="flex rounded-lg bg-black/55 p-1 backdrop-blur-sm">
              <Tooltip>
                <TooltipTrigger
                  data-testid="intro-settings-gear"
                  onClick={() => setSettingsOpen((v) => !v)}
                  className={cn(chip(settingsOpen), "w-7")}
                >
                  <Settings className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="bottom">Screen settings</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {settingsOpen && (
            <div className="flex w-48 flex-col gap-2.5 rounded-lg bg-black/55 p-2.5 backdrop-blur-sm">
              <div className="text-foreground/85 flex items-center gap-2 text-xs font-medium tracking-wide">
                <MonitorCog aria-hidden="true" className="text-foreground/70 size-4" />
                <span>Screen</span>
              </div>
              {SHOW_DEPTH_CHIPS && (
                <div className="flex gap-1">
                  {COLOR_MODES.map(({ id, label, tip }) => (
                    <Tooltip key={id}>
                      <TooltipTrigger
                        data-testid={`viewport-depth-${id}`}
                        onClick={() => setColorMode(id)}
                        className={cn(chip(colorMode === id), "px-2 font-mono text-[10px]")}
                      >
                        {label}
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{tip}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
              {colorMode === "bw" && (
                <>
                  <SliderRow
                    label="Threshold"
                    value={threshold}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={setThreshold}
                  />
                  <SliderRow
                    label="Softness"
                    value={softness}
                    min={0}
                    max={0.5}
                    step={0.01}
                    onChange={setSoftness}
                  />
                </>
              )}
              <SliderRow label="Glow" value={glow} min={0} max={2} step={0.05} onChange={setGlow} />
              <SliderRow
                label="Halation"
                value={halation}
                min={0}
                max={2}
                step={0.05}
                onChange={setHalation}
              />
              <SliderRow
                label="Scanlines"
                value={scanline}
                min={0}
                max={1}
                step={0.01}
                onChange={setScanline}
              />
              <SliderRow
                label="Bloom"
                value={bloom}
                min={0}
                max={3}
                step={0.05}
                onChange={setBloom}
              />
              <Button
                size="xs"
                variant="outline"
                data-testid="screen-settings-reset"
                onClick={resetScreenSettings}
                className="mt-0.5"
              >
                <RotateCcw className="size-3" />
                Reset
              </Button>
            </div>
          )}
        </TooltipProvider>
      </div>
    </>
  );
}
