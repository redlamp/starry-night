"use client";

import { useState } from "react";
import { useSceneStore, type QualityTier, QUALITY_TIERS } from "@/lib/state/sceneStore";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { ValueSlider } from "@/components/ui/value-slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LodControls } from "@/components/ui/RoadsPanel";
import { getLastDeviceFit } from "@/lib/perf/applyDeviceFit";
import { SubGroup } from "./shared";

// AA and LOD are split into separate collapsible SubGroups (user 2026-06-13), to
// match the Streetlights / Traffic / Distance-LOD groups. AA = hardware MSAA on
// the header (off by default; reloads the canvas) + the window-shader edge slider.
export function AntiAliasingSection() {
  const antialias = useSceneStore((s) => s.antialias);
  const setAntialias = useSceneStore((s) => s.setAntialias);
  const wa = useSceneStore((s) => s.windowAA);
  const setWindowAA = useSceneStore((s) => s.setWindowAA);
  return (
    <SubGroup
      label="Anti-Aliasing (AA)"
      action={
        <Switch
          checked={antialias}
          onCheckedChange={(v) => setAntialias(v)}
          title="Hardware MSAA. Off = faster (fill-rate scales with it × DPR²). Reloads the view when toggled."
        />
      }
    >
      <div className="text-foreground/40 text-[10px]">
        MSAA (header) reloads the view; edge AA is live.
      </div>
      <ValueSlider
        label="edge AA"
        value={wa.edge}
        min={0.25}
        max={3}
        step={0.05}
        onChange={(edge) => setWindowAA({ edge })}
      />
    </SubGroup>
  );
}

