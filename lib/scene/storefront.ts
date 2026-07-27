import type { Building } from "@/lib/seed/cityGen";

// CPU mirror of the city shader's #86 ground-floor storefront layout
// (lib/shaders/cityInstanced.ts, the "Ground-floor UV remap" block): eligible
// downtown buildings stretch floor 0 to storefrontHeight x a normal floor and
// compress floors 1..N-1 into the rest. Anything that positions geometry BY
// FLOOR against the facade (unit boxes, commute-arc anchors) must use this
// same warp or it drifts off the visible floor lines on storefront buildings
// (user 2026-07-27: "units don't align with the floors they belong to").
//
// Eligibility mirrors the shader exactly: not warehouse / not spire, downtown
// district character, >= 4 floors, and the SAME hash roll against the live
// storefront share. The roll emulates GLSL float32 via Math.fround at each
// step; a building whose roll sits within an ulp of the share threshold could
// in principle disagree with the GPU — vanishingly rare, and the failure mode
// is just today's misalignment for that one building.

const fr = Math.fround;
const fract32 = (p: number) => fr(p - Math.floor(p));

// GLSL hash11 (shared by the city/streetlight/flight shaders), float32-emulated.
function hash11f32(p: number): number {
  p = fract32(fr(p * fr(0.1031)));
  p = fr(p * fr(p + fr(33.33)));
  p = fr(p * fr(p + p));
  return fract32(p);
}

// Fraction of the facade height floor 0 occupies, or null when the building
// has no storefront band. share/heightMult come from the live facade settings
// (store.facade.storefront / .storefrontHeight) so callers stay reactive.
export function storefrontGroundFrac(
  b: Building,
  share: number,
  heightMult: number,
): number | null {
  if (share <= 0) return null;
  if (b.district !== "downtown") return null; // vDistrictIdx < 0.5
  if (b.floors < 4) return null; // vGrid.y > 3.5
  if (b.archetype === "warehouse" || b.archetype === "spire") return null; // vGrid.z != 1, != 6
  const roll = hash11f32(fr(fr(fr(b.windowSeed * 1000) * fr(13.7)) + fr(251.0)));
  if (roll >= share) return null;
  return heightMult / Math.max(b.floors - 1 + heightMult, 1e-4);
}

// Floor boundary k (0 = ground, floors = roof) as a fraction of the building
// height, under the storefront warp (identity when groundFrac is null).
export function floorFrac(k: number, floors: number, groundFrac: number | null): number {
  if (groundFrac === null) return k / floors;
  if (k <= 0) return 0;
  return groundFrac + ((k - 1) / Math.max(floors - 1, 1)) * (1 - groundFrac);
}
