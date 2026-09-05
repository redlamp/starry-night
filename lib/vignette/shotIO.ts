import { encodeCamParam, type ViewLinkPose } from "@/lib/scene/viewLink";
import type {
  McCloudTransition,
  MoveKind,
  TransitionKind,
  Vignette,
  VignetteShot,
} from "./shotList";

// JSON export/import for a shot list, plus the `?cam=` link for a single shot.
// Kept out of shotList.ts (which is generation-only) and out of the React
// player (this has no React/DOM dependency besides the clipboard call site,
// which stays in the component).

const MOVE_KINDS: readonly MoveKind[] = ["static", "push-in", "drift", "orbit"];
const TRANSITION_KINDS: readonly TransitionKind[] = ["cut", "move"];
const MCCLOUD_KINDS: readonly McCloudTransition[] = [
  "moment-to-moment",
  "action-to-action",
  "subject-to-subject",
  "scene-to-scene",
  "aspect-to-aspect",
  "non-sequitur",
];

export function serializeVignette(v: Vignette): string {
  return JSON.stringify(v, null, 2);
}

function isVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isPose(v: unknown): v is ViewLinkPose {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return isVec3(p.position) && isVec3(p.lookAt) && typeof p.fov === "number";
}

function isShot(v: unknown): v is VignetteShot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.label === "string" &&
    isPose(s.pose) &&
    typeof s.holdSec === "number" &&
    MOVE_KINDS.includes(s.move as MoveKind) &&
    TRANSITION_KINDS.includes(s.transitionIn as TransitionKind) &&
    (s.transitionSec === undefined || typeof s.transitionSec === "number") &&
    MCCLOUD_KINDS.includes(s.mccloud as McCloudTransition)
  );
}

/** Parses a shot list previously produced by serializeVignette/Export. Returns
 * null (never throws) on anything malformed — pasted JSON is user input. */
export function parseVignetteJSON(raw: string): Vignette | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const obj = v as Record<string, unknown>;
    if (typeof obj.seed !== "string" || obj.kind !== "establishing") return null;
    if (!Array.isArray(obj.shots) || obj.shots.length === 0) return null;
    if (!obj.shots.every(isShot)) return null;
    return { seed: obj.seed, kind: "establishing", shots: obj.shots as VignetteShot[] };
  } catch {
    return null;
  }
}

/** A shareable `?cam=` link for one shot's pose (not the live camera —
 * buildViewLink() in lib/scene/viewLink is for that). */
export function shotViewLink(seed: string, pose: ViewLinkPose): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?seed=${encodeURIComponent(seed)}&cam=${encodeCamParam(pose)}`;
}
