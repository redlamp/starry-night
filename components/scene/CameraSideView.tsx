"use client";

import { useEffect, useRef, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { CameraDiagram, type CamReadout } from "@/components/scene/CameraDiagram";
import { cameraReadout, deriveReadout } from "@/lib/scene/cameraReadout";
import { cameraCommand } from "@/lib/scene/cameraCommand";
import { tweenProjectionTo } from "@/lib/scene/cameraView";

// DOM overlay that paints the live side-view diagram in the app (Orbit settings → "Diagram").
// DreiSceneControls writes the live pose into a shared object every frame
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
  const cameraModel = useSceneStore((s) => s.cameraModel);
  const [snap, setSnap] = useState<CamReadout>(() => ({ ...cameraReadout }));
  // Live gesture regime under the projection label (review 2026-07-25 1.2): only Cam v3
  // maintains the skyline latch telemetry, so other models get no row at all.
  const [skyline, setSkyline] = useState(false);
  const isV3 = cameraModel === "snv3";
  const sigRef = useRef("");

  // Only the Map model writes the live `cameraReadout` singleton (with the framing gauges); every other
  // model keeps `orbit` + `cameraLive` current, so derive the diagram from those instead.
  const usesSingleton = cameraModel === "map";
  // Drei-* and Fly own the projection (perspective-locked), so don't offer the tap-to-toggle there.
  const projLocked = cameraModel === "dreimap" || cameraModel === "dreicamera" || mode === "fly";

  const active = show && !captureMode;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const r = usesSingleton ? cameraReadout : deriveReadout();
      // Signature of the displayed quantities, rounded as the SVG rounds them — repaint only when one
      // moves a visible amount. blend keeps 2 decimals so a projection tween animates smoothly.
      const sky = isV3 && cameraCommand.liveSkyline;
      const sig = `${Math.round(r.elev)}|${Math.round(r.dist)}|${Math.round(r.focalY)}|${Math.round(r.camY)}|${r.parallel ? 1 : 0}|${Math.round(r.frustumHh)}|${r.blend.toFixed(2)}|${sky ? 1 : 0}`;
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setSnap({ ...r });
        setSkyline(sky);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, usesSingleton, isV3]);

  if (!active) return null;
  return (
    <CameraDiagram
      data={snap}
      mode={mode}
      show
      regime={isV3 && mode === "orbit" ? (skyline ? "skyline" : "standard") : undefined}
      className="relative" // positioned by the page's bottom-left HUD stack (2026-07-26)
      onToggleProjection={
        projLocked
          ? undefined
          : () =>
              tweenProjectionTo(
                useSceneStore.getState().projection === "orthographic"
                  ? "perspective"
                  : "orthographic",
              )
      }
    />
  );
}
