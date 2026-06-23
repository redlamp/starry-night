// Device-class heuristic for picking a sensible INITIAL quality tier on first
// load — so a Retina iMac doesn't land on the "high" tier (dprMax 2) and render
// ~15M fragments/frame, and a phone doesn't try to render the full city at DPR 3.
// Pure classification (testable) + a one-shot WebGL/platform probe.
//
// Why this exists: fragment cost ∝ DPR², and the scene is fill-rate bound
// (emissive windows + transparent haze + fog, layered, no early-Z). On a hi-DPI
// panel an integrated/Apple GPU chokes at DPR 2; capping to ~1.25 (the "med"
// tier) quarters-ish the fragment work and holds 60. detect-gpu would be more
// precise (an actual benchmark DB keyed by renderer string), but can't be added
// here (worktree shares node_modules — no install) — so this is a layered
// renderer-string + form-factor heuristic with a conservative default. Swapping
// in detect-gpu (async, self-hosted benchmark JSON) in a non-worktree checkout
// remains a future option (#53).
import type { QualityTier } from "@/lib/state/sceneStore";

export type DeviceClass = "discrete" | "apple" | "integrated" | "mobile" | "unknown";

// A snapshot of the device's graphics capability + form factor, read once at
// boot. All fields are best-effort: a blocked WebGL context or a privacy build
// leaves `renderer` null (masked) and falls back to the platform signals.
export type DeviceCaps = {
  // Unmasked GPU renderer string (null if unavailable/blocked).
  renderer: string | null;
  // WebGL2 support (a rough modernity floor — WebGL1-only is old/locked-down).
  webgl2: boolean;
  // GL MAX_TEXTURE_SIZE — small caps (<= 4096) flag weak/mobile GPUs.
  maxTextureSize: number;
  // navigator.hardwareConcurrency (logical cores; 0 if unavailable).
  cores: number;
  // navigator.deviceMemory in GiB (Chromium-only; 0 if unavailable).
  deviceMemory: number;
  // matchMedia('(pointer: coarse)') — a touch-primary device (phone/tablet).
  coarsePointer: boolean;
  // navigator.userAgent looks like a phone/tablet.
  mobileUA: boolean;
};

// One-shot read of the unmasked GPU renderer string (browser-only; null if
// unavailable/blocked). Uses a throwaway context so it never touches the scene.
// Kept as a named export for callers that only need the renderer string.
export function probeGpu(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") ||
      c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const s = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return s;
  } catch {
    return null;
  }
}

