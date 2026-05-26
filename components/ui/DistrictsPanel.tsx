"use client";

import { useSceneStore } from "@/lib/state/sceneStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Districts layer controls (Stage 1 scaffold). District shells + colour-coded
// fills are wired in PR 2; this scaffold establishes the panel + toggle slot.
export function DistrictsSection() {
  const showShells = useSceneStore((s) => s.cityPlanning.showDistrictShells);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);

  return (
    <>
      <ToggleRow
        label="District shells"
        on={showShells}
        onClick={() => setCityPlanning({ showDistrictShells: !showShells })}
        disabled
      />
      <p className="text-foreground/45 text-[11px] leading-snug">
        Colour-coded district shells derive from the highway network in PR 2.
      </p>
    </>
  );
}

function ToggleRow({
  label,
  on,
  onClick,
  disabled,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className={cn("text-foreground/70", disabled && "opacity-50")}>{label}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
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
