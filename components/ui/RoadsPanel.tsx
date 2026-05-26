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

// Roads layer controls (Stage 1 scaffold). Highway toggle + topology readout.
// Arterials + streetlight settings land in PR 3 / PR 4.
export function RoadsSection() {
  const showHighways = useSceneStore((s) => s.cityPlanning.showHighways);
  const topologyKind = useSceneStore((s) => s.cityPlanning.topologyKind);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);

  return (
    <>
      <ToggleRow
        label="Highways"
        on={showHighways}
        onClick={() => setCityPlanning({ showHighways: !showHighways })}
      />
      <div className="text-foreground/70 grid grid-cols-[5rem_1fr] gap-1 font-mono text-xs">
        <div>topology</div>
        <div className="tabular-nums">
          {topologyKind ? (TOPOLOGY_LABELS[topologyKind] ?? topologyKind) : "—"}
        </div>
      </div>
      <p className="text-foreground/45 text-[11px] leading-snug">
        Arterials, local streets, and streetlight planning arrive in later PRs.
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
