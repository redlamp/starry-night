// Road polyline types shared across the city generator + renderers. The interim
// axis-aligned street-grid generator that used to live here was removed with the
// old layout; tensor-field streets (lib/seed/tensorStreets.ts) are the only road
// model now.

export type RoadTier = "arterial" | "minor";

export type RoadPoly = {
  id: string;
  vertices: Array<{ x: number; z: number }>;
  width: number;
  closed: false;
  tier: RoadTier;
};
