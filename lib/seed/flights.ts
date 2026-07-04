import seedrandom from "seedrandom";
import { CITY_CENTER, maxHalfExtent } from "./topology";

// Ambient departure corridor (#67 v1). One seeded off-map "airport" anchor;
// 2-3 plane slots slide a SHARED A(airport, low)->B(near-city, climbed)
// segment via fract(uTime*aSpeed+aPhase) in the shader — the Traffic slot
// pattern (lib/seed/traffic.ts:248 rng chain, lib/shaders/traffic.ts:41 the
// fract-mix slide). Own rng chain keyed `${masterSeed}::flights`, so this
// never perturbs cityGen/traffic/beacons streams (PRD §5 determinism
// contract) — gate1 asserts on generateCity() alone and is untouched here.
//
// Corridor maths (GH #67 design comment):
//   - airport = azimuth + distance rolled just past the ground disc edge
//     (Ground.tsx:22 GROUND_APRON_M=200), 2-6 km out. Never rendered — a
//     pure anchor for the corridor line.
//   - end = a point offset from the city centre by up to half the current
//     tier's half-extent, clamped to <=5 km from world origin so the
//     corridor's near-city end stays inside the range the proposal's
//     angular-velocity numbers were computed against, regardless of tier.
//   - altitude is LINEAR along the segment (a 3-4 deg climb gradient off a
//     low airport start) — mix(aA, aB, t) alone produces the climb, no
//     separate altitude shader term needed.
//   - v1 is departures only: t=0 sits at the airport (low), t=1 at the
//     near-city end (climbed). Arrivals (v2) would reverse the roles.

export type FlightClass = "airliner" | "lightGA";

export type FlightSlot = {
  aA: [number, number, number]; // airport-side start (low)
  aB: [number, number, number]; // near-city end (climbed)
  phase: number; // 0..1
  speedFrac: number; // segment-fractions per second (mirrors traffic's aSpeed)
  cls: FlightClass;
};

export type FlightsData = {
  slots: FlightSlot[];
  // Corridor-end fade width as a FRACTION of segment length (proposal: fade
  // over the last ~500 m at each end so spawn/despawn never pops).
  fadeFrac: number;
};

const DEG2RAD = Math.PI / 180;
const GROUND_APRON_M = 200; // mirrors Ground.tsx GROUND_APRON_M
const AIRPORT_Y = 15; // "low over the airport" — just above ground
const CORRIDOR_FADE_M = 500;
const CORRIDOR_END_MAX_DIST = 5000; // clamp: near-city end stays within 5 km of origin
const GLIDE_DEG_MIN = 3;
const GLIDE_DEG_MAX = 4;
const AIRLINER_SHARE = 0.55; // seeded per-slot coin — mixed ambient traffic, not a strict ratio

// Real-world cruise speeds for the two v1 classes (~140-160 kt airliner
// approach/departure speed; ~100 kt light-GA), per the design proposal's
// "real numbers, 1:1" recommendation — no scale compression.
export const CLASS_SPEED: Record<FlightClass, number> = {
  airliner: 75,
  lightGA: 50,
};

export function buildFlights(masterSeed: string): FlightsData {
  const rng = seedrandom(`${masterSeed}::flights`);
  const half = maxHalfExtent();
  const discEdge = half + GROUND_APRON_M;

  const airportAz = rng() * Math.PI * 2;
  const airportDist = discEdge + 2000 + rng() * 4000; // 2-6 km past the disc edge
  const airportX = CITY_CENTER.x + Math.cos(airportAz) * airportDist;
  const airportZ = CITY_CENTER.z + Math.sin(airportAz) * airportDist;

  const endAz = rng() * Math.PI * 2;
  const endOffset = rng() * (half * 0.5); // up to half the tier's half-extent
  let endX = CITY_CENTER.x + Math.cos(endAz) * endOffset;
  let endZ = CITY_CENTER.z + Math.sin(endAz) * endOffset;
  const endDist = Math.hypot(endX, endZ);
  if (endDist > CORRIDOR_END_MAX_DIST) {
    const s = CORRIDOR_END_MAX_DIST / endDist;
    endX *= s;
    endZ *= s;
  }

  const glideDeg = GLIDE_DEG_MIN + rng() * (GLIDE_DEG_MAX - GLIDE_DEG_MIN);
  const horiz = Math.hypot(endX - airportX, endZ - airportZ);
  const endY = AIRPORT_Y + horiz * Math.tan(glideDeg * DEG2RAD);
  const segLen = Math.hypot(horiz, endY - AIRPORT_Y);

  const slotCount = 2 + (rng() < 0.5 ? 1 : 0); // 2-3 slots per the proposal
  const slots: FlightSlot[] = [];
  for (let i = 0; i < slotCount; i++) {
    const cls: FlightClass = rng() < AIRLINER_SHARE ? "airliner" : "lightGA";
    // Per-slot speed jitter (mirrors traffic's aSpeed jitter, lib/seed/traffic.ts:316):
    // classes on the same corridor already have different base speeds, and this
    // jitter keeps their loop periods from landing on a clean ratio — "near-coprime
    // ~120 s periods" (proposal) without a CPU scheduler.
    const speed = CLASS_SPEED[cls] * (0.9 + rng() * 0.2);
    slots.push({
      aA: [airportX, AIRPORT_Y, airportZ],
      aB: [endX, endY, endZ],
      phase: rng(),
      speedFrac: speed / segLen,
      cls,
    });
  }

  return { slots, fadeFrac: Math.min(0.3, CORRIDOR_FADE_M / segLen) };
}
