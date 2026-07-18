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
        <SeedControls />
        {/* Entity columns: the Miller-columns drill (district / street /
            building / company / persona) — replaces the old BuildingInfoPanel
            + PersonaPanel pair. Docked bottom-left, above SeedControls. */}
        <EntityColumns />
        <FpsHud />
        <PerfOverlay />
        <CameraSideView />
        <ControlsGuide />
        {/* Top-left control dock: City Directory, Inspect, Resume. */}
        <ControlDock />
        <TopDownCompassRose />
      </div>
    </main>
  );
}
