"use client";

import { useSceneStore } from "@/lib/state/sceneStore";
import { Switch } from "@/components/ui/switch";
import { ValueSlider } from "@/components/ui/value-slider";
import { cn } from "@/lib/utils";

const TOPOLOGY_LABELS: Record<string, string> = {
  crossroads: "Crossroads",
  bypass: "Bypass",
  ring: "Ring",
  "ring-radial": "Ring + radial",
};

// Roads layer controls. "Highlight" tints a tier's ground ribbon in the scene
// (highways gold, arterials blue, streets teal); Streetlights + Traffic toggle
// the light layers. Traffic's own controls render right after this (CameraPanel).
// Master highlight tri-switch — lives in the Roads SECTION HEADER (user
// 2026-06-07: "highlight switch moves up"), so it's reachable without opening
// the section. The per-tier rows below remain the fine-grained controls.
export function RoadHighlightAction() {
  const showHighways = useSceneStore((s) => s.cityPlanning.showHighways);
  const showArterials = useSceneStore((s) => s.cityPlanning.showArterials);
  const showStreets = useSceneStore((s) => s.cityPlanning.showStreets);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);
  const allOn = showHighways && showArterials && showStreets;
  const anyOn = showHighways || showArterials || showStreets;
  const highlightState: TriState = allOn ? "on" : anyOn ? "mixed" : "off";
  return (
    // No text label (user 2026-06-08) — the bare switch, like the other header
    // actions; the aria-label below still names it.
    <TriSwitch
      state={highlightState}
      // Turn all three on, unless all are already on → all off.
      onClick={() => {
        const next = !allOn;
        setCityPlanning({ showHighways: next, showArterials: next, showStreets: next });
      }}
      label="Toggle all road highlights"
    />
  );
}

// The three highlight-tier toggle rows. Rendered inside the Highlight
// sub-group (CameraPanel); the group HEADER carries the master tri-switch
// (RoadHighlightAction).
export function RoadHighlightTiers() {
  const showHighways = useSceneStore((s) => s.cityPlanning.showHighways);
  const showArterials = useSceneStore((s) => s.cityPlanning.showArterials);
  const showStreets = useSceneStore((s) => s.cityPlanning.showStreets);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);
  return (
    <>
      <ToggleRow
        label="Highways"
        on={showHighways}
        onChange={(v) => setCityPlanning({ showHighways: v })}
      />
      <ToggleRow
        label="Arterials"
        on={showArterials}
        onChange={(v) => setCityPlanning({ showArterials: v })}
      />
      <ToggleRow
        label="Streets"
        on={showStreets}
        onChange={(v) => setCityPlanning({ showStreets: v })}
      />
    </>
  );
}

// Distance LOD (#52) — render-only attenuation/culling shared by streetlights +
// traffic. `near`/`far` are the camera-distance ramp (m); past `cull` lights
// are dropped (size 0). `cull` must be ≥ `far`; lower it on weaker GPUs for fps.
export function LodControls() {
  const near = useSceneStore((s) => s.lod.near);
  const far = useSceneStore((s) => s.lod.far);
  const cull = useSceneStore((s) => s.lod.cull);
  const tiles = useSceneStore((s) => s.lod.tiles);
  const setLod = useSceneStore((s) => s.setLod);
  return (
    <>
      {/* #55 per-tile culling — offscreen tiles of buildings/lights/traffic are
          not materialised at all (render-only; off = whole-city draws).
          Inspection tools (grid overlay, freeze, counts): Debug View → Tile culling. */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-foreground/70" title="Visualize: Debug View → Tile culling">
          tile culling
        </span>
        <Switch checked={tiles} onCheckedChange={(v) => setLod({ tiles: v })} />
      </div>
      <ValueSlider
        label="near m"
        value={near}
        min={500}
        max={8000}
        step={100}
        onChange={(v) => setLod({ near: v })}
      />
      <ValueSlider
        label="far m"
        value={far}
        min={1000}
        max={16000}
        step={100}
        onChange={(v) => setLod({ far: v })}
      />
      <ValueSlider
        label="cull m"
        value={cull}
        min={2000}
        max={30000}
        step={500}
        onChange={(v) => setLod({ cull: v })}
      />
    </>
  );
}

export function StreetlightControls() {
  const size = useSceneStore((s) => s.streetlights.size);
  const brightness = useSceneStore((s) => s.streetlights.brightness);
  const setStreetlights = useSceneStore((s) => s.setStreetlights);
  return (
    <>
      <ValueSlider
        label="size"
        value={size}
        min={0.2}
        max={2}
        step={0.05}
        onChange={(v) => setStreetlights({ size: v })}
      />
      <ValueSlider
        label="brightness"
        value={brightness}
        min={0.1}
        max={2}
        step={0.05}
        onChange={(v) => setStreetlights({ brightness: v })}
      />
    </>
  );
}

// ValueSlider now shared from components/ui/value-slider.tsx (base-ui
// number-field stepper + label scrubbing).

// Read-only per-seed readouts — topology + tier counts.
export function CityDetailsSection() {
  const topologyKind = useSceneStore((s) => s.cityPlanning.topologyKind);
  const highwayCount = useSceneStore((s) => s.cityPlanning.highwayCount);
  const arterialCount = useSceneStore((s) => s.cityPlanning.arterialCount);
  const streetCount = useSceneStore((s) => s.cityPlanning.streetCount);
  return (
    <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
      <div>topology</div>
      <div className="tabular-nums">
        {topologyKind ? (TOPOLOGY_LABELS[topologyKind] ?? topologyKind) : "—"}
      </div>
      <div>highways</div>
      <div className="tabular-nums">{highwayCount}</div>
      <div>arterials</div>
      <div className="tabular-nums">{arterialCount}</div>
      <div>streets</div>
      <div className="tabular-nums">{streetCount}</div>
    </div>
  );
}

type TriState = "on" | "off" | "mixed";

// Parent toggle for the three highlight tiers. base-ui Switch is binary, so this
// is a switch-styled tri-state button: "mixed" (some-but-not-all on) centres the
// thumb with a dimmed track.
function TriSwitch({
  state,
  onClick,
  label,
}: {
  state: TriState;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "on" ? true : state === "mixed" ? "mixed" : false}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "focus-visible:border-ring focus-visible:ring-ring/50 relative inline-flex h-[18.4px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-3",
        state === "on" && "bg-primary",
        state === "mixed" && "bg-primary/45",
        state === "off" && "bg-input dark:bg-input/80",
      )}
    >
      <span
        className={cn(
          "bg-background dark:bg-foreground block size-4 rounded-full transition-transform",
          state === "on" && "dark:bg-primary-foreground translate-x-[calc(100%-2px)]",
          state === "mixed" && "translate-x-[7px]",
          state === "off" && "translate-x-0",
        )}
      />
    </button>
  );
}

function ToggleRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
      <span className="text-foreground/70">{label}</span>
      <Switch checked={on} onCheckedChange={onChange} />
    </label>
  );
}
