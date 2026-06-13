// Device-class heuristic for picking a sensible INITIAL quality tier on first
// load — so a Retina iMac doesn't land on the "high" tier (dprMax 2) and render
// ~15M fragments/frame. Pure classification (testable) + a WebGL probe.
//
// Why this exists: fragment cost ∝ DPR², and the scene is fill-rate bound
// (emissive windows + transparent haze + fog, layered, no early-Z). On a hi-DPI
// panel an integrated/Apple GPU chokes at DPR 2; capping to ~1.25 (the "med"
// tier) quarters-ish the fragment work and holds 60. detect-gpu would be more
// precise, but can't be added here (worktree shares node_modules — no install),
// so this is a renderer-string heuristic with a conservative default.
import type { QualityTier } from "@/lib/state/sceneStore";

export type DeviceClass = "discrete" | "apple" | "integrated" | "mobile" | "unknown";

// One-shot read of the unmasked GPU renderer string (browser-only; null if
// unavailable/blocked). Uses a throwaway context so it never touches the scene.
export function probeGpu(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const s = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return s;
  } catch {
    return null;
  }
}

export function classifyGpu(renderer: string | null): DeviceClass {
  if (!renderer) return "unknown";
  const r = renderer.toLowerCase();
  if (/(adreno|mali|powervr|apple a\d|tegra)/.test(r)) return "mobile";
  if (/(geforce|rtx|gtx|radeon rx|radeon pro w|arc a\d|quadro|radeon \(tm\) rx)/.test(r)) return "discrete";
  if (/apple m\d/.test(r)) return "apple";
  if (/(intel|iris|uhd|hd graphics|radeon pro|vega|radeon\(tm\))/.test(r)) return "integrated";
  return "unknown";
}

// Suggested starting tier. The key lever is DPR: a hi-DPI panel (devicePixelRatio
// >= 2) on anything but a clearly-discrete GPU should NOT render at DPR 2.
export function suggestTier(opts: {
  renderer: string | null;
  dpr: number;
  cores: number;
}): { tier: QualityTier; cls: DeviceClass; reason: string } {
  const cls = classifyGpu(opts.renderer);
  const hiDpi = opts.dpr >= 2;
  switch (cls) {
    case "mobile":
      return { tier: "low", cls, reason: "mobile GPU — DPR 1, reduced stars (30 fps floor)" };
    case "discrete":
      return { tier: "high", cls, reason: "discrete GPU — full DPR up to 2" };
    case "apple":
      return hiDpi
        ? { tier: "med", cls, reason: "Apple GPU on a Retina panel — DPR ~1.25 to tame fill-rate" }
        : { tier: "high", cls, reason: "Apple GPU, standard-DPI — full DPR" };
    case "integrated":
      // Integrated GPUs (Iris Xe / UHD / Radeon Pro / Vega) are fill-rate weak —
      // start conservative regardless of DPR; the dynamic monitor bumps up if there's headroom.
      return { tier: "med", cls, reason: hiDpi ? "integrated GPU on hi-DPI — DPR ~1.25" : "integrated GPU — conservative DPR ~1.25" };
    default:
      return hiDpi
        ? { tier: "med", cls, reason: "unknown GPU on hi-DPI — conservative middle tier" }
        : { tier: "high", cls, reason: "unknown GPU, standard-DPI" };
  }
}
