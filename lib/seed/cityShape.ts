import seedrandom from "seedrandom";
import { CITY_CENTER, maxHalfExtent } from "./topology";

// Organic city footprints (#14). Instead of filling the whole square field, the
// built-up area is clipped to a seeded boundary mask. The mask is a pure
// function (x,z)->0..1 (1 = solidly inside, 0 = outside, soft band at the edge so
// density thins rather than hard-cutting). Applied at the road-network level so
// roads, buildings, and districts all conform from a single point.
//
// Deterministic: shape + all parameters derive from the seed. No Math.random.

export type CityShape = "square" | "circle";
export const CITY_SHAPES: CityShape[] = ["square", "circle"];

// `auto` lets each seed pick its own shape so a stream of seeds reads varied;
// an explicit mode forces one (the debug switcher).
export type CityShapeSetting = "auto" | CityShape;

// Deterministic per-seed shape pick for `auto`: square or round, 50/50.
export function pickCityShape(seed: string): CityShape {
  return seedrandom(`${seed}::cityshape`)() < 0.5 ? "square" : "circle";
}

export function resolveCityShape(setting: CityShapeSetting, seed: string): CityShape {
  return setting === "auto" ? pickCityShape(seed) : setting;
}

export type ShapeMask = (x: number, z: number) => number;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// #70: shared R/falloff derivation for the circle crop — makeShapeMask's smooth
// mask and cropRadiusThreshold's boolean membership test are two views of the
// SAME boundary, so both compute from this one pair rather than risking two
// formulas drifting apart.
function circleCropParams(scale: number, half: number): { R: number; falloff: number } {
  return { R: half * scale, falloff: half * 0.05 };
}

// Build the boundary mask for a resolved shape — a pure CROP applied POST-generation
// (#14: the city is generated at the tier's full extent; this only reveals/hides, it
// never re-rolls). `scale` sets the circle radius as a fraction of `half`, which
// defaults to the CURRENT tier's gen extent (#58; default param → read per call):
// scale 1.0 = the tier's full disc, 0.5 = half of it. `square` is intentionally
// un-cropped: the full field + gate1's full-coverage test artifact — crop via `circle`.
export function makeShapeMask(
  shape: CityShape,
  scale = 1,
  half: number = maxHalfExtent(),
): ShapeMask {
  if (shape === "square") {
    // No-op mask — the existing axis-aligned bbox still bounds the city to ±half.
    // Keeps `square` byte-identical to the pre-shape behaviour.
    return () => 1;
  }
  // circle: a disc of radius `half * scale`, crisp edge.
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;
  const { R, falloff } = circleCropParams(scale, half);
  return (x, z) => clamp01((R - Math.hypot(x - cx, z - cz)) / falloff);
}

// The city's DISPLAYED half-extent for a resolved shape/scale (#56): `square` is
// never cropped (the full tier extent — same no-op as makeShapeMask's mask);
// `circle` shrinks to `half * scale`, matching the disc makeShapeMask draws. Camera
// resting poses read this (directly, or via cameraView.ts's cropFollowScale ratio)
// so framing tracks the crop instead of a fixed look-scale constant.
export function displayedRadius(
  shape: CityShape,
  scale = 1,
  half: number = maxHalfExtent(),
): number {
  return shape === "circle" ? half * scale : half;
}

// #70: distance-from-centre threshold equivalent to
// `makeShapeMask(shape, scale, half)(x, z) >= 0.5` — the exact "inside the
// crop" boolean generateCity's own building filter uses — expressed as a
// single radius comparison instead of a per-point mask evaluation. Lets
// render-side cull code (lib/scene/tileCull's tileCropCount) prefix-filter a
// RADIUS-SORTED tile with a binary search, so a crop notch never needs to
// re-test every building's membership. `square` never crops (see
// makeShapeMask) → Infinity, so every radius passes.
export function cropRadiusThreshold(
  shape: CityShape,
  scale: number,
  half: number = maxHalfExtent(),
): number {
  if (shape === "square") return Infinity;
  const { R, falloff } = circleCropParams(scale, half);
  return R - falloff / 2;
}
