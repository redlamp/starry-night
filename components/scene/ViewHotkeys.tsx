"use client";

import { useEffect } from "react";
import { toggleTopDown, toggleProjection } from "@/lib/scene/cameraView";

// Keyboard shortcuts, each routed through the same dispatch the Camera panel
// uses so key + panel behave identically:
//   "t" — toggle Top-down on/off (enter from orbit or fly, exit back to orbit).
//   "p" — toggle projection (perspective ⇄ orthographic), same blend tween.
// Ignored while typing in an input / when a modifier is held.
export function ViewHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k !== "t" && k !== "p") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (k === "t") toggleTopDown();
      else toggleProjection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
