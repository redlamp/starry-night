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
      label="Debug tint"
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
      {/* Debug tint (moved from Debug View, user 2026-06-08): header switch
          gates the wash, dropdown picks the category. */}
      <BuildingTintGroup />
    </>
  );
}
