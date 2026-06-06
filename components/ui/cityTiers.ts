import { CITY_TIERS, type CityTier } from "@/lib/seed/topology";

// City size tiers (#58) — display layer for the notched size sliders (settings
// panel + /plan). Each notch is a DIFFERENT city for the same seed (re-roll,
// not growth). Names are display-only: tiers are keyed by km in topology.ts
// CITY_TIERS, so renaming a notch can never re-scale a saved session.
export const tierKm = (t: CityTier) => (2 * CITY_TIERS[t]) / 1000;

export const TIER_LABELS: Record<CityTier, string> = {
  1: "Truck Stop",
  2: "Village",
  3: "Town",
  4: "Borough",
  5: "Small City",
  6: "City",
  7: "Big City",
  8: "Metropolis",
};
