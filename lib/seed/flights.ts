import seedrandom from "seedrandom";
import { CITY_CENTER, maxHalfExtent } from "./topology";

// Ambient departure corridor (#67 v1 / v1.5) + fly-by corridors (#67
// multi-route follow-up, user 2026-07-04). One seeded off-map "airport"
// anchor with a single RUNWAY HEADING drives the ORIGINAL corridor; corridors
// are geometry keyed off an axis, and plane slots reference a corridor by
// index — the Traffic slot pattern (lib/seed/traffic.ts:248 rng chain,
// lib/shaders/traffic.ts:41 the fract-mix slide). Own rng chain keyed
// `${masterSeed}::flights`, so this never perturbs cityGen/traffic/beacons
// streams (PRD §5 determinism contract) — gate1 asserts on generateCity()
// alone and is untouched here.
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
// Fly-by corridors (#67 multi-route follow-up): most air traffic isn't going
// to or from anywhere nearby — it's cruise overflight, so most routes should
// NOT imply an airport. Each fly-by is a straight line with no airport
// anchor: a seeded heading + a signed lateral offset off the city centre
// place its closest approach, then the SAME axis-vs-circle intersection the
// departure corridor uses for its far exit (axisCircleRoots below) solves for
// BOTH endpoints symmetrically — the line enters off-map on one side and
// exits off-map on the other. Altitude is CONSTANT (level cruise, no climb)
// and independently seeded per corridor so crossing traffic reads at
// different heights as well as different angles.
//
// Corridor maths (GH #67 design comment):
//   - airport = azimuth + distance rolled just past the ground disc edge
//     (Ground.tsx:22 GROUND_APRON_M=200), 2-6 km out. Never rendered.
//   - the departure corridor's far end is the mirror: the point where the
//     runway axis re-crosses discEdge + CORRIDOR_FAR_MARGIN_M on the OPPOSITE
//     side of the centre.
//   - departure altitude is LINEAR along the segment (a 3-4 deg climb off a
//     low airport start) — mix(aA, aB, t) alone produces the climb.
//   - departures only: t=0 at the airport (low), t=1 off-map on the far side
//     (climbed to cruise). Arrivals (v2) reverse the roles on the reciprocal
//     heading — a data addition (one more Corridor + slots referencing it).
//   - fly-bys: t=0 and t=1 are both off-map circle crossings, altitude fixed
//     — no low end, no airport, no climb.

export type FlightClass = "airliner" | "lightGA";

export type Corridor = {
  aA: [number, number, number]; // departure: airport-side start (low). fly-by: one off-map crossing.
  aB: [number, number, number]; // departure: near-city end (climbed). fly-by: the opposite off-map crossing.
  // Corridor-end fade width, as a FRACTION of segment length (proposal: fade
  // over the last ~500 m at each end so spawn/despawn never pops). Lives on
  // the corridor rather than the slot since different corridors have
  // different lengths and therefore different fade fractions.
  fadeFrac: number;
  kind: "departure" | "flyby"; // v2 may still add "arrival" on the reciprocal heading
};

export type FlightSlot = {
  corridor: number; // index into FlightsData.corridors
  phase: number; // 0..1 (fract(uTime*speedFrac+phase) — see lib/shaders/flights.ts)
  speedFrac: number; // segment-fractions per second (mirrors traffic's aSpeed)
  cls: FlightClass;
};

