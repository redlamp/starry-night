import { Scene } from "@/components/scene/Scene";
import { CameraPanel } from "@/components/ui/CameraPanel";
import { CaptureBoot } from "@/components/scene/CaptureBoot";

export default function Page() {
  return (
    <main className="relative h-dvh w-dvw">
      <CaptureBoot />
      <Scene />
      <div className="pointer-events-none absolute inset-0">
        <CameraPanel />
      </div>
    </main>
  );
}
