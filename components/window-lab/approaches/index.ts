import type { ComponentType } from "react";
import type { Building } from "@/lib/seed/cityGen";
import { CurrentShaderRack } from "./CurrentShaderRack";
import { BakedFacadeRack } from "./BakedFacadeRack";
import { BakedSdfRack } from "./BakedSdfRack";
import { AtlasSdfRack } from "./AtlasSdfRack";

// Window Lab approach registry. An approach is a self-contained way of turning
// the shared specimen list into pixels — mesh, material, texture, whatever. No
// contract with the production pipeline beyond the Building type, so a new idea
// can be tried without touching (or resembling) cityInstanced. Add a file, add
// an entry here, and it appears in both lab slots.

// Shared window-size ranges (glass-to-cell fraction, same semantics as the main
// app's simple window mode): each building rolls ONE width and ONE height from
// these brackets. Driven live by the lab's Windows sliders.
export interface WindowRanges {
  wMin: number;
  wMax: number;
  hMin: number;
  hMax: number;
}

// Texture-layer debug view (user 2026-07-03, "a way to debug how the textures
// work together"): which layer of its pipeline a rack renders on the actual
// buildings. Every approach supports "final"; the others depend on what the
// approach is made of (see texViews per entry).
export type TexView = "final" | "atlas" | "field";

export interface TexViewOption {
  id: TexView;
  label: string;
}

export interface RackProps {
  specimens: Building[];
  seed: string;
  windows: WindowRanges;
  // Texture-layer view — racks that have no such layer ignore it.
  texView?: TexView;
  // Hover-to-inspect (texture tooltip): report the building under the cursor,
  // null when the pointer leaves. Racks stopPropagation so only the nearest
  // hit reports (R3F events fire on every object along the ray).
  onHover?: (buildingId: number | null) => void;
  // Double-click: focus the camera on this building (tween handled by the lab).
  onFocus?: (buildingId: number) => void;
}

export interface WindowApproach {
  id: string;
  name: string;
  blurb: string;
  // Texture layers this approach can render in place of the final composite.
  texViews: TexViewOption[];
  Rack: ComponentType<RackProps>;
}

export const APPROACHES: WindowApproach[] = [
  {
    id: "current",
    name: "Current shader",
    blurb:
      "The production pipeline: per-fragment procedural windows over a NEAREST data atlas " +
      "(cityInstanced), pinned to default settings. The reference the others must beat.",
    texViews: [
      { id: "final", label: "Final render" },
      { id: "atlas", label: "Cell atlas" },
      { id: "field", label: "Pane mask" },
    ],
    Rack: CurrentShaderRack,
  },
  {
    id: "baked-mip",
    name: "Baked facade + mips",
    blurb:
      "Facades baked to ordinary textures; trilinear mipmaps + anisotropic filtering do ALL " +
      "the anti-aliasing. Windows wake/sleep at production rates via slow re-bakes (changes land " +
      "in steps); TVs steady, no 8 Hz shimmer.",
    // The bake IS the final image — no separate mask/atlas layer to show.
    texViews: [{ id: "final", label: "Final render (= the bake)" }],
    Rack: BakedFacadeRack,
  },
  {
    id: "baked-sdf",
    name: "Baked SDF",
    blurb:
      "Same bake, but window shapes live in per-axis signed distance fields thresholded by a " +
      "tiny shader - edges AND corners stay crisp at any zoom. Far field is approximate (the " +
      "mip rack stays the far-field reference).",
    texViews: [
      { id: "final", label: "Final render" },
      { id: "atlas", label: "Colour bake" },
      { id: "field", label: "Field texture (RG)" },
    ],
    Rack: BakedSdfRack,
  },
  {
    id: "atlas-sdf",
    name: "Atlas + SDF",
    blurb:
      "The SDF route optimised to its endpoint: ONE texel per window (production atlas density, " +
      "~340x less memory than the bakes) and the pane shape computed analytically in the shader " +
      "- no field texture at all. Crisp near via the analytic mask, mip-averaged far. The " +
      "one-material sketch of the #82 hybrid.",
    texViews: [
      { id: "final", label: "Final render" },
      { id: "atlas", label: "Cell atlas" },
      // No field TEXTURE exists — the shader evaluates the distance field
      // analytically, so this view renders that evaluation directly.
      { id: "field", label: "Window field (analytic)" },
    ],
    Rack: AtlasSdfRack,
  },
];

export const approachById = (id: string | null | undefined): WindowApproach | null =>
  APPROACHES.find((a) => a.id === id) ?? null;
