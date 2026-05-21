import { Scene } from "@/components/scene/Scene";
import { CameraPanel } from "@/components/ui/CameraPanel";

export default function Page() {
  return (
    <main className="relative h-dvh w-dvw">
      <Scene />
      <div className="pointer-events-none absolute inset-0">
        <CameraPanel />
      </div>
    </main>
  );
}
