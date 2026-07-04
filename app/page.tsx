import { Scene } from "@/components/scene/Scene";
import { CameraPanel } from "@/components/ui/CameraPanel";
import { SeedControls } from "@/components/ui/SeedControls";
import { BuildingInfoPanel } from "@/components/ui/BuildingInfoPanel";
import { FpsHud } from "@/components/ui/FpsHud";
import { PerfOverlay } from "@/components/ui/PerfOverlay";
import { CaptureBoot } from "@/components/scene/CaptureBoot";
import { ViewHotkeys } from "@/components/scene/ViewHotkeys";
import { CameraSideView } from "@/components/scene/CameraSideView";
import { ControlsGuide } from "@/components/ui/ControlsGuide";
import { InspectModeButton } from "@/components/ui/InspectModeButton";

export default function Page() {
  return (
    <main className="relative h-dvh w-dvw">
      <CaptureBoot />
      <ViewHotkeys />
      <Scene />
      <div className="pointer-events-none absolute inset-0">
        <CameraPanel />
        <SeedControls />
        {/* #87: single-click building info panel, docked above SeedControls. */}
        <BuildingInfoPanel />
        <FpsHud />
        <PerfOverlay />
        <CameraSideView />
        <ControlsGuide />
        {/* #87 follow-up: inspect-mode toggle, sits just left of the "?" button. */}
        <InspectModeButton />
      </div>
    </main>
  );
}
