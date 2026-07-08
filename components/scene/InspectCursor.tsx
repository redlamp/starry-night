"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";

// Inspect-mode cursor (user 2026-07-08): a magnifier (zoom-in) over the city
// while inspecting; holding Shift/Ctrl (camera modifiers) or dragging swaps
// back to the movement hand. Implemented as CSS CLASSES on the canvas so the
// existing inline-style cursor writers (the focal-pin scrub in
// DreiSceneControls) still override when active — inline beats class.
// The classes are defined in app/globals.css.

export function InspectCursor() {
  const gl = useThree((s) => s.gl);
  const inspectMode = useSceneStore((s) => s.inspectMode);

  useEffect(() => {
    const dom = gl.domElement;
    if (!inspectMode) {
      dom.classList.remove("inspect-cursor", "inspect-grab");
      return;
    }
    dom.classList.add("inspect-cursor");

    const setGrab = (grab: boolean) => {
      dom.classList.toggle("inspect-grab", grab);
      dom.classList.toggle("inspect-cursor", !grab);
    };
    const onKey = (e: KeyboardEvent) => setGrab(e.shiftKey || e.ctrlKey || e.metaKey);
    const onDown = (e: PointerEvent) => {
      if (e.target === dom) setGrab(true);
    };
    const onUp = (e: PointerEvent) => setGrab(e.shiftKey || e.ctrlKey || e.metaKey);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      dom.classList.remove("inspect-cursor", "inspect-grab");
    };
  }, [gl, inspectMode]);

  return null;
}
