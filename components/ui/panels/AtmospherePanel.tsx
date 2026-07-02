"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { Switch } from "@/components/ui/switch";
import { ValueSlider } from "@/components/ui/value-slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function FogSection() {
  const fog = useSceneStore((s) => s.fog);
  const setFog = useSceneStore((s) => s.setFog);
  const haze = useSceneStore((s) => s.haze);
  const setHaze = useSceneStore((s) => s.setHaze);
  const setFogAdjusting = useSceneStore((s) => s.setFogAdjusting);
  const fogBoundsAlways = useSceneStore((s) => s.fogBoundsAlways);
  const setFogBoundsAlways = useSceneStore((s) => s.setFogBoundsAlways);
  // Show the in-world bracket rings while dragging near/far; linger briefly
  // after the last change so the rings don't blink out mid-adjust.
  const adjustTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingAdjusting = useCallback(() => {
    setFogAdjusting(true);
    if (adjustTimeout.current) clearTimeout(adjustTimeout.current);
    adjustTimeout.current = setTimeout(() => setFogAdjusting(false), 1200);
  }, [setFogAdjusting]);
  useEffect(
    () => () => {
      if (adjustTimeout.current) clearTimeout(adjustTimeout.current);
      setFogAdjusting(false);
    },
    [setFogAdjusting],
  );
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-foreground/55 text-[10px] tracking-wide uppercase">Fog</span>
        <Switch
          checked={fog.enabled}
          onCheckedChange={(enabled) => setFog({ enabled })}
          aria-label="Toggle scene fog"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-foreground/55 text-[10px] tracking-wide uppercase">Show bounds</span>
        <Switch
          checked={fogBoundsAlways}
          onCheckedChange={setFogBoundsAlways}
          aria-label="Always show the fog boundary walls"
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">color</span>
        <input
          type="color"
          value={fog.color}
          onChange={(e) => setFog({ color: e.target.value })}
          className="border-foreground/15 h-7 w-12 cursor-pointer rounded border bg-transparent"
          title="Fog color (also drives the scene background)"
        />
        <code className="text-foreground/60 tabular-nums">{fog.color}</code>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">mode</span>
        <Select value={fog.mode} onValueChange={(v) => setFog({ mode: v as typeof fog.mode })}>
          <SelectTrigger
            size="sm"
            className="bg-background/50 text-foreground hover:bg-background/60 w-full"
          >
            <SelectValue placeholder="mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear">linear (near / far)</SelectItem>
            <SelectItem value="exp2">exp² (density)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {fog.mode === "linear" ? (
        <>
          {/* near/far are ABSOLUTE world metres from the camera (world-locked haze).
              Dragging shows the in-world boundary walls (FogBoundsMarkers). */}
          <ValueSlider
            label="near"
            value={fog.near}
            min={0}
            max={20000}
            step={100}
            onChange={(near) => {
              setFog({ near });
              pingAdjusting();
            }}
          />
          <ValueSlider
            label="far"
            value={fog.far}
            min={100}
            max={40000}
            step={100}
            onChange={(far) => {
              setFog({ far });
              pingAdjusting();
            }}
          />
        </>
      ) : (
        <ValueSlider
          label="amount"
          value={fog.density}
          min={0}
          max={0.9}
          step={0.01}
          onChange={(density) => setFog({ density })}
        />
      )}
      <div className="flex items-center justify-between pt-2">
        <span className="text-foreground/55 text-[10px] tracking-wide uppercase">Ground haze</span>
        <Switch
          checked={haze.enabled}
          onCheckedChange={(enabled) => setHaze({ enabled })}
          aria-label="Toggle ground-haze band"
        />
      </div>
      {haze.enabled ? (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-foreground/70 w-14 shrink-0">color</span>
            <input
              type="color"
              value={haze.color}
              onChange={(e) => setHaze({ color: e.target.value })}
              className="border-foreground/15 h-7 w-12 cursor-pointer rounded border bg-transparent"
            />
            <code className="text-foreground/60 tabular-nums">{haze.color}</code>
          </div>
          <ValueSlider
            label="bottom"
            value={haze.bottomY}
            min={-200}
            max={400}
            step={5}
            onChange={(bottomY) => setHaze({ bottomY })}
          />
          <ValueSlider
            label="top"
            value={haze.topY}
            min={0}
            max={800}
            step={5}
            onChange={(topY) => setHaze({ topY })}
          />
          <ValueSlider
            label="strength"
            value={haze.intensity}
            min={0}
            max={2}
            step={0.05}
            onChange={(intensity) => setHaze({ intensity })}
          />
          <ValueSlider
            label="radius"
            value={haze.radius}
            min={500}
            max={6000}
            step={50}
            onChange={(radius) => setHaze({ radius })}
          />
        </>
      ) : null}
    </>
  );
}

// Atmosphere header action (user 2026-06-07): master on/off for the whole
// section — fog AND ground haze together. Checked while either is on; the
// individual switches inside the section still control each independently.
export function AtmosphereToggle() {
  const fogOn = useSceneStore((s) => s.fog.enabled);
  const hazeOn = useSceneStore((s) => s.haze.enabled);
  const setFog = useSceneStore((s) => s.setFog);
  const setHaze = useSceneStore((s) => s.setHaze);
  return (
    <Switch
      checked={fogOn || hazeOn}
      onCheckedChange={(v) => {
        setFog({ enabled: v });
        setHaze({ enabled: v });
      }}
      title="Toggle fog + ground haze together"
      aria-label="Toggle atmosphere"
    />
  );
}
