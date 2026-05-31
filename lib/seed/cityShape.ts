import seedrandom from "seedrandom";
import { CITY_CENTER, CITY_HALF_EXTENT } from "./topology";

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

// Build the boundary mask for a resolved shape. `half` defaults to the live city
// extent so the boundary scales with the size tiers automatically.
// Build the boundary mask for a resolved shape. `scale` sets the circle radius
// as a fraction of `half`: 1.0 touches the square's edge midpoints, ~1.4 reaches
// the corners (the full content). `half` defaults to the live city extent so the
// boundary tracks the size tiers automatically.
export function makeShapeMask(
  shape: CityShape,
  scale = 1,
  half: number = CITY_HALF_EXTENT,
): ShapeMask {
  if (shape === "square") {
    // No-op mask — the existing axis-aligned bbox still bounds the city to ±half.
    // Keeps `square` byte-identical to the pre-shape behaviour.
    return () => 1;
  }
  // circle: a disc of radius `half * scale`, crisp edge.
  const cx = CITY_CENTER.x;
  const cz = CITY_CENTER.z;
  const R = half * scale;
  const falloff = half * 0.05;
  return (x, z) => clamp01((R - Math.hypot(x - cx, z - cz)) / falloff);
}
