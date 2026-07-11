"use client";

import { useEffect, useMemo } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ValueSlider } from "@/components/ui/value-slider";
import { tensorDistrictField } from "@/lib/seed/cityGen";
import { buildPopulationField } from "@/lib/seed/population";
import { MAX_CENTRES } from "@/lib/seed/density";
import { IconTip } from "@/components/ui/columns/EntityColumns";

// Population panel sections (user 2026-06-07): Density (population heat map +
// traffic coupling) + Districts (the original panel, now a sub-group).

// Districts sub-group header action: the shell-overlay switch (user
// 2026-06-07 — lives on the header, not as a body row).
export function DistrictShellsAction() {
  const showShells = useSceneStore((s) => s.cityPlanning.showDistrictShells);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);
  return (
    <IconTip label="District Shells">
      <Switch
        checked={showShells}
        onCheckedChange={(v) => setCityPlanning({ showDistrictShells: v })}
        aria-label="Toggle district shells"
      />
    </IconTip>
  );
}

// Density sub-group header action: the population heat-map switch (user
// 2026-06-08 — moved from a body row, mirrors the Districts shell switch).
export function PopulationHeatAction() {
  const showHeat = useSceneStore((s) => s.cityPlanning.showPopulationHeat);
  const setCityPlanning = useSceneStore((s) => s.setCityPlanning);
  return (
    <IconTip label="Population Heat Map">
      <Switch
        checked={showHeat}
        onCheckedChange={(v) => setCityPlanning({ showPopulationHeat: v })}
        aria-label="Toggle population heat map"
      />
    </IconTip>
  );
}

// District list with planning character + color swatch. Hovering a row
// highlights that district in the scene (works with the shells off too).
export function DistrictsSection() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  // Same setter the City Directory's district headers use (user 2026-07-10) —
  // drives SelectedDistrictOutline, so hovering here reproduces the exact
  // same street-traced outline + boundary fill as hovering the directory.
  const setHoverDistrictId = useSceneStore((s) => s.setHoverDistrictId);
  // Same flag the directory's Districts-header toggle drives (user
  // 2026-07-10) — two homes, one overlay.
  const showBoundaries = useSceneStore((s) => s.showDistrictBoundaries);
  const setShowBoundaries = useSceneStore((s) => s.setShowDistrictBoundaries);

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
  useEffect(() => () => setHoverDistrictId(null), [setHoverDistrictId]);

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-foreground/70">boundaries</span>
        <IconTip label="District Boundaries">
          <Switch
            checked={showBoundaries}
            onCheckedChange={setShowBoundaries}
            aria-label="Toggle district boundaries"
          />
        </IconTip>
      </div>
      {districts.map((d) => (
        <div
          key={d.id}
          className="hover:bg-foreground/10 -mx-1 flex items-center gap-2 rounded px-1 text-xs"
          onMouseEnter={() => setHoverDistrictId(d.id)}
          onMouseLeave={() => setHoverDistrictId(null)}
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

// Population density: traffic coupling strength (how strongly local population
// scales each road's car count — highways exempt), a whole-city
// people-equivalent readout, and the profile authoring sliders. The heat-map
// switch lives on the sub-group HEADER (PopulationHeatAction).
export function DensitySection() {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  // `?? 1` — configs saved before population coupling landed lack the key.
  const popCoupling = useSceneStore((s) => s.traffic.popCoupling ?? 1);
  const setTraffic = useSceneStore((s) => s.setTraffic);

  const committed = useSceneStore((s) => s.densityProfile);
  const setDensityProfile = useSceneStore((s) => s.setDensityProfile);
  // Draft/preview flow (user 2026-06-08): sliders edit a DRAFT; the heat-map
  // overlay previews its field live (no regeneration). Confirm commits the
  // draft (one rebuild); reset discards it.
  const draft = useSceneStore((s) => s.densityProfileDraft);
  const setDraft = useSceneStore((s) => s.setDensityProfileDraft);
  const dp = draft ?? committed;
  const edit = (patch: Partial<typeof committed>) => setDraft({ ...dp, ...patch });
  // Collapsing the group mid-edit must not strand the preview overlay.
  useEffect(() => () => setDraft(null), [setDraft]);

  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const citySketch = useSceneStore((s) => s.citySketch);
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  // Cached field (warm once the scene has materialised) — readout is free.
  // Keyed on the COMMITTED profile: the estimate describes the built city,
  // not the draft being previewed.
  const total = useMemo(() => {
    void citySize;
    void citySketch;
    void fieldDeviation;
    void committed; // population profile (#49) — a different profile is a different city
    return buildPopulationField(masterSeed, cityShape, cityShapeScale).total;
  }, [masterSeed, cityShape, cityShapeScale, citySize, citySketch, fieldDeviation, committed]);

  return (
    <>
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
      {/* Population profile (#49, user 2026-06-08): author the gradient —
          centers radiate, spread/shoulder shape the falloff curve, overlapping
          gradients overflow into each other. Sliders PREVIEW on the heat-map
          overlay (live field + band contours, no rebuild); Confirm commits
          and regenerates, Reset discards. */}
      <div className="text-foreground/55 pt-1 text-[11px]">
        profile · previews live, confirm to rebuild
      </div>
      <ValueSlider
        label="centers"
        value={dp.centres}
        min={1}
        max={MAX_CENTRES}
        step={1}
        onChange={(centres) => edit({ centres })}
      />
      <ValueSlider
        label="spread"
        value={dp.spread}
        min={0.6}
        max={1.6}
        step={0.05}
        onChange={(spread) => edit({ spread })}
      />
      <ValueSlider
        label="shoulder"
        value={dp.shoulder}
        min={0.7}
        max={1.5}
        step={0.05}
        onChange={(shoulder) => edit({ shoulder })}
      />
      <ValueSlider
        label="satellites"
        value={dp.satellite}
        min={0.2}
        max={1}
        step={0.05}
        onChange={(satellite) => edit({ satellite })}
      />
      {draft && (
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setDraft(null)}
          >
            reset
          </Button>
          <Button
            size="sm"
            className="h-6 bg-emerald-400 px-2 text-xs text-black hover:bg-emerald-400/90"
            onClick={() => {
              setDensityProfile(draft);
              setDraft(null);
            }}
          >
            confirm
          </Button>
        </div>
      )}
    </>
  );
}

function fmtPeople(n: number): string {
  if (n >= 1e6) return `≈ ${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `≈ ${Math.round(n / 1e3)} k`;
  return `≈ ${Math.round(n)}`;
}
