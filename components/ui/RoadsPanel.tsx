"use client";

import { useSceneStore } from "@/lib/state/sceneStore";
import { Switch } from "@/components/ui/switch";

const TOPOLOGY_LABELS: Record<string, string> = {
  crossroads: "Crossroads",
  bypass: "Bypass",
  ring: "Ring",
  "ring-radial": "Ring + radial",
};

// Roads layer controls. "Highlight" tints a tier's ground ribbon in the scene
// (highways gold, arterials blue, streets teal); Streetlights + Traffic toggle
// the light layers. Traffic's own controls render right after this (CameraPanel).
export function RoadsSection() {
  const showHighways = useSceneStore((s) => s.cityPlanning.showHighways);
  const showArterials = useSceneStore((s) => s.cityPlanning.showArterials);
  const showStreets = useSceneStore((s) => s.cityPlanning.showStreets);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);
  const showStreetlights = useSceneStore((s) => s.streetlights.enabled);
  const setStreetlights = useSceneStore((s) => s.setStreetlights);

  return (
    <>
      <Subhead>Highlight</Subhead>
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
      <hr className="border-foreground/10" />
      <HeaderRow
        label="Streetlights"
        on={showStreetlights}
        onChange={(v) => setStreetlights({ enabled: v })}
      />
    </>
  );
}

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

function Subhead({ children }: { children: string }) {
  return (
    <div className="text-foreground/60 text-[11px] font-medium tracking-wide uppercase">
      {children}
    </div>
  );
}

// A switch-on-the-header row (matches the Traffic header so both read as
// same-level toggles).
function HeaderRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <span className="text-foreground/60 text-[11px] font-medium tracking-wide uppercase">
        {label}
      </span>
      <Switch checked={on} onCheckedChange={onChange} />
    </div>
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
