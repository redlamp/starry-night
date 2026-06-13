import { Scene } from "@/components/scene/Scene";
import { CameraPanel } from "@/components/ui/CameraPanel";
import { SeedControls } from "@/components/ui/SeedControls";
import { FpsHud } from "@/components/ui/FpsHud";
import { PerfOverlay } from "@/components/ui/PerfOverlay";
import { CaptureBoot } from "@/components/scene/CaptureBoot";
import { ViewHotkeys } from "@/components/scene/ViewHotkeys";

export default function Page() {
  return (
    <main className="relative h-dvh w-dvw">
      <CaptureBoot />
      <ViewHotkeys />
      <Scene />
      <div className="pointer-events-none absolute inset-0">
        <CameraPanel />
        <SeedControls />
        <FpsHud />
        <PerfOverlay />
      </div>
    </main>
  );
}
