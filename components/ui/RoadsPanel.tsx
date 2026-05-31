"use client";

import { useSceneStore } from "@/lib/state/sceneStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOPOLOGY_LABELS: Record<string, string> = {
  crossroads: "Crossroads",
  bypass: "Bypass",
  ring: "Ring",
  "ring-radial": "Ring + radial",
};

// Roads layer controls. Each toggle tints that tier's smooth ground ribbon in
// the scene (highways gold, arterials blue, streets teal) — off = dark asphalt.
export function RoadsSection() {
  const showHighways = useSceneStore((s) => s.cityPlanning.showHighways);
  const showArterials = useSceneStore((s) => s.cityPlanning.showArterials);
  const showStreets = useSceneStore((s) => s.cityPlanning.showStreets);
  const topologyKind = useSceneStore((s) => s.cityPlanning.topologyKind);
  const arterialCount = useSceneStore((s) => s.cityPlanning.arterialCount);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);

  return (
    <>
      <ToggleRow
        label="Highways"
        on={showHighways}
        onClick={() => setCityPlanning({ showHighways: !showHighways })}
      />
      <ToggleRow
        label="Arterials"
        on={showArterials}
        onClick={() => setCityPlanning({ showArterials: !showArterials })}
      />
      <ToggleRow
        label="Streets"
        on={showStreets}
        onClick={() => setCityPlanning({ showStreets: !showStreets })}
      />
      <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
        <div>topology</div>
        <div className="tabular-nums">
          {topologyKind ? (TOPOLOGY_LABELS[topologyKind] ?? topologyKind) : "—"}
        </div>
        <div>arterials</div>
        <div className="tabular-nums">{arterialCount}</div>
      </div>
      <p className="text-foreground/45 text-[11px] leading-snug">
        Streetlights: modern LED — 4000K on highways + arterials, per-zone temperature on local
        streets, with a few variant + failing bulbs.
      </p>
    </>
  );
}

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-foreground/70">{label}</span>
      <Button
        variant="secondary"
        size="sm"
        onClick={onClick}
        className={cn(
          on
            ? "bg-foreground text-background hover:bg-foreground"
            : "bg-foreground/10 text-foreground hover:bg-foreground/20",
        )}
      >
        {on ? "on" : "off"}
      </Button>
    </div>
  );
}
