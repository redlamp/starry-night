import seedrandom from "seedrandom";
import { CITY_CENTER, maxHalfExtent } from "./topology";

// Ambient departure corridor (#67 v1 / v1.5). One seeded off-map "airport"
// anchor with a single RUNWAY HEADING; corridors are geometry keyed off that
// axis, and plane slots reference a corridor by index — the Traffic slot
// pattern (lib/seed/traffic.ts:248 rng chain, lib/shaders/traffic.ts:41 the
// fract-mix slide). Own rng chain keyed `${masterSeed}::flights`, so this
// never perturbs cityGen/traffic/beacons streams (PRD §5 determinism
// contract) — gate1 asserts on generateCity() alone and is untouched here.
//
// Runway-axis grounding: real airport traffic is anchored to the runway's
// AXIS, not a free-floating point — departures climb out along the heading,
// arrivals (v2) would descend the reciprocal (headingDeg + 180). One heading
// is seeded: the airport rolls off-map, then the heading is aimed at a point
// a seeded PERPENDICULAR offset off the airport->centre line (the periphery
// band below) so the axis passes over the OUTSKIRTS, never dead-on-centre.
//
// Full transit (#67 follow-up, user 2026-07-04): the corridor does NOT stop
// near the centre (that read as "cropped around the city centre", and planes
// vanished right where the camera looks). It continues along the heading and
// EXITS THE WORLD on the far side, so a plane crosses the entire visible
// scene — almost always somewhere in view — and reads in the periphery /
// distance rather than lost overhead downtown.
//
// Corridor maths (GH #67 design comment):
//   - airport = azimuth + distance rolled just past the ground disc edge
//     (Ground.tsx:22 GROUND_APRON_M=200), 2-6 km out. Never rendered.
//   - the far end is the mirror: the point where the runway axis re-crosses
//     discEdge + CORRIDOR_FAR_MARGIN_M on the OPPOSITE side of the centre.
//   - altitude is LINEAR along the segment (a 3-4 deg climb off a low airport
//     start) — mix(aA, aB, t) alone produces the climb.
//   - departures only: t=0 at the airport (low), t=1 off-map on the far side
//     (climbed to cruise). Arrivals (v2) reverse the roles on the reciprocal
//     heading — a data addition (one more Corridor + slots referencing it).

export type FlightClass = "airliner" | "lightGA";

export type Corridor = {
  aA: [number, number, number]; // airport-side start (low)
  aB: [number, number, number]; // near-city end (climbed)
  // Corridor-end fade width, as a FRACTION of segment length (proposal: fade
  // over the last ~500 m at each end so spawn/despawn never pops). Lives on
  // the corridor rather than the slot since a v2 arrival corridor will have
  // its own length and therefore its own fade fraction.
  fadeFrac: number;
  kind: "departure"; // v2 adds "arrival" on the reciprocal heading
};

export type FlightSlot = {
  corridor: number; // index into FlightsData.corridors
  phase: number; // 0..1 (fract(uTime*speedFrac+phase) — see lib/shaders/flights.ts)
  speedFrac: number; // segment-fractions per second (mirrors traffic's aSpeed)
  cls: FlightClass;
};

