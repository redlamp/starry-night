"use client";

import { useEffect } from "react";
import {
  toggleTopDown,
  toggleFly,
  toggleProjection,
  toggleAllWireframe,
} from "@/lib/scene/cameraView";
import { useSceneStore } from "@/lib/state/sceneStore";
import { isTypingTarget } from "@/lib/utils";

// Keyboard shortcuts, each routed through the same dispatch the Camera panel
// uses so key + panel behave identically:
//   "t" — toggle Top-down on/off (enter from orbit or fly, exit back to orbit).
//   "p" — toggle projection (perspective ⇄ orthographic), same blend tween.
//   "d" — orbit only: flip all render groups to wireframe, then back. (In fly, d
//         is the strafe key, so this is gated to orbit to avoid conflict.)
// Ignored while typing in an input / when a modifier is held.
export function ViewHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k !== "t" && k !== "f" && k !== "p" && k !== "d") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e)) return;
      if (k === "t") toggleTopDown();
      else if (k === "f") toggleFly();
      else if (k === "p") toggleProjection();
      else if (useSceneStore.getState().cameraMode === "orbit") toggleAllWireframe();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
