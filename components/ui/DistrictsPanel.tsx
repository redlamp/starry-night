"use client";

import { useEffect, useMemo } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { Switch } from "@/components/ui/switch";
import { ValueSlider } from "@/components/ui/value-slider";
import { tensorDistrictField } from "@/lib/seed/cityGen";
import { buildPopulationField } from "@/lib/seed/population";

// Population panel sections (user 2026-06-07): Density (population heat map +
// traffic coupling) + Districts (the original panel, now a sub-group).

// Districts sub-group header action: the shell-overlay switch (user
// 2026-06-07 — lives on the header, not as a body row).
export function DistrictShellsAction() {
  const showShells = useSceneStore((s) => s.cityPlanning.showDistrictShells);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);
  return (
    <Switch
      checked={showShells}
      onCheckedChange={(v) => setCityPlanning({ showDistrictShells: v })}
      title="Toggle the colour-coded district overlay"
      aria-label="Toggle district shells"
    />
  );
}

// District list with planning character + colour swatch. Hovering a row
// highlights that district in the scene (works with the shells off too).
export function DistrictsSection() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const setHighlight = useSceneStore((s) => s.setHighlightDistrictId);

  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  const districts = useMemo(() => {
    void citySize; // tier drives the module-level gen extent (#58) — a switch must refresh
    void citySketch; // a registered sketch is a different city (#40) — likewise
    void fieldDeviation; // deviation scale (#51) — likewise
    return tensorDistrictField(masterSeed).districts;
  }, [masterSeed, citySize, citySketch, fieldDeviation]);

  // Collapsing the group (or panel) mid-hover skips mouseleave — clear on
  // unmount so a highlight can't strand on screen.
  useEffect(() => () => setHighlight(null), [setHighlight]);

  return (
    <div className="flex flex-col gap-1 pt-1">
      {districts.map((d) => (
        <div
          key={d.id}
          className="hover:bg-foreground/10 -mx-1 flex items-center gap-2 rounded px-1 text-xs"
          onMouseEnter={() => setHighlight(d.id)}
          onMouseLeave={() => setHighlight(null)}
        >
          <span
            className="border-foreground/20 size-3 shrink-0 rounded-sm border"
            style={{ backgroundColor: d.color }}
          />
          <span className="text-foreground/80">{d.displayName}</span>
        </div>
      ))}
    </div>
  );
}

// Population density: heat-map overlay toggle, the traffic coupling strength
// (how strongly local population scales each road's car count — highways
// exempt), and a whole-city people-equivalent readout from the same field.
export function DensitySection() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const showHeat = useSceneStore((s) => s.cityPlanning.showPopulationHeat);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);
  // `?? 1` — configs saved before population coupling landed lack the key.
  const popCoupling = useSceneStore((s) => s.traffic.popCoupling ?? 1);
  const setTraffic = useSceneStore((s) => s.setTraffic);

  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  // Cached field (warm once the scene has materialised) — readout is free.
  const total = useMemo(() => {
    void citySize;
    void citySketch;
    void fieldDeviation;
    return buildPopulationField(masterSeed, cityShape, cityShapeScale).total;
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch, fieldDeviation]);

  return (
    <>
      <ToggleRow
        label="Heat map"
        on={showHeat}
        onClick={() => setCityPlanning({ showPopulationHeat: !showHeat })}
      />
      <ValueSlider
        label="traffic coupling"
        value={popCoupling}
        min={0}
        max={1}
        step={0.05}
        onChange={(popCoupling) => setTraffic({ popCoupling })}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-foreground/70">est. population</span>
        <span className="text-foreground/80 font-mono tabular-nums">{fmtPeople(total)}</span>
      </div>
    </>
  );
}

function fmtPeople(n: number): string {
  if (n >= 1e6) return `≈ ${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `≈ ${Math.round(n / 1e3)} k`;
  return `≈ ${Math.round(n)}`;
}

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-foreground/70">{label}</span>
      <Switch checked={on} onCheckedChange={onClick} aria-label={`Toggle ${label}`} />
    </div>
  );
}