export type FlightsData = {
  // Runway axis anchor for the ONE departure corridor. headingDeg follows the
  // same compass convention as the moon (0 = +z north, 90 = +x east;
  // sceneStore.ts moon.azimuthDeg), so a future arrival corridor can reuse it
  // directly as (headingDeg + 180) % 360. Fly-by corridors have no anchor —
  // FlightRoutes only draws the airport marker for the "departure" corridor.
  airport: { x: number; z: number; headingDeg: number };
  corridors: Corridor[]; // [0] is always the departure corridor; the rest are fly-bys
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
const AIRLINER_SHARE = 0.55; // seeded per-slot coin, every slot on every corridor
// The runway axis is aimed to pass over the OUTSKIRTS, not dead centre — a
// seeded perpendicular offset off the airport->centre line, in the requested
// 1.5-3.5 km periphery band. Capped to 0.75*discEdge at build time so the axis
// still crosses a solid chord of the built disc on small tiers (a larger
// offset would carry the whole route outside the city, with nothing to fly
// over).
const RUNWAY_AIM_OFFSET_MIN_M = 1500;
const RUNWAY_AIM_OFFSET_MAX_M = 3500;

// Fly-by corridors (#67 multi-route follow-up): no airport, level cruise,
// crossing traffic at varied headings/altitudes. Count is seeded 2-4; the
// altitude band sits above the departure corridor's low/climbing end and well
// under the star shell (sceneDefaults.ts — 6400 m radius).
const FLYBY_COUNT_MIN = 2;
const FLYBY_COUNT_MAX = 4; // inclusive
const FLYBY_ALT_MIN_M = 400;
const FLYBY_ALT_MAX_M = 900;
// Signed lateral offset (fraction of discEdge) for a fly-by's closest
// approach to the centre — wider AND signed vs. the departure's
// periphery-only band, so routes vary from near-overhead downtown to grazing
// the edge. Capped under 1 so every fly-by still crosses a real chord of the
// far circle (never a vanishing/tangent line).
const FLYBY_OFFSET_MAX_FRAC = 0.85;

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

// Signed distances s along the line P0 + s*dir (dir a unit vector) where it
// crosses the circle of radius r centred on CITY_CENTER. Shared by the
// departure corridor's far exit (needs the larger root — the airport already
// sits at/past the circle) and the fly-by corridors' both endpoints (P0 is
// their closest approach, so the two roots come out symmetric: +-sqrt(r^2 -
// offset^2)) — one "axis vs circle" intersection, two call sites.
function axisCircleRoots(
  p0x: number,
  p0z: number,
  dirX: number,
  dirZ: number,
  r: number,
): [number, number] {
  const dcx = p0x - CITY_CENTER.x;
  const dcz = p0z - CITY_CENTER.z;
  const b = dcx * dirX + dcz * dirZ;
  const c = dcx * dcx + dcz * dcz - r * r;
  const disc = Math.sqrt(Math.max(0, b * b - c));
  return [-b - disc, -b + disc];
}

export function buildFlights(masterSeed: string): FlightsData {
  const rng = seedrandom(`${masterSeed}::flights`);
  const half = maxHalfExtent();
  const discEdge = half + GROUND_APRON_M;
  const rFar = discEdge + CORRIDOR_FAR_MARGIN_M;

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
  // world on the FAR side — the larger root (the airport already sits at/past
  // rFar, so the far crossing is the one on the opposite side of the centre).
  const dirLen = Math.hypot(headX, headZ) || 1;
  const dirX = headX / dirLen;
  const dirZ = headZ / dirLen;
  const [, sFar] = axisCircleRoots(airportX, airportZ, dirX, dirZ, rFar);
  const endX = airportX + dirX * sFar;
  const endZ = airportZ + dirZ * sFar;

  // Departure climb: linear from the low airport across the whole corridor.
  const glideDeg = GLIDE_DEG_MIN + rng() * (GLIDE_DEG_MAX - GLIDE_DEG_MIN);
  const horiz = sFar; // dir is a unit vector in xz, so sFar is the horizontal run
  const endY = AIRPORT_Y + horiz * Math.tan(glideDeg * DEG2RAD);
  const segLen = Math.hypot(horiz, endY - AIRPORT_Y);

  const departureCorridor: Corridor = {
    aA: [airportX, AIRPORT_Y, airportZ],
    aB: [endX, endY, endZ],
    fadeFrac: Math.min(0.3, CORRIDOR_FADE_M / segLen),
    kind: "departure",
  };

  // Fly-by corridors (#67 multi-route follow-up): no airport, level cruise,
  // crossing traffic at varied headings/altitudes. Each rolls its own heading
  // + signed lateral offset off the centre for its closest approach P0, then
  // axisCircleRoots solves both endpoints in one call (P0 is already the
  // perpendicular foot, so the roots come out as +-sqrt(rFar^2 - offset^2)).
  const flybyCount = FLYBY_COUNT_MIN + Math.floor(rng() * (FLYBY_COUNT_MAX - FLYBY_COUNT_MIN + 1));
  const flybyCorridors: Corridor[] = [];
  for (let i = 0; i < flybyCount; i++) {
    const heading = rng() * Math.PI * 2; // full 0-360 — unlike the departure, not aimed at the city
    const dX = Math.sin(heading);
    const dZ = Math.cos(heading);
    const offset = (rng() * 2 - 1) * FLYBY_OFFSET_MAX_FRAC * discEdge;
    const p0x = CITY_CENTER.x - dZ * offset; // perpendicular to (dX,dZ), same rotation as perpX/perpZ above
    const p0z = CITY_CENTER.z + dX * offset;
    const [s0, s1] = axisCircleRoots(p0x, p0z, dX, dZ, rFar);
    const altitude = FLYBY_ALT_MIN_M + rng() * (FLYBY_ALT_MAX_M - FLYBY_ALT_MIN_M);
    const flybyLen = s1 - s0;
    flybyCorridors.push({
      aA: [p0x + dX * s0, altitude, p0z + dZ * s0],
      aB: [p0x + dX * s1, altitude, p0z + dZ * s1],
      fadeFrac: Math.min(0.3, CORRIDOR_FADE_M / flybyLen),
      kind: "flyby",
    });
  }

  const corridors: Corridor[] = [departureCorridor, ...flybyCorridors];

  // Slots, spread across every corridor — a few each (#67 multi-route
  // follow-up), aiming ~5-8 planes total rather than piling them onto one
  // route. Each corridor independently rolls 1-2 slots; class is a per-slot
  // coin (55% airliner) — no longer pinned to specific slot indices now that
  // variety comes from having several routes instead of one.
  const slots: FlightSlot[] = [];
  for (let c = 0; c < corridors.length; c++) {
    const len = corridorLength(corridors[c]);
    const slotsHere = 1 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < slotsHere; i++) {
      const cls: FlightClass = rng() < AIRLINER_SHARE ? "airliner" : "lightGA";
      // Per-slot speed jitter (mirrors traffic's aSpeed jitter): keeps loop
      // periods off a clean ratio so planes don't pulse in lockstep.
      const speed = CLASS_SPEED[cls] * (0.9 + rng() * 0.2);
      slots.push({ corridor: c, phase: rng(), speedFrac: speed / len, cls });
    }
  }

  return {
    airport: { x: airportX, z: airportZ, headingDeg },
    corridors,
    slots,
  };
}
