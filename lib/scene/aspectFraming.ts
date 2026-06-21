import { useSceneStore } from "@/lib/state/sceneStore";

// Narrow screens (portrait phones) widen the orbit/still framing so the city skyline settles low
// with starry sky above it — a portrait frame otherwise shows only the city's tall centre, which
// fills it edge to edge. The factor multiplies the VERTICAL framing half-height (orthoSize for
// ortho; the effective fov for perspective). 1× at landscape (the authored look), ramping to
// PORTRAIT_FRAMING× at a phone aspect — smooth + capped so tablets / square land in between and
// ultra-tall phones don't over-zoom. User pick 2026-06-14: orthoSize 320 → 480 (1.5×) at ~0.46.
const ASPECT_REF = 1.0; // at/above this aspect: no widening (landscape keeps the authored framing)
const PHONE_ASPECT = 0.46; // ~portrait phone — the full PORTRAIT_FRAMING
const PORTRAIT_FRAMING = 1.5;

function curve(aspect: number): number {
  if (!(aspect > 0) || aspect >= ASPECT_REF) return 1;
  const t = Math.min(1, (ASPECT_REF - aspect) / (ASPECT_REF - PHONE_ASPECT));
  return 1 + (PORTRAIT_FRAMING - 1) * t;
}

// Gated factor: only the still / orbit skyline framing gets the portrait widening. Top-down already
// computes its own city-fit framing (H / min(1, aspect)) and fly is free perspective — both stay 1×
// so they aren't double-adjusted.
export function orbitFramingFactor(aspect: number): number {
  const s = useSceneStore.getState();
  if (s.cameraMode === "fly" || (s.cameraMode === "orbit" && s.orbitRestore !== null)) return 1;
  return curve(aspect);
}
