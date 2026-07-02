"use client";

import { useSceneStore } from "@/lib/state/sceneStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ValueSlider } from "@/components/ui/value-slider";
import { fmt, ModeSelect } from "./shared";

const MOON_TERM_STYLES = ["crisp", "dither", "cel"] as const;

function MoonReadout() {
  const moon = useSceneStore((s) => s.moonLive);
  return (
    <div className="border-foreground/10 text-foreground/70 mt-1 grid grid-cols-[5rem_1fr] gap-1 border-t pt-1.5 font-mono text-xs">
      <div>moon pos</div>
      <div className="tabular-nums">
        {fmt(moon.position[0], 0)} {fmt(moon.position[1], 0)} {fmt(moon.position[2], 0)}
      </div>
      <div>moon az°</div>
      <div className="tabular-nums">{fmt(moon.azimuthDeg, 1)}</div>
      <div>moon el°</div>
      <div className="tabular-nums">{fmt(moon.elevationDeg, 1)}</div>
      <div>moon dist</div>
      <div className="tabular-nums">{fmt(moon.distance, 0)}</div>
    </div>
  );
}

export function MoonSection() {
  const moon = useSceneStore((s) => s.moon);
  const setMoon = useSceneStore((s) => s.setMoon);
  const halo = useSceneStore((s) => s.moonHalo);
  const setMoonHalo = useSceneStore((s) => s.setMoonHalo);
  const followCamera = useSceneStore((s) => s.moonFollowCamera);
  const setFollowCamera = useSceneStore((s) => s.setMoonFollowCamera);
  return (
    <>
      <div className="flex items-center justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFollowCamera(!followCamera)}
          title="Moon tracks the camera so it stays opposite the city"
          className={cn(
            followCamera
              ? "bg-indigo-400 text-black hover:bg-indigo-400"
              : "bg-foreground/10 text-foreground hover:bg-foreground/20",
          )}
        >
          {followCamera ? "follow cam (on)" : "follow cam"}
        </Button>
      </div>
      <ValueSlider
        label="az°"
        value={moon.azimuthDeg}
        min={0}
        max={360}
        step={1}
        onChange={(azimuthDeg) => setMoon({ azimuthDeg })}
      />
      <ValueSlider
        label="el°"
        value={moon.elevationDeg}
        min={-10}
        max={90}
        step={0.5}
        onChange={(elevationDeg) => setMoon({ elevationDeg })}
      />
      <ValueSlider
        label="dist"
        value={moon.distance}
        min={500}
        max={30000}
        step={50}
        onChange={(distance) => setMoon({ distance })}
      />
      <ValueSlider
        label="size"
        value={moon.radiusRatio}
        min={0.005}
        max={0.2}
        step={0.001}
        onChange={(radiusRatio) => setMoon({ radiusRatio })}
      />
      {/* Phase: auto from the real date, or scrub the synodic cycle manually
          (0 = new, 0.5 = full) for testing/art-direction. */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-foreground/70 w-14 shrink-0">phase</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setMoon({ phaseAuto: !moon.phaseAuto })}
          title="Illuminated fraction from the real date vs. manual scrub"
          className={cn(
            moon.phaseAuto
              ? "bg-indigo-400 text-black hover:bg-indigo-400"
              : "bg-foreground/10 text-foreground hover:bg-foreground/20",
          )}
        >
          {moon.phaseAuto ? "auto (date)" : "manual"}
        </Button>
      </div>
      {!moon.phaseAuto && (
        <ValueSlider
          label="cycle"
          value={moon.phaseManual}
          min={0}
          max={1}
          step={0.01}
          onChange={(phaseManual) => setMoon({ phaseManual })}
        />
      )}
      {/* Stylized terminator: crisp 2-tone / 1-bit dither / cel steps + edge sharpness. */}
      <ModeSelect
        label="edge"
        value={moon.terminatorStyle}
        modes={MOON_TERM_STYLES}
        onChange={(v) => setMoon({ terminatorStyle: v as typeof moon.terminatorStyle })}
      />
      <ValueSlider
        label="sharp"
        value={moon.edgeSharpness}
        min={0}
        max={1}
        step={0.02}
        onChange={(edgeSharpness) => setMoon({ edgeSharpness })}
      />
      <div className="text-foreground/55 pt-1 text-[10px] tracking-wide uppercase">Halo</div>
      <ValueSlider
        label="size×"
        value={halo.radiusMul}
        min={1}
        max={8}
        step={0.05}
        onChange={(radiusMul) => setMoonHalo({ radiusMul })}
      />
      <ValueSlider
        label="core"
        value={halo.innerRadius}
        min={0}
        max={0.3}
        step={0.005}
        onChange={(innerRadius) => setMoonHalo({ innerRadius })}
      />
      <ValueSlider
        label="glow"
        value={halo.intensity}
        min={0}
        max={3}
        step={0.05}
        onChange={(intensity) => setMoonHalo({ intensity })}
      />
      <MoonReadout />
    </>
  );
}
