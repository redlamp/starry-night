/**
 * City sketch registry (#40). A hand-hatched sketch, recovered into an
 * orientation grid (lib/sketch/orientationField), can drive the WHOLE city:
 * registered here, buildTensorRoadsImpl swaps the seeded basis field for the
 * sketch's sampled-grid field and uses the ink as the street mask — districts,
 * buildings and lights all derive from the roads, so they follow automatically.
 *
 * Module-level mutable state, same pattern as setCityTier: the scene store
 * syncs it on every write path, scripts set it directly, and the gen worker
 * receives the sketch in its request and registers it before generating.
 * Every gen cache keys on sketchKey(), so sketch and no-sketch cities never
 * collide. Determinism: the city is a pure function of (seed, tier, sketch) —
 * the sketch is runtime config, exactly like cityShape.
 */
import {
  makeSketchTensor,
  type SketchTensor,
  type SketchTensorSource,
} from "@/lib/sketch/orientationField";
import { CITY_CENTER, maxHalfExtent } from "./topology";

// Min interpolated stroke weight — below this the field is degenerate (bare
// paper): streamlines stop, the city footprint ends.
const SKETCH_W_MIN = 0.05;

let active: SketchTensorSource | null = null;
let activeId = "none";

function fnv(parts: Iterable<number>): string {
  let h = 0x811c9dc5;
  for (const n of parts) {
    // hash the float's rounded micro-units — stable, cheap, order-sensitive
    const v = Math.round(n * 1e4);
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function setCitySketch(sketch: SketchTensorSource | null): void {
  active = sketch;
  activeId = sketch
    ? `${sketch.gw}x${sketch.gh}-${fnv(sketch.theta)}${fnv(sketch.coh)}${fnv(sketch.valid)}`
    : "none";
}

export function activeCitySketch(): SketchTensorSource | null {
  return active;
}

/** Cache-key fragment: "none" or a content hash of the registered sketch. */
export function sketchKey(): string {
  return activeId;
}

/**
 * The registered sketch as a city-space TensorField: the page spans the
 * current tier's full gen extent, centred on CITY_CENTER (height follows the
 * page's aspect — off-page is degenerate, like bare paper). Null when no
 * sketch is registered. Cheap to call (closures over the grid, no copy).
 */
export function citySketchTensor(): SketchTensor | null {
  if (!active) return null;
  const worldW = 2 * maxHalfExtent();
  const worldH = worldW * (active.H / active.W);
  return makeSketchTensor(active, worldW, SKETCH_W_MIN, {
    x: CITY_CENTER.x - worldW / 2,
    z: CITY_CENTER.z - worldH / 2,
  });
}