// One-shot probe of GPU + platform capability. Browser-only; on the server (or
// when WebGL is blocked) it returns a conservative all-unknown snapshot. Uses a
// throwaway WebGL context so it never touches the scene's renderer.
export function probeCaps(): DeviceCaps {
  const nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined;
  const caps: DeviceCaps = {
    renderer: null,
    webgl2: false,
    maxTextureSize: 0,
    cores: nav?.hardwareConcurrency ?? 0,
    // deviceMemory is Chromium-only and typed loosely; guard the read.
    deviceMemory: (nav as unknown as { deviceMemory?: number } | undefined)?.deviceMemory ?? 0,
    coarsePointer:
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: coarse)").matches
        : false,
    mobileUA: nav ? /android|iphone|ipad|ipod|mobile|tablet/i.test(nav.userAgent) : false,
  };
  if (typeof document === "undefined") return caps;
  try {
    const c = document.createElement("canvas");
    const gl2 = c.getContext("webgl2") as WebGL2RenderingContext | null;
    const gl = (gl2 ||
      c.getContext("webgl") ||
      c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (gl) {
      caps.webgl2 = gl2 != null;
      caps.maxTextureSize = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 0;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      caps.renderer = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // leave the conservative defaults
  }
  return caps;
}

export function classifyGpu(renderer: string | null): DeviceClass {
  if (!renderer) return "unknown";
  const r = renderer.toLowerCase();
  if (/(adreno|mali|powervr|apple a\d|tegra)/.test(r)) return "mobile";
  if (/(geforce|rtx|gtx|radeon rx|radeon pro w|arc a\d|quadro|radeon \(tm\) rx)/.test(r))
    return "discrete";
  if (/apple m\d/.test(r)) return "apple";
  if (/(intel|iris|uhd|hd graphics|radeon pro|vega|radeon\(tm\))/.test(r)) return "integrated";
  return "unknown";
}

type Suggestion = { tier: QualityTier; cls: DeviceClass; radiusScale: number; reason: string };

// Suggested starting tier from a full capability probe. LAYERED decision:
//   1. Form factor first — a coarse-pointer / mobile-UA device is a phone or
//      tablet regardless of what the (often masked) renderer says: cap hard.
//   2. Renderer class — a clear discrete / Apple / integrated / mobile GPU
//      string drives the tier (the DPR lever is the point: hi-DPI on anything
//      but discrete should NOT render at DPR 2).
//   3. Cores / memory tie-breakers — when the class is unknown but the platform
//      reports plenty of cores + RAM + WebGL2 + a big texture cap, lean up a
//      notch; a thin machine leans down.
//   4. Masked renderer with weak platform signals — stay conservative ("med").
//
// `radiusScale` is a cityShapeScale (1 = the full tier extent; <1 crops to a
// concentric, byte-identical SUBSET — same roads/buildings, just less of them).
// Strong GPUs get 1 (uncapped, full city); weaker devices render a smaller core
// so instance/vertex/memory/upload costs drop. The TIER (layout) is identical on
// every device — only the rendered radius differs — so the city is shared.
//
// PURE: no globals, no side effects — every input arrives via `caps`/`dpr`, so
// it is fully unit-testable from fixture strings. (#53)
export function suggestTier(caps: DeviceCaps, dpr: number): Suggestion {
  const cls = classifyGpu(caps.renderer);
  const hiDpi = dpr >= 2;

  // 1. Form factor wins. A touch-primary / mobile-UA device is fill-rate weak and
  //    usually hi-DPI; the full city at DPR ≥ 2 is hopeless. Hard cap to low.
  if (caps.coarsePointer || caps.mobileUA) {
    return {
      tier: "low",
      cls: cls === "unknown" ? "mobile" : cls,
      radiusScale: 0.55,
      reason: "mobile form factor (coarse pointer / UA) — tier low, DPR 1, ~0.55 radius",
    };
  }

  // 2. Renderer class.
  switch (cls) {
    case "mobile":
      return {
        tier: "low",
        cls,
        radiusScale: 0.55,
        reason: "mobile GPU — tier low, DPR 1, ~0.55 radius",
      };
    case "discrete":
      return {
        tier: "high",
        cls,
        radiusScale: 1,
        reason: "discrete GPU — tier high, full DPR + radius",
      };
    case "apple":
      return hiDpi
        ? {
            tier: "med",
            cls,
            radiusScale: 0.85,
            reason: "Apple GPU on a Retina panel — tier med (DPR ~1.25), ~0.85 radius",
          }
        : {
            tier: "high",
            cls,
            radiusScale: 1,
            reason: "Apple GPU, standard-DPI — tier high, full DPR + radius",
          };
    case "integrated":
      // Integrated GPUs (Iris Xe / UHD / Radeon Pro / Vega) are fill-rate weak —
      // start conservative; the runtime monitor bumps DPR up if there's headroom.
      return {
        tier: "med",
        cls,
        radiusScale: 0.7,
        reason: "integrated GPU — tier med (DPR ~1.25), ~0.7 radius",
      };
    default:
      break;
  }

  // 3. Unknown / masked renderer — fall back to platform tie-breakers.
  //    A capable desktop (many cores, ample RAM, WebGL2, large texture cap)
  //    that just hides its renderer string should not be punished to "med";
  //    nudge it up, but never past the hi-DPI guard.
  const strongPlatform =
    caps.webgl2 && caps.cores >= 8 && caps.maxTextureSize >= 8192 && caps.deviceMemory >= 8;
  const weakPlatform =
    !caps.webgl2 || caps.maxTextureSize <= 4096 || (caps.cores > 0 && caps.cores <= 2);

  if (weakPlatform) {
    return {
      tier: "low",
      cls,
      radiusScale: 0.6,
      reason: "masked GPU + weak platform (no WebGL2 / tiny texture cap / few cores) — tier low",
    };
  }
  if (strongPlatform && !hiDpi) {
    return {
      tier: "high",
      cls,
      radiusScale: 1,
      reason: "masked GPU but strong platform (8+ cores, 8 GiB, WebGL2), standard-DPI — tier high",
    };
  }
  if (strongPlatform && hiDpi) {
    return {
      tier: "med",
      cls,
      radiusScale: 0.85,
      reason: "masked GPU, strong platform on hi-DPI — tier med (DPR ~1.25), ~0.85 radius",
    };
  }

  // 4. Genuinely unknown — conservative middle tier (DPR ~1.25 keeps a hi-DPI
  //    panel honest; the runtime monitor climbs back up if there's headroom).
  return {
    tier: "med",
    cls,
    radiusScale: hiDpi ? 0.85 : 1,
    reason: hiDpi
      ? "unknown GPU on hi-DPI — conservative tier med, ~0.85 radius"
      : "unknown GPU, standard-DPI — conservative tier med, full radius",
  };
}
