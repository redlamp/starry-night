"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { ARCHETYPE_ORDER, type Archetype } from "@/lib/seed/cityGen";
import { cn } from "@/lib/utils";
import {
  Building,
  Building2,
  Home,
  Hotel,
  LayoutGrid,
  RadioTower,
  TowerControl,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RangeSlider, ValueSlider } from "@/components/ui/value-slider";
import { HelpHint } from "@/components/ui/tooltip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const ARCHETYPE_LABELS: Record<Archetype, string> = {
  "low-rise": "Low-rise",
  warehouse: "Warehouse",
  "mid-rise": "Mid-rise",
  "residential-tower": "Res. tower",
  "narrow-tower": "Narrow tower",
  "office-block": "Office block",
  spire: "Spire",
};

const ARCHETYPE_ICONS: Record<Archetype | "all", LucideIcon> = {
  all: LayoutGrid,
  "low-rise": Home,
  warehouse: Warehouse,
  "mid-rise": Building,
  "residential-tower": Hotel,
  "narrow-tower": TowerControl,
  "office-block": Building2,
  spire: RadioTower,
};

// Hue-spectrum track for the facade hue range sliders. Explicit stops every
// 60° (rather than `in hsl longer hue`) for broad browser support; lightness
// 50% so the band reads even though facade lightness is far darker.
const HUE_TRACK: CSSProperties = {
  height: 6,
  background:
    "linear-gradient(to right, hsl(0,70%,50%), hsl(60,70%,50%), hsl(120,70%,50%), hsl(180,70%,50%), hsl(240,70%,50%), hsl(300,70%,50%), hsl(360,70%,50%))",
};

export function FacadeSection() {
  const facade = useSceneStore((s) => s.facade);
  const setFacade = useSceneStore((s) => s.setFacade);
  return (
    <>
      <ValueSlider
        label="warm %"
        hint={
          <>
            Wall color. Each building flips a weighted coin (warm %) for its hue family — warm
            masonry vs cool glass — then rolls one hue, saturation + lightness from these ranges
            (lightness skews dark, so pale towers stay rare). Live — no regen.
          </>
        }
        value={facade.warmShare}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setFacade({ warmShare: v })}
      />
      <RangeSlider
        label="warm hue"
        value={[facade.warmHueMin, facade.warmHueMax]}
        min={0}
        max={360}
        step={1}
        trackStyle={HUE_TRACK}
        indicatorClassName="bg-transparent border-y-2 border-white/80"
        onChange={([warmHueMin, warmHueMax]) => setFacade({ warmHueMin, warmHueMax })}
      />
      <RangeSlider
        label="cool hue"
        value={[facade.coolHueMin, facade.coolHueMax]}
        min={0}
        max={360}
        step={1}
        trackStyle={HUE_TRACK}
        indicatorClassName="bg-transparent border-y-2 border-white/80"
        onChange={([coolHueMin, coolHueMax]) => setFacade({ coolHueMin, coolHueMax })}
      />
      <RangeSlider
        label="sat"
        value={[facade.satMin, facade.satMax]}
        min={0}
        max={1}
        step={0.01}
        onChange={([satMin, satMax]) => setFacade({ satMin, satMax })}
      />
      <RangeSlider
        label="light"
        value={[facade.lightMin, facade.lightMax]}
        min={0}
        max={0.5}
        step={0.01}
        onChange={([lightMin, lightMax]) => setFacade({ lightMin, lightMax })}
      />
    </>
  );
}

