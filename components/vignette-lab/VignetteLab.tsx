"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useSceneStore } from "@/lib/state/sceneStore";
import { VignettePlayer } from "./VignettePlayer";

// The real city Scene owns its own <Canvas> (WebGL) — dynamic + ssr:false
// like the other lab routes, so Next never tries to render it on the server.
const Scene = dynamic(() => import("@/components/scene/Scene").then((m) => m.Scene), {
  ssr: false,
});

// `?seed=` (query) or `#seed=` (hash) — same two sources CaptureBoot reads,
// re-read locally here rather than mounting CaptureBoot itself: CaptureBoot
// also wires ?cam=, ?capture=, and live-view-link URL sync, all of which
// would fight VignettePlayer's OWN drive of cameraIntent every frame.
function readUrlSeed(): string | null {
  const query = new URLSearchParams(window.location.search).get("seed");
  if (query) return query;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const fromHash = new URLSearchParams(hash).get("seed");
  return fromHash ? decodeURIComponent(fromHash) : null;
}

export function VignetteLab() {
  useEffect(() => {
    const seed = readUrlSeed();
    if (seed) useSceneStore.getState().setSeed(seed);
  }, []);

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-black">
      <Scene />
      <div className="pointer-events-none absolute inset-0">
        <VignettePlayer />
      </div>
    </main>
  );
}
