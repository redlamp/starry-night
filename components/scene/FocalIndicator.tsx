"use client";

import { Html } from "@react-three/drei";
import { useEffect, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";

// Screen-space crosshair anchored to the world position of the orbit focal
// point: (centerX, lookAtY, centerZ). drei's <Html center> projects the world
// point to screen px and positions the DOM element there each frame, so the
// indicator never scales with distance — always the same on-screen size.
//
// Visible in orbit mode only. Dimmed by default, fully opaque while Shift is
// held so the user gets clear feedback during a Shift+drag focal move.
export function FocalIndicator() {
  const mode = useSceneStore((s) => s.cameraMode);
  const centerX = useSceneStore((s) => s.orbit.centerX);
  const centerZ = useSceneStore((s) => s.orbit.centerZ);
  const lookAtY = useSceneStore((s) => s.orbit.lookAtY);
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  if (mode !== "orbit") return null;

  return (
    <Html
      position={[centerX, lookAtY, centerZ]}
      center
      zIndexRange={[100, 0]}
      pointerEvents="none"
    >
      <div
        style={{
          opacity: shiftHeld ? 1 : 0.45,
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
