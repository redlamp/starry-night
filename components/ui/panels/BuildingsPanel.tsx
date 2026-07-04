"use client";

import { useSceneStore, type BuildingTintMode } from "@/lib/state/sceneStore";
import { Switch } from "@/components/ui/switch";
import { ValueSlider } from "@/components/ui/value-slider";
import { SubGroup, ModeSelect } from "./shared";
import { WindowsSection, FacadeSection } from "./WindowsPanel";

// Alphabetised, no "off" (the header switch gates it now, 2026-06-08).
const TINT_MODES = ["archetype", "depth", "district", "height", "landuse", "population"] as const;

// Building debug tint — washes the massing by a category (population, district,
// landuse…). The header switch is the on/off (the retired "off" mode); the
// dropdown remembers the category while off.
export function BuildingTintGroup() {
  const tint = useSceneStore((s) => s.debug.buildingTint);
  const setBuildingTint = useSceneStore((s) => s.setBuildingTint);
  return (
    <SubGroup
      label="Debug Highlight"
      action={
        <Switch
          checked={tint.enabled}
          onCheckedChange={(enabled) => setBuildingTint({ enabled })}
          title="Wash the buildings by the selected category"
        />
      }
    >
      <ModeSelect
        value={tint.mode}
        modes={TINT_MODES}
        onChange={(v) => setBuildingTint({ mode: v as BuildingTintMode })}
      />
      <ValueSlider
        label="intensity"
        value={tint.intensity}
        min={0}
        max={1}
        step={0.05}
        onChange={(intensity) => setBuildingTint({ intensity })}
      />
    </SubGroup>
  );
}

// #69/#87 hover highlight — a PEER group to Debug Highlight (moved out from
// inside it, user 2026-07-04). "Pick Hovered" highlights any building the
// pointer is over (lift + single-instance outline), independent of the
// archetype-icon hover; the sliders tune that lift/dim and the outline width.
// Transient debug state — never saved / copied / shared.
export function HoverHighlightGroup() {
  const hover = useSceneStore((s) => s.debug.hoverHighlight);
  const setHoverHighlight = useSceneStore((s) => s.setHoverHighlight);
  return (
    <SubGroup label="Hover Highlight">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-foreground/70">Pick Hovered</span>
        <Switch
          checked={hover.pick}
          onCheckedChange={(pick) => setHoverHighlight({ pick })}
          title="Pick Hovered"
        />
      </div>
      <ValueSlider
        label="outline"
        value={hover.outline}
        min={0}
        max={8}
        step={0.5}
        onChange={(outline) => setHoverHighlight({ outline })}
      />
      <ValueSlider
        label="lift"
        value={hover.lift}
        min={1}
        max={3}
        step={0.1}
        onChange={(lift) => setHoverHighlight({ lift })}
      />
      <ValueSlider
        label="dim"
        value={hover.dim}
        min={0.2}
        max={1}
        step={0.05}
        onChange={(dim) => setHoverHighlight({ dim })}
      />
    </SubGroup>
  );
}

export function BuildingsSection() {
  const lights = useSceneStore((s) => s.windowLights);
  const setWindowLights = useSceneStore((s) => s.setWindowLights);
  return (
    <>
      <SubGroup
        label="Windows"
        action={
          <Switch
            checked={lights}
            onCheckedChange={setWindowLights}
            title="All window lights on / off (darken the city to debug facades)"
          />
        }
      >
        <WindowsSection />
      </SubGroup>
      <SubGroup label="Facade">
        <FacadeSection />
      </SubGroup>
      {/* Debug Highlight (tint wash) and Hover Highlight are PEER groups
          (2026-07-04, was nested): the tint category wash and the pointer-hover
          building highlight are independent tools. */}
      <BuildingTintGroup />
      <HoverHighlightGroup />
    </>
  );
}