// Render resolution (device-pixel-ratio) cap. Live — no reload. Cost ∝ DPR², so
// this is the biggest fill-rate lever on HiDPI screens. Auto = the tier's range.
export function ResolutionSection() {
  const dprCap = useSceneStore((s) => s.dprCap);
  const setDprCap = useSceneStore((s) => s.setDprCap);
  const opts = ["auto", "1", "1.25", "1.5", "2"] as const;
  const labelOf = (v: string) => (v === "auto" ? "Auto (tier)" : `${v}×`);
  return (
    <SubGroup label="Resolution (DPR)">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="text-foreground/70 w-14 shrink-0"
          title="Render pixel ratio. Lower = much faster (cost scales with DPR²). Applies instantly."
        >
          dpr
        </span>
        <Select
          value={dprCap == null ? "auto" : String(dprCap)}
          onValueChange={(v) => setDprCap(v === "auto" ? null : Number(v))}
        >
          <SelectTrigger
            size="sm"
            className="bg-background/50 text-foreground hover:bg-background/60 w-full"
          >
            <SelectValue>{(v) => labelOf(String(v))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {opts.map((v) => (
              <SelectItem key={v} value={v}>
                {labelOf(v)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SubGroup>
  );
}

// Level of Detail (LOD) — all LOD in one place (user 2026-06-13): the painted-
// window distance-wash (header toggle: off = full per-cell detail to the horizon)
// + the distance attenuation / per-tile culling consolidated from the Roads panel
// (its own enable, since it's a separate mechanism).
export function LevelOfDetailSection() {
  const wa = useSceneStore((s) => s.windowAA);
  const setWindowAA = useSceneStore((s) => s.setWindowAA);
  const distEnabled = useSceneStore((s) => s.lod.enabled);
  const setLod = useSceneStore((s) => s.setLod);
  return (
    <SubGroup
      label="Level of Detail (LOD)"
      action={
        <Switch
          checked={wa.lodEnabled}
          onCheckedChange={(v) => setWindowAA({ lodEnabled: v })}
          title="Window distance-wash LOD. Off = full per-cell window detail everywhere (crisper far field, slightly more fragment cost)."
        />
      }
    >
      <div className="text-foreground/40 text-[10px]">Window distance-wash (header toggle)</div>
      <ValueSlider
        label="LOD near"
        value={wa.lodNear}
        min={0}
        max={1}
        step={0.01}
        onChange={(lodNear) => setWindowAA({ lodNear })}
      />
      <ValueSlider
        label="LOD range"
        value={wa.lodRange}
        min={0.05}
        max={1}
        step={0.01}
        onChange={(lodRange) => setWindowAA({ lodRange })}
      />
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs">
        <span
          className="text-foreground/70"
          title="Distance attenuation + per-tile culling on / off"
        >
          distance culling
        </span>
        <Switch checked={distEnabled} onCheckedChange={(v) => setLod({ enabled: v })} />
      </div>
      <LodControls />
    </SubGroup>
  );
}

// Quality tier select — the primary Performance control.
export function PerfReadout() {
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const setQualityTier = useSceneStore((s) => s.setQualityTier);
  const setStars = useSceneStore((s) => s.setStars);
  const setQualityUserSet = useSceneStore((s) => s.setQualityUserSet);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground/70 w-14 shrink-0">quality</span>
      <Select
        value={qualityTier}
        onValueChange={(v) => {
          const tier = v as QualityTier;
          setQualityTier(tier);
          setStars({ count: QUALITY_TIERS[tier].starCount });
          // The user picked a tier — lock auto-tuning off (boot fit + runtime
          // AdaptiveQuality both back off once this is set). (#53)
          setQualityUserSet(true);
        }}
      >
        <SelectTrigger
          size="sm"
          className="bg-background/50 text-foreground hover:bg-background/60 w-full"
        >
          <SelectValue placeholder="tier" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(QUALITY_TIERS) as QualityTier[]).map((t) => (
            <SelectItem key={t} value={t}>
              {QUALITY_TIERS[t].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Adaptive quality (header toggle) — auto-fit tier + radius for this GPU on enable,
// then dynamic DPR regression to hold framerate. Drives AdaptiveQuality (the
// ?adaptive URL just sets it). Off by default; verify on real hardware first.
export function AdaptiveGroup() {
  const adaptive = useSceneStore((s) => s.adaptive);
  const setAdaptive = useSceneStore((s) => s.setAdaptive);
  const qualityUserSet = useSceneStore((s) => s.qualityUserSet);
  // The boot device-fit (#53) runs in CaptureBoot, which mounts before this
  // panel, so its result is available by the time the panel reads it. Snapshot
  // it once on mount for the class + reason readout.
  const [fit] = useState(() => getLastDeviceFit());
  return (
    <SubGroup
      label="Adaptive quality"
      action={
        <Switch
          checked={adaptive}
          onCheckedChange={(v) => setAdaptive(v)}
          title="Step DPR down at runtime to hold framerate, and crop the render radius if DPR bottoms out. Verify on real hardware."
        />
      }
    >
      <div className="text-foreground/40 text-[10px]">
        Boot device-fit picks the starting tier + radius for this GPU; the runtime monitor then
        steps DPR to hold fps. Strong GPUs stay full. Picking a tier locks both off.
      </div>
      {fit?.applied && (
        <div className="text-foreground/55 text-[10px] leading-snug">
          Device fit: <span className="text-foreground/80">{fit.cls}</span> → tier{" "}
          <span className="text-foreground/80">{fit.tier}</span>. {fit.reason}
        </div>
      )}
      {qualityUserSet && (
        <div className="text-[10px] text-amber-300/70">
          Tier locked by your pick — auto-fit off.
        </div>
      )}
    </SubGroup>
  );
}

// Stats — header switch shows the detailed on-screen overlay (PerfOverlay: boot
// timeline, long tasks, last gen); the body is the live readout grid.
// Stats — in-panel live readout grid. The detailed FLOATING overlay (boot
// timeline · long tasks · last gen) is the section header's "stats" option.
export function StatsGroup() {
  const perf = useSceneStore((s) => s.perf);
  const qualityTier = useSceneStore((s) => s.qualityTier);
  const dprCap = useSceneStore((s) => s.dprCap);
  const tierCfg = QUALITY_TIERS[qualityTier];
  const fpsColor =
    perf.fps >= 55 ? "text-emerald-300" : perf.fps >= 35 ? "text-amber-300" : "text-rose-400";
  return (
    <SubGroup label="Stats">
      <div className="text-foreground/40 text-[10px]">
        Live readout. Set the header to &quot;stats&quot; for the floating overlay (+ boot timeline · long
        tasks).
      </div>
      <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
        <div>dpr cap</div>
        <div className="tabular-nums">
          {dprCap ?? tierCfg.dprMax}
          {dprCap == null ? " (auto)" : ""}
        </div>
        <div>fps</div>
        <div className={`tabular-nums ${fpsColor}`}>{Math.round(perf.fps)}</div>
        <div>triangles</div>
        <div className="tabular-nums">{perf.triangles.toLocaleString()}</div>
        <div>draw calls</div>
        <div className="tabular-nums">{perf.calls}</div>
        <div>geometries</div>
        <div className="tabular-nums">{perf.geometries}</div>
        <div>textures</div>
        <div className="tabular-nums">{perf.textures}</div>
      </div>
    </SubGroup>
  );
}

// Performance display — 3-step: off / badge (floating FPS badge) / stats (the
// detailed overlay). Mutually exclusive, so only one floating display shows at a
// time. Rendered as a Section header action (sibling of the trigger); buttons
// stopPropagation so a click selects a mode without toggling the accordion.
export function PerfDisplayToggle() {
  const fpsHud = useSceneStore((s) => s.fpsHud);
  const perfStats = useSceneStore((s) => s.perfStats);
  const setFpsHud = useSceneStore((s) => s.setFpsHud);
  const setPerfStats = useSceneStore((s) => s.setPerfStats);
  const active: "off" | "badge" | "stats" = perfStats ? "stats" : fpsHud ? "badge" : "off";
  const apply = (v: "off" | "badge" | "stats") => {
    setFpsHud(v === "badge");
    setPerfStats(v === "stats");
  };
  const opts: Array<{ v: "off" | "badge" | "stats"; title: string }> = [
    { v: "off", title: "No on-screen performance display" },
    { v: "badge", title: "Small floating FPS badge" },
    { v: "stats", title: "Detailed overlay: boot timeline, long tasks, last gen" },
  ];
  return (
    <div
      role="group"
      aria-label="Performance display"
      className="bg-background/40 flex rounded-md p-0.5 text-[11px]"
    >
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          title={o.title}
          onClick={(e) => {
            e.stopPropagation();
            apply(o.v);
          }}
          className={cn(
            "rounded px-1.5 py-0.5 transition-colors",
            active === o.v
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/45 hover:text-foreground/80",
          )}
        >
          {o.v}
        </button>
      ))}
    </div>
  );
}
