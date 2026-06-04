"use client";

import { useMemo } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { tensorDistrictField } from "@/lib/seed/cityGen";

// Districts layer controls. Toggle the colour-coded shell overlay and list the
// current seed's districts with their planning character + colour swatch.
export function DistrictsSection() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const showShells = useSceneStore((s) => s.cityPlanning.showDistrictShells);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);

  const citySize = useSceneStore((s) => s.citySize);
  const districts = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must refresh
    return tensorDistrictField(masterSeed).districts;
  }, [masterSeed, citySize]);

  return (
    <>
      <ToggleRow
        label="District shells"
        on={showShells}
        onClick={() => setCityPlanning({ showDistrictShells: !showShells })}
      />
      <div className="flex flex-col gap-1 pt-1">
        {districts.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-xs">
            <span
              className="border-foreground/20 size-3 shrink-0 rounded-sm border"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-foreground/80">{d.displayName}</span>
          </div>
        ))}
      </div>
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