export function WindowsSection() {
  const mode = useSceneStore((s) => s.windowMode);
  const setWindowMode = useSceneStore((s) => s.setWindowMode);
  const renderMode = useSceneStore((s) => s.windowRenderMode);
  const setWindowRenderMode = useSceneStore((s) => s.setWindowRenderMode);
  const stagger = useSceneStore((s) => s.windowAA.stagger);
  const curtain = useSceneStore((s) => s.windowAA.curtain);
  const curtainW = useSceneStore((s) => s.windowAA.curtainW);
  const setWindowAA = useSceneStore((s) => s.setWindowAA);
  return (
    <>
      <div className="flex items-center gap-1">
        {(["classic", "hybrid"] as const).map((m) => (
          <Button
            key={m}
            variant="secondary"
            size="sm"
            onClick={() => setWindowRenderMode(m)}
            title={m === "classic" ? "Classic far field" : "Hybrid far field"}
            className={cn(
              "flex-1 capitalize",
              renderMode === m
                ? "bg-foreground text-background hover:bg-foreground"
                : "bg-foreground/10 text-foreground hover:bg-foreground/20",
            )}
          >
            {m}
          </Button>
        ))}
        <HelpHint>
          Far-field strategy. Hybrid replaces the distant per-cell wash with each building&apos;s
          mean lit colour and coverage — removes the sub-pixel confetti (#82), validated in
          /window-lab. Classic is the previous look, kept for comparison.
        </HelpHint>
      </div>
      <div className="flex items-center gap-1">
        {(["simple", "advanced"] as const).map((m) => (
          <Button
            key={m}
            variant="secondary"
            size="sm"
            onClick={() => setWindowMode(m)}
            title={
              m === "simple"
                ? "One window size shared by every building"
                : "Window size + grid pitch per building archetype"
            }
            className={cn(
              "flex-1 capitalize",
              mode === m
                ? "bg-foreground text-background hover:bg-foreground"
                : "bg-foreground/10 text-foreground hover:bg-foreground/20",
            )}
          >
            {m}
          </Button>
        ))}
      </div>
      {mode === "simple" ? <WindowsSimpleControls /> : <WindowProfilesSection />}
      <ValueSlider
        label="stagger"
        hint="Share of correlated floors (whole / fractional bands) that switch on in 2–4 column banks instead of all at once."
        value={stagger}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setWindowAA({ stagger: v })}
      />
      <ValueSlider
        label="curtain"
        hint="Share of correlated office towers whose banded floors render as curtain glass — ribbon floors on otherwise normal facades, piers at the corners."
        value={curtain}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setWindowAA({ curtain: v })}
      />
      <ValueSlider
        label="crt width"
        hint="Pane fill on curtain towers. 0.99 keeps hairline mullions; exactly 1.0 merges each lit floor into one continuous window. 1 in 5 curtain towers rolls full regardless."
        value={curtainW}
        min={0.85}
        max={1}
        step={0.01}
        onChange={(v) => setWindowAA({ curtainW: v })}
      />
    </>
  );
}

function WindowsSimpleControls() {
  const ws = useSceneStore((s) => s.windowSimple);
  const setWindowSimple = useSceneStore((s) => s.setWindowSimple);
  return (
    <>
      <RangeSlider
        label="width"
        hint="Each building rolls one window width and height from the ranges (all its windows match); the two rolls are independent."
        value={[ws.wMin, ws.wMax]}
        min={0.1}
        max={1}
        step={0.01}
        onChange={([wMin, wMax]) => setWindowSimple({ wMin, wMax })}
      />
      <RangeSlider
        label="height"
        value={[ws.hMin, ws.hMax]}
        min={0.1}
        max={1}
        step={0.01}
        onChange={([hMin, hMax]) => setWindowSimple({ hMin, hMax })}
      />
    </>
  );
}

export function WindowProfilesSection() {
  const profiles = useSceneStore((s) => s.windowProfiles);
  const setWindowProfile = useSceneStore((s) => s.setWindowProfile);
  const setHighlightArchetype = useSceneStore((s) => s.setHighlightArchetype);
  const [filter, setFilter] = useState<Archetype | "all">("all");
  const shown = filter === "all" ? ARCHETYPE_ORDER : [filter];
  // #69: a fast panel close (or simple/advanced flip) can unmount between
  // pointerenter and pointerleave — never leave a building lifted.
  useEffect(() => () => useSceneStore.getState().setHighlightArchetype(null), []);
  return (
    <>
      <HelpHint>
        Glass-to-cell fraction per building style. Each building rolls one width and one height from
        its archetype&apos;s ranges (all its windows match). Grid spacing is baked per archetype.
      </HelpHint>
      <TooltipProvider>
        <div className="flex items-center gap-0.5">
          {(["all", ...ARCHETYPE_ORDER] as (Archetype | "all")[]).map((id) => {
            const Icon = ARCHETYPE_ICONS[id];
            return (
              <Tooltip key={id}>
                <TooltipTrigger
                  onClick={() => setFilter(id)}
                  onPointerEnter={() => setHighlightArchetype(id === "all" ? null : id)}
                  onPointerLeave={() => setHighlightArchetype(null)}
                  className={cn(
                    "flex h-7 flex-1 items-center justify-center rounded-md transition-colors",
                    filter === id
                      ? "bg-foreground text-background"
                      : "bg-foreground/10 text-foreground hover:bg-foreground/20",
                  )}
                >
                  <Icon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{id === "all" ? "All types" : ARCHETYPE_LABELS[id]}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      {shown.map((arch) => (
        <div key={arch} className="flex flex-col gap-1.5">
          <div className="text-foreground/55 pt-1 text-[10px] tracking-wide uppercase">
            {ARCHETYPE_LABELS[arch]}
          </div>
          <RangeSlider
            label="width"
            value={[profiles[arch].wMin, profiles[arch].wMax]}
            min={0.1}
            max={1}
            step={0.01}
            onChange={([wMin, wMax]) => setWindowProfile(arch, { wMin, wMax })}
          />
          <RangeSlider
            label="height"
            value={[profiles[arch].hMin, profiles[arch].hMax]}
            min={0.1}
            max={1}
            step={0.01}
            onChange={([hMin, hMax]) => setWindowProfile(arch, { hMin, hMax })}
          />
        </div>
      ))}
    </>
  );
}
