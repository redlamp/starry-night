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
// Runway-axis grounding (#67 follow-up): real airport traffic is anchored to
// the runway's AXIS, not a free-floating point — departures climb out along
// the heading, arrivals (v2) would descend the reciprocal (headingDeg + 180)
// in a straight, evenly-spaced final. v1.5 seeds ONE heading: the airport
// anchor rolls off-map exactly as v1 did, then the heading is aimed at a
// point offset from the city centre by a seeded PERPENDICULAR offset of
// 0-2 km — never dead-on-centre (that would read as a spoke, not a heading),
// always close enough that the corridor stays inside the framing the
// original proposal's angular-velocity numbers were computed against. That
// aim point doubles as the v1.5 departure corridor's near-city end (there is
// only one corridor); v2 arrivals add a second Corridor on the reciprocal
// heading without touching this one.
//
// Corridor maths (GH #67 design comment):
//   - airport = azimuth + distance rolled just past the ground disc edge
//     (Ground.tsx:22 GROUND_APRON_M=200), 2-6 km out. Never rendered — a
//     pure anchor for the corridor line.
//   - altitude is LINEAR along the segment (a 3-4 deg climb gradient off a
//     low airport start) — mix(aA, aB, t) alone produces the climb, no
//     separate altitude shader term needed.
//   - v1.5 is departures only: t=0 sits at the airport (low), t=1 at the
//     near-city end (climbed). Arrivals (v2) reverse the roles on the
//     reciprocal heading — a data addition (one more Corridor + slots that
//     reference it), not a rework, now that geometry lives on
//     {airport, corridors} instead of being baked directly into each slot.

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
// Safety clamp: keeps the near-city end within 5 km of world origin. The
// runway-aim construction below (an offset of at most RUNWAY_AIM_OFFSET_MAX_M
// from a city centre that already sits near the origin) can't reach this on
// its own — kept as a guard against future constant changes, not the
// primary constraint it was in v1.
const CORRIDOR_END_MAX_DIST = 5000;
const GLIDE_DEG_MIN = 3;
const GLIDE_DEG_MAX = 4;
const AIRLINER_SHARE = 0.55; // seeded per-slot coin — mixed ambient traffic, not a strict ratio
// How far off dead-centre the runway heading is aimed (perpendicular to the
// airport->city-centre line), so the extended centreline passes NEAR the
// city rather than through one exact point — real runways rarely bisect a
// city, and this keeps the axis reading like a heading, not a spoke.
const RUNWAY_AIM_OFFSET_MAX_M = 2000;

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

  const airportAz = rng() * Math.PI * 2;
  const airportDist = discEdge + 2000 + rng() * 4000; // 2-6 km past the disc edge
  const airportX = CITY_CENTER.x + Math.cos(airportAz) * airportDist;
  const airportZ = CITY_CENTER.z + Math.sin(airportAz) * airportDist;

  // Runway heading: aim from the airport at a point NEAR the city centre
  // (offset perpendicular to the airport->centre line), not straight through
  // it. Sign is folded into the offset itself so either side of centre is
  // equally likely.
  const toCenterX = CITY_CENTER.x - airportX;
  const toCenterZ = CITY_CENTER.z - airportZ;
  const toCenterDist = Math.hypot(toCenterX, toCenterZ) || 1;
  const perpX = -toCenterZ / toCenterDist;
  const perpZ = toCenterX / toCenterDist;
  const aimOffset = (rng() * 2 - 1) * RUNWAY_AIM_OFFSET_MAX_M;
  let aimX = CITY_CENTER.x + perpX * aimOffset;
  let aimZ = CITY_CENTER.z + perpZ * aimOffset;
  const aimDist = Math.hypot(aimX, aimZ);
  if (aimDist > CORRIDOR_END_MAX_DIST) {
    const s = CORRIDOR_END_MAX_DIST / aimDist;
    aimX *= s;
    aimZ *= s;
  }

  const headX = aimX - airportX;
  const headZ = aimZ - airportZ;
  // Compass convention (dirX = sin(heading), dirZ = cos(heading)): heading =
  // atan2(dirX, dirZ).
  const headingRad = Math.atan2(headX, headZ);
  const headingDeg = (((headingRad * RAD2DEG) % 360) + 360) % 360;

  const glideDeg = GLIDE_DEG_MIN + rng() * (GLIDE_DEG_MAX - GLIDE_DEG_MIN);
  const horiz = Math.hypot(headX, headZ);
  const endY = AIRPORT_Y + horiz * Math.tan(glideDeg * DEG2RAD);
  const segLen = Math.hypot(horiz, endY - AIRPORT_Y);

  const corridor: Corridor = {
    aA: [airportX, AIRPORT_Y, airportZ],
    aB: [aimX, endY, aimZ],
    fadeFrac: Math.min(0.3, CORRIDOR_FADE_M / segLen),
    kind: "departure",
  };

  const slotCount = 2 + (rng() < 0.5 ? 1 : 0); // 2-3 slots per the proposal
  const slots: FlightSlot[] = [];
  for (let i = 0; i < slotCount; i++) {
    const cls: FlightClass = rng() < AIRLINER_SHARE ? "airliner" : "lightGA";
    // Per-slot speed jitter (mirrors traffic's aSpeed jitter, lib/seed/traffic.ts:316):
    // classes on the same corridor already have different base speeds, and this
    // jitter keeps their loop periods from landing on a clean ratio — "near-coprime
    // ~120 s periods" (proposal) without a CPU scheduler.
    const speed = CLASS_SPEED[cls] * (0.9 + rng() * 0.2);
    slots.push({ corridor: 0, phase: rng(), speedFrac: speed / segLen, cls });
  }

  return {
    airport: { x: airportX, z: airportZ, headingDeg },
    corridors: [corridor],
    slots,
  };
}
