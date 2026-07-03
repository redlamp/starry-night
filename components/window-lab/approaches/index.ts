import type { ComponentType } from "react";
import type { Building } from "@/lib/seed/cityGen";
import { CurrentShaderRack } from "./CurrentShaderRack";
import { BakedFacadeRack } from "./BakedFacadeRack";

// Window Lab approach registry. An approach is a self-contained way of turning
// the shared specimen list into pixels — mesh, material, texture, whatever. No
// contract with the production pipeline beyond the Building type, so a new idea
// can be tried without touching (or resembling) cityInstanced. Add a file, add
// an entry here, and it appears in both lab slots.

export interface RackProps {
  specimens: Building[];
  seed: string;
}

export interface WindowApproach {
  id: string;
  name: string;
  blurb: string;
  Rack: ComponentType<RackProps>;
}

export const APPROACHES: WindowApproach[] = [
  {
    id: "current",
    name: "Current shader",
    blurb:
      "The production pipeline: per-fragment procedural windows over a NEAREST data atlas " +
      "(cityInstanced), pinned to default settings. The reference the others must beat.",
    Rack: CurrentShaderRack,
  },
  {
    id: "baked-mip",
    name: "Baked facade + mips",
    blurb:
      "Facades baked to ordinary textures; trilinear mipmaps + anisotropic filtering do ALL " +
      "the anti-aliasing. Static (no flicker yet) — here to show the artifact-free ceiling.",
    Rack: BakedFacadeRack,
  },
];

export const approachById = (id: string | null | undefined): WindowApproach | null =>
  APPROACHES.find((a) => a.id === id) ?? null;
