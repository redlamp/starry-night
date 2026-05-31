"use client";

import { useEffect } from "react";
import { toggleViewPreset } from "@/lib/scene/cameraView";

// Keyboard shortcut: "t" toggles between the Top-down and Default camera
// presets. Routes through the same shared dispatch as the Camera panel's
// tween-to tabs, so the animation + end state are identical (orbit swing-arm
// while orbiting, still-mode pose tween otherwise). Ignored while typing in an
// input / when a modifier is held.
export function ViewHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "t" && e.key !== "T") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      toggleViewPreset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
