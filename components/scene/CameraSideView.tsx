"use client";

import { useEffect, useRef, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CameraDiagram, type CamReadout } from "@/components/scene/CameraDiagram";
import { cameraReadout } from "@/lib/scene/cameraReadout";
import { tweenProjectionTo } from "@/lib/scene/cameraView";

// DOM overlay that paints the live side-view diagram in the app (Orbit settings → "side-view
// diagram"). DreiSceneControls writes the live pose into a shared object every frame
// (lib/scene/cameraReadout); this self-drives a rAF loop and snapshots into React state ONLY when a
// displayed value changes — so the SVG repaints at display rate without re-rendering the scene or
// the settings panel. Mirrors the lab's LabHud (wiki/notes/camera-lab-test-plan → "ref-backed HUD").
//
// Sits above the seed bar (which owns bottom-left); pointer-events stay off except the projection
// label (a tap target that morphs persp ↔ ortho — the mobile-friendly twin of the P key).
export function CameraSideView() {
  const show = useSceneStore((s) => s.showSideView);
  const captureMode = useSceneStore((s) => s.captureMode);
  const mode = useSceneStore((s) => s.cameraMode);
  const [snap, setSnap] = useState<CamReadout>(() => ({ ...cameraReadout }));
  const sigRef = useRef("");

  const active = show && !captureMode;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const r = cameraReadout;
      // Signature of the displayed quantities, rounded as the SVG rounds them — repaint only when one
      // moves a visible amount. blend keeps 2 decimals so a projection tween animates smoothly.
      const sig = `${Math.round(r.elev)}|${Math.round(r.dist)}|${Math.round(r.focalY)}|${Math.round(r.camY)}|${r.parallel ? 1 : 0}|${Math.round(r.frustumHh)}|${r.blend.toFixed(2)}`;
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setSnap({ ...r });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;
  return (
    <CameraDiagram
      data={snap}
      mode={mode}
      show
      className="bottom-16 left-3 z-10"
      onToggleProjection={() =>
        tweenProjectionTo(
          useSceneStore.getState().projection === "orthographic" ? "perspective" : "orthographic",
        )
      }
    />
  );
}
