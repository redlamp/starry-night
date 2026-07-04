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
  const hover = useSceneStore((s) => s.debug.hoverHighlight);
  const setHoverHighlight = useSceneStore((s) => s.setHoverHighlight);
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
      {/* #69 hover highlight: hovering an archetype icon (Windows > advanced)
          lifts matching buildings, dims the rest, and strokes an outline. These
          tune that lift/dim and the outline width. Transient debug state. */}
      <SubGroup label="Hover Highlight">
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
      {/* Debug Highlight (was "Debug tint", user 2026-07-04): header switch
          gates the tint wash + dropdown picks the category; nested Hover
          Highlight section tunes the #69 archetype-hover lift/dim + outline. */}
      <BuildingTintGroup />
    </>
  );
}
