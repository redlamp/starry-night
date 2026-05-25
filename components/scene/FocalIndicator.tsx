"use client";

import { Html } from "@react-three/drei";
import { useSceneStore } from "@/lib/state/sceneStore";

// Screen-space crosshair anchored to the world position of the orbit focal
// point: (centerX, lookAtY, centerZ). drei's <Html center> projects the world
// point to screen px and positions the DOM element there each frame, so the
// indicator never scales with distance — always the same on-screen size.
//
// Visible when (mode === orbit) AND showFocalIndicator is on. Brightens while
// the user is RMB-dragging the focal Y so they get unambiguous feedback.
export function FocalIndicator() {
  const mode = useSceneStore((s) => s.cameraMode);
  const show = useSceneStore((s) => s.showFocalIndicator);
  const centerX = useSceneStore((s) => s.orbit.centerX);
  const centerZ = useSceneStore((s) => s.orbit.centerZ);
  const lookAtY = useSceneStore((s) => s.orbit.lookAtY);
  const focalDragging = useSceneStore((s) => s.focalDragging);

  if (mode !== "orbit" || !show) return null;

  return (
    <Html
      position={[centerX, lookAtY, centerZ]}
      center
      zIndexRange={[100, 0]}
      pointerEvents="none"
    >
      <div
        style={{
          opacity: focalDragging ? 1 : 0.45,
          transition: "opacity 120ms ease-out",
          pointerEvents: "none",
        }}
      >
        <svg width={56} height={56} viewBox="0 0 56 56" className="block">
          <circle
            cx={28}
            cy={28}
            r={14}
            fill="none"
            stroke="#7dd3fc"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
          <circle cx={28} cy={28} r={2} fill="#7dd3fc" />
          <line x1={28} y1={2} x2={28} y2={14} stroke="#7dd3fc" strokeWidth={1.5} />
          <line x1={28} y1={42} x2={28} y2={54} stroke="#7dd3fc" strokeWidth={1.5} />
          <line x1={2} y1={28} x2={14} y2={28} stroke="#7dd3fc" strokeWidth={1.5} />
          <line x1={42} y1={28} x2={54} y2={28} stroke="#7dd3fc" strokeWidth={1.5} />
        </svg>
      </div>
    </Html>
  );
}
