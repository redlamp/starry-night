"use client";

import { useEffect } from "react";
import { toggleTopDown } from "@/lib/scene/cameraView";

// Keyboard shortcut: "t" toggles Top-down on/off — the same dispatch the Camera
// panel's mode tabs use (enter top-down from orbit or fly, exit back to orbit).
// Ignored while typing in an input / when a modifier is held.
export function ViewHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "t" && e.key !== "T") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      toggleTopDown();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
