"use client";

import { useEffect } from "react";
import { toggleTopDown, toggleProjection, toggleAllWireframe } from "@/lib/scene/cameraView";
import { useSceneStore } from "@/lib/state/sceneStore";
import { isTypingTarget } from "@/lib/utils";

// Global view shortcuts, routed through the same dispatch the Camera panel uses so
// key + panel behave identically:
//   "t" — toggle Top-down on/off (enter from orbit or fly, exit back to orbit).
//   "p" — toggle projection (perspective ⇄ orthographic), same blend tween.
//   "f" — flip all render groups to wireframe, then back (debug view).
//   "i" — toggle Inspect mode (building hover-pick + click-select + info panel).
// Ignored while typing in an input, when a modifier is held, or on key auto-repeat.
// (SNCv2 owns WASD/QE fly-through + R reset in its own handler. Fly is now chosen
// from the camera-model list rather than a hotkey, since F is the wireframe toggle.)
export function ViewHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // e.key can be undefined on synthetic dispatches (e.g. component
      // library internals) — never assume it.
      const k = e.key?.toLowerCase();
      if (!k) return;
      if (k !== "t" && k !== "p" && k !== "f" && k !== "i") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e)) return;
      if (k === "t") toggleTopDown();
      else if (k === "p") toggleProjection();
      else if (k === "f") toggleAllWireframe();
      else {
        const s = useSceneStore.getState();
        s.setInspectMode(!s.inspectMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
