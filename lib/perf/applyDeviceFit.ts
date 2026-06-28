// Boot-time device fit (#53): on first load, probe the GPU + form factor and
// settle on a sensible starting quality tier, star count, and render radius —
// so a phone doesn't try to render the full city at DPR 3 and a Retina laptop
// doesn't melt at the "high" default. Render-only: tier / DPR / crop never feed
// the seeded generator (cross-crop is a byte-identical subset), so determinism
// is untouched.
//
// GUARDED — this runs once and only when the device's own quality hasn't already
// been decided:
//   - no ?quality= URL override (the explicit escape hatch — CaptureBoot owns it)
//   - no SAVED qualityTier (a returning user who Saved a config keeps their pick)
//   - !qualityUserSet (the user hasn't touched the tier select this session)
// Call it from CaptureBoot's mount effect, AFTER the ?quality= branch.
import { useSceneStore, QUALITY_TIERS, hasSavedQualityTier } from "@/lib/state/sceneStore";
import { probeCaps, suggestTier } from "@/lib/perf/deviceTier";

let didFit = false;
let lastFit: DeviceFitResult | null = null;

// The most recent applyDeviceFit() outcome, for UI readouts (Performance panel
// shows the chosen class + reason). Null until the boot fit has run.
export function getLastDeviceFit(): DeviceFitResult | null {
  return lastFit;
}

export type DeviceFitResult =
  | { applied: false; reason: string }
  | {
      applied: true;
      tier: ReturnType<typeof suggestTier>["tier"];
      cls: ReturnType<typeof suggestTier>["cls"];
      radiusScale: number;
      reason: string;
    };

// Run the boot device-fit. Returns what it did (or why it skipped) so callers /
// tests can assert on it. Idempotent: a second call in the same session no-ops.
export function applyDeviceFit(opts?: { hasQueryQuality?: boolean }): DeviceFitResult {
  if (typeof window === "undefined") return { applied: false, reason: "ssr" };
  if (didFit) return lastFit ?? { applied: false, reason: "already-fitted" };

  const state = useSceneStore.getState();
  const skip = (reason: string): DeviceFitResult => {
    didFit = true;
    return (lastFit = { applied: false, reason });
  };
  if (opts?.hasQueryQuality) return skip("?quality= override present");
  if (state.qualityUserSet) return skip("qualityUserSet");
  if (hasSavedQualityTier()) return skip("saved qualityTier");

  didFit = true;
  const fit = suggestTier(probeCaps(), window.devicePixelRatio || 1);
  state.setQualityTier(fit.tier);
  state.setStars({ count: QUALITY_TIERS[fit.tier].starCount });
  // 1 on strong GPUs = no change / no re-gen (byte-identical full city).
  state.setCityShapeScale(fit.radiusScale);
  // Deliberately NOT setQualityUserSet(true): the fit is an automatic guess, not
  // a user choice. Leaving the flag false lets the runtime AdaptiveQuality monitor
  // keep adjusting DPR; the moment the user picks a tier it locks (qualityUserSet).
  return (lastFit = {
    applied: true,
    tier: fit.tier,
    cls: fit.cls,
    radiusScale: fit.radiusScale,
    reason: fit.reason,
  });
}

// Test seam: reset the one-shot guard. Not used in app code.
export function __resetDeviceFitForTest() {
  didFit = false;
  lastFit = null;
}