export type FlightsData = {
  // Runway axis anchor. headingDeg follows the same compass convention as the
  // moon (0 = +z north, 90 = +x east; sceneStore.ts moon.azimuthDeg), so a
  // future arrival corridor can reuse it directly as (headingDeg + 180) % 360.
  airport: { x: number; z: number; headingDeg: number };
  corridors: Corridor[];
  slots: FlightSlot[];
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const GROUND_APRON_M = 200; // mirrors Ground.tsx GROUND_APRON_M
const AIRPORT_Y = 15; // "low over the airport" — just above ground
const CORRIDOR_FADE_M = 500;
// Full transit: the corridor exits the world this far past the ground disc on
// the FAR side (the off-map mirror of the airport), so a plane crosses the
// whole visible scene instead of terminating near the centre.
const CORRIDOR_FAR_MARGIN_M = 2000;
const GLIDE_DEG_MIN = 3;
const GLIDE_DEG_MAX = 4;
const AIRLINER_SHARE = 0.55; // seeded per-slot coin for slots beyond the first two
// The runway axis is aimed to pass over the OUTSKIRTS, not dead centre — a
// seeded perpendicular offset off the airport->centre line, in the requested
// 1.5-3.5 km periphery band. Capped to 0.75*discEdge at build time so the axis
// still crosses a solid chord of the built disc on small tiers (a larger
// offset would carry the whole route outside the city, with nothing to fly
// over).
const RUNWAY_AIM_OFFSET_MIN_M = 1500;
const RUNWAY_AIM_OFFSET_MAX_M = 3500;

// Real-world cruise speeds for the two v1 classes (~140-160 kt airliner
// approach/departure speed; ~100 kt light-GA), per the design proposal's
// "real numbers, 1:1" recommendation — no scale compression.
export const CLASS_SPEED: Record<FlightClass, number> = {
  airliner: 75,
  lightGA: 50,
};

export function corridorLength(c: Corridor): number {
  return Math.hypot(c.aB[0] - c.aA[0], c.aB[1] - c.aA[1], c.aB[2] - c.aA[2]);
}

export function buildFlights(masterSeed: string): FlightsData {
  const rng = seedrandom(`${masterSeed}::flights`);
  const half = maxHalfExtent();
  const discEdge = half + GROUND_APRON_M;

  // Airport anchor, off-map (2-6 km past the disc edge). Never rendered.
  const airportAz = rng() * Math.PI * 2;
  const airportDist = discEdge + 2000 + rng() * 4000;
  const airportX = CITY_CENTER.x + Math.cos(airportAz) * airportDist;
  const airportZ = CITY_CENTER.z + Math.sin(airportAz) * airportDist;

  // Lateral placement: the runway axis is aimed at a point a seeded
  // PERPENDICULAR offset off the airport->centre line, so it sweeps the
  // outskirts rather than downtown. The offset honours the 1.5-3.5 km
  // periphery band but is capped to 0.75*discEdge so the axis always crosses a
  // solid chord of the built disc (past that it would miss the city entirely).
  const toCenterX = CITY_CENTER.x - airportX;
  const toCenterZ = CITY_CENTER.z - airportZ;
  const toCenterDist = Math.hypot(toCenterX, toCenterZ) || 1;
  const perpX = -toCenterZ / toCenterDist;
  const perpZ = toCenterX / toCenterDist;
  const offMag = Math.min(
    RUNWAY_AIM_OFFSET_MIN_M + rng() * (RUNWAY_AIM_OFFSET_MAX_M - RUNWAY_AIM_OFFSET_MIN_M),
    0.75 * discEdge,
  );
  const aimSign = rng() < 0.5 ? -1 : 1;
  const aimX = CITY_CENTER.x + perpX * offMag * aimSign;
  const aimZ = CITY_CENTER.z + perpZ * offMag * aimSign;

  // Runway heading = airport -> aim point (compass convention: dirX =
  // sin(heading), dirZ = cos(heading), so heading = atan2(dirX, dirZ)).
  const headX = aimX - airportX;
  const headZ = aimZ - airportZ;
  const headingRad = Math.atan2(headX, headZ);
  const headingDeg = (((headingRad * RAD2DEG) % 360) + 360) % 360;

  // Full transit: continue along the heading past the aim point and exit the
  // world on the FAR side. Solve |airport + s*dir - centre|^2 = R_far^2 for
  // the far root (s > 0, opposite side of the centre from the airport).
  const dirLen = Math.hypot(headX, headZ) || 1;
  const dirX = headX / dirLen;
  const dirZ = headZ / dirLen;
  const rFar = discEdge + CORRIDOR_FAR_MARGIN_M;
  const dcx = airportX - CITY_CENTER.x;
  const dcz = airportZ - CITY_CENTER.z;
  const bCoef = dcx * dirX + dcz * dirZ;
  const cCoef = dcx * dcx + dcz * dcz - rFar * rFar;
  const sFar = -bCoef + Math.sqrt(Math.max(0, bCoef * bCoef - cCoef));
  const endX = airportX + dirX * sFar;
  const endZ = airportZ + dirZ * sFar;

  // Departure climb: linear from the low airport across the whole corridor.
  const glideDeg = GLIDE_DEG_MIN + rng() * (GLIDE_DEG_MAX - GLIDE_DEG_MIN);
  const horiz = sFar; // dir is a unit vector in xz, so sFar is the horizontal run
  const endY = AIRPORT_Y + horiz * Math.tan(glideDeg * DEG2RAD);
  const segLen = Math.hypot(horiz, endY - AIRPORT_Y);

  const corridor: Corridor = {
    aA: [airportX, AIRPORT_Y, airportZ],
    aB: [endX, endY, endZ],
    fadeFrac: Math.min(0.3, CORRIDOR_FADE_M / segLen),
    kind: "departure",
  };

  // 3-4 slots. Full transit keeps each plane in view for most of its loop, so
  // this reliably shows a few crossings at once (the v1 2-slot corridor that
  // despawned near centre often showed nothing). Slots 0/1 are pinned to one
  // of each class so both light languages are always present to tell apart.
  const slotCount = 3 + (rng() < 0.5 ? 1 : 0);
  const slots: FlightSlot[] = [];
  for (let i = 0; i < slotCount; i++) {
    const cls: FlightClass =
      i === 0 ? "airliner" : i === 1 ? "lightGA" : rng() < AIRLINER_SHARE ? "airliner" : "lightGA";
    // Per-slot speed jitter (mirrors traffic's aSpeed jitter): keeps loop
    // periods off a clean ratio so planes don't pulse in lockstep.
    const speed = CLASS_SPEED[cls] * (0.9 + rng() * 0.2);
    slots.push({ corridor: 0, phase: rng(), speedFrac: speed / segLen, cls });
  }

  return {
    airport: { x: airportX, z: airportZ, headingDeg },
    corridors: [corridor],
    slots,
  };
}
