"use client";

import { useEffect, useRef } from "react";
import { useSceneStore, PRESETS } from "@/lib/state/sceneStore";

// Keyboard shortcut: "t" toggles between the Top-down and Default camera
// presets (same intents the Camera panel tweens to). Ignored while typing in an
// input / when a modifier is held.
const TOP_DOWN = PRESETS.find((p) => p.id === "top-down")?.intent;
const DEFAULT = PRESETS.find((p) => p.id === "default")?.intent;

export function ViewHotkeys() {
  const tweenCameraTo = useSceneStore((s) => s.tweenCameraTo);
  const topDown = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "t" && e.key !== "T") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      topDown.current = !topDown.current;
      const intent = topDown.current ? TOP_DOWN : DEFAULT;
      if (intent) tweenCameraTo(intent, 900);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tweenCameraTo]);

  return null;
}
