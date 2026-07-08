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
        {/* Entity columns: the Miller-columns drill (district / street /
            building / company / persona) — replaces the old BuildingInfoPanel
            + PersonaPanel pair. Docked bottom-left, above SeedControls. */}
        <EntityColumns />
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
