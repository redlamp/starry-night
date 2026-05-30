"use client";

import { useCallback, useEffect, useState } from "react";
import { useSceneStore } from "@/lib/state/sceneStore";
import { randomSeed } from "@/lib/seed/rng";

/**
 * User-facing M4 seed control. Bottom-left overlay.
 *
 * - Shows current seed
 * - Copy shareable URL (with `#seed=` hash)
 * - Regenerate to a fresh random seed
 *
 * Distinct from the dev `seed` row inside CameraPanel, which is a quick
 * inline editor. This overlay is the one you'd point a non-technical
 * user at.
 */
export function SeedControls() {
  const seed = useSceneStore((s) => s.masterSeed);
  const setSeed = useSceneStore((s) => s.setSeed);
  const captureMode = useSceneStore((s) => s.captureMode);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

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
    <div className="group pointer-events-auto absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-xs text-white opacity-40 backdrop-blur transition-opacity duration-200 hover:opacity-100">
      <span className="text-white/50">seed</span>
      <code className="rounded bg-white/10 px-2 py-0.5 font-mono text-white">{seed}</code>
      <button
        onClick={onCopy}
        className={`hidden rounded px-2 py-0.5 text-xs group-hover:inline-flex ${
          copied ? "bg-emerald-400/80 text-black" : "bg-white/10 hover:bg-white/20"
        }`}
        title="Copy shareable URL"
      >
        {copied ? "Copied" : "Copy URL"}
      </button>
      <button
        onClick={() => setSeed(randomSeed())}
        className="hidden rounded bg-white/10 px-2 py-0.5 hover:bg-white/20 group-hover:inline-flex"
        title="Generate new random seed"
      >
        Regenerate
      </button>
    </div>
  );
}
