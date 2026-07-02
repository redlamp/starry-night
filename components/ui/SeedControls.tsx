"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { randomSeedForReroll } from "@/lib/seed/rng";
import { cn } from "@/lib/utils";

/**
 * User-facing M4 seed control. Bottom-left overlay.
 *
 * - Shows current seed
 * - Copy shareable URL (with `#seed=` hash)
 * - Regenerate to a fresh random seed
 *
 * Collapsed it sits dimmed showing just the seed. It expands (full opacity +
 * action buttons) on mouse hover OR a tap (mobile), then fades back to the basic
 * level 4 s after the mouse leaves / after the tap. Hover handlers are gated to
 * `pointerType === "mouse"` so a touch tap (which also emits synthetic mouse
 * events) doesn't wedge the hover flag and block the auto-collapse.
 */
const COLLAPSE_MS = 5000; // matches the chrome idle-fade (useIdle IDLE_FADE_MS)

export function SeedControls() {
  const seed = useSceneStore((s) => s.masterSeed);
  const setSeed = useSceneStore((s) => s.setSeed);
  const captureMode = useSceneStore((s) => s.captureMode);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hoveringRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  // Drop the pending collapse on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // Collapse back to the dimmed level after the grace delay — but never while
  // the mouse is still hovering the control.
  const scheduleCollapse = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (!hoveringRef.current) setExpanded(false);
    }, COLLAPSE_MS);
  }, []);

  const onCopy = useCallback(async () => {
    if (typeof window === "undefined") return;
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = `${base}#seed=${encodeURIComponent(seed)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Fallback for older browsers / insecure origin: prompt
      window.prompt("Copy this URL:", url);
    }
  }, [seed]);

  if (captureMode) return null;

  return (
    <div
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        hoveringRef.current = true;
        clearTimer();
        setExpanded(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        hoveringRef.current = false;
        scheduleCollapse();
      }}
      // Tap (mobile) or click expands, then auto-collapses after the grace delay.
      // Bubbled clicks from the buttons reset the timer so an action isn't cut off.
      onClick={() => {
        setExpanded(true);
        scheduleCollapse();
      }}
      className={cn(
        "pointer-events-auto absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-xs text-white backdrop-blur transition-opacity duration-200",
        expanded ? "opacity-100" : "opacity-40",
      )}
    >
      <span className="text-white/50">seed</span>
      <code className="rounded bg-white/10 px-2 py-0.5 font-mono text-white">{seed}</code>
      <button
        onClick={onCopy}
        className={cn(
          "rounded px-2 py-0.5 text-xs",
          expanded ? "inline-flex" : "hidden",
          copied ? "bg-emerald-400/80 text-black" : "bg-white/10 hover:bg-white/20",
        )}
        title="Copy shareable URL"
      >
        {copied ? "Copied" : "Copy URL"}
      </button>
      <button
        onClick={() => setSeed(randomSeedForReroll())}
        className={cn(
          "rounded bg-white/10 px-2 py-0.5 hover:bg-white/20",
          expanded ? "inline-flex" : "hidden",
        )}
        title="Generate new random seed"
      >
        Regenerate
      </button>
    </div>
  );
}
