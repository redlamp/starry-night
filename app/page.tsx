import { Scene } from "@/components/scene/Scene";
import { CameraPanel } from "@/components/ui/CameraPanel";
import { SeedControls } from "@/components/ui/SeedControls";
import { EntityColumns } from "@/components/ui/columns/EntityColumns";
import { FpsHud } from "@/components/ui/FpsHud";
import { PerfOverlay } from "@/components/ui/PerfOverlay";
import { CaptureBoot } from "@/components/scene/CaptureBoot";
import { ViewHotkeys } from "@/components/scene/ViewHotkeys";
import { CameraSideView } from "@/components/scene/CameraSideView";
import { ControlsGuide } from "@/components/ui/ControlsGuide";
import { ControlDock } from "@/components/ui/ControlDock";
import { DirectoryPrewarm } from "@/components/ui/DirectoryPrewarm";
import { TopDownCompassRose } from "@/components/ui/TopDownCompassRose";
import { ViewModeChip } from "@/components/ui/ViewModeChip";

export default function Page() {
  return (
    <main className="relative h-dvh w-dvw">
      <CaptureBoot />
      <ViewHotkeys />
      {/* Idle staged persona generation (§7.5) — no visual output. */}
      <DirectoryPrewarm />
      <Scene />
      <div className="pointer-events-none absolute inset-0">
        <CameraPanel />
        {/* Entity columns: the Miller-columns drill (district / street /
            building / company / persona) — replaces the old BuildingInfoPanel
            + PersonaPanel pair. Docked bottom-left, above SeedControls. */}
        <EntityColumns />
        {/* Bottom-left HUD stack (user 2026-07-26), bottom → top: Seed, side-view
            diagram, Performance (fps badge and/or the stats overlay — both perf
            modes stack). Each slot collapses when its element is hidden and the
            rest slide down — flex owns the positions, not per-component offsets. */}
        <div className="absolute bottom-3 left-3 z-20 flex flex-col-reverse items-start gap-2">
          <SeedControls />
          <CameraSideView />
          <FpsHud />
          <PerfOverlay />
        </div>
        <ControlsGuide />
        {/* Top-left control dock: City Directory, Inspect, Resume. */}
        <ControlDock />
        <TopDownCompassRose />
        {/* Transient "Skyline View / Standard View" notice on regime change. */}
        <ViewModeChip />
      </div>
    </main>
  );
}
