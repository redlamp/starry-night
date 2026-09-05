import seedrandom from "seedrandom";
import { type CityData, type Building } from "@/lib/seed/cityGen";
import { type District } from "@/lib/seed/district";
import { type RoadPoly } from "@/lib/seed/streets";
import { type ViewLinkPose } from "@/lib/scene/viewLink";
import { DEFAULT_INTENT, DEFAULT_MOON } from "@/lib/state/sceneDefaults";

// Vignettes (docs/PRD.md §7): a curated camera shot list over the real seeded
// city, in the spirit of the Ghost in the Shell (1995) "Ghost City" boat
// interlude — plot-free, mostly aspect-to-aspect and scene-to-scene beats
// (sky, skyline, a facade, a window) rather than a guided tour. Scott
// McCloud's panel-transition taxonomy (Understanding Comics) labels the
// RELATIONSHIP each shot has to the one before it; see
// wiki/projects/vignette-lab.md for the one-line definitions.
//
// Determinism (CLAUDE.md): every pick below comes from a seedrandom stream
// keyed `${masterSeed}::vignette::${kind}` — same seed + same city bundle in,
// byte-identical shot list out. No Math.random/Date.now/performance.now here.

export type MoveKind = "static" | "push-in" | "drift" | "orbit";

/** How the camera gets FROM the previous shot's pose INTO this one. */
export type TransitionKind = "cut" | "move";

export type McCloudTransition =
  | "moment-to-moment"
  | "action-to-action"
  | "subject-to-subject"
  | "scene-to-scene"
  | "aspect-to-aspect"
  | "non-sequitur";

export interface VignetteShot {
  id: string;
  label: string;
  pose: ViewLinkPose;
  /** Seconds the camera holds/moves on this shot before advancing. */
  holdSec: number;
  /** Continuous camera motion applied WHILE holding this shot. */
  move: MoveKind;
  /** How the camera gets here from the previous shot. */
  transitionIn: TransitionKind;
  /** Duration of the move-in, seconds. Only meaningful when transitionIn === "move". */
  transitionSec?: number;
  /** This shot's McCloud relationship to the PREVIOUS shot (first shot = the opening beat). */
  mccloud: McCloudTransition;
}

export type VignetteKind = "establishing";

export interface Vignette {
  seed: string;
  kind: VignetteKind;
  shots: VignetteShot[];
}

const DEG2RAD = Math.PI / 180;

function rngChoice<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

function rngRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

// Round to the nearest 0.5s — holds/transitions read as authored beats, not
// float noise, in the shot table and when hand-edited.
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function pickDistrict(rng: () => number, districts: District[]): District {
  const downtown = districts.filter((d) => d.character === "downtown");
  const subcentre = districts.filter((d) => d.character === "subcentre");
  const pool = downtown.length ? downtown : subcentre.length ? subcentre : districts;
  return rngChoice(rng, pool);
}

// Tall downtown building: the top slice by height within downtown (falls back
// to the tallest building anywhere if the city has no downtown district),
// then an rng pick within that slice so repeat runs of the SAME seed still
// land on the same building but different seeds see different towers.
function pickTallDowntownBuilding(rng: () => number, buildings: Building[]): Building {
  const downtown = buildings.filter((b) => b.district === "downtown");
  const pool = downtown.length ? downtown : buildings;
  const sorted = [...pool].sort((a, b) => b.height - a.height);
  const shortlist = sorted.slice(0, Math.min(8, sorted.length));
  return rngChoice(rng, shortlist);
}

function pickResidentialBuilding(rng: () => number, buildings: Building[]): Building {
  const residential = buildings.filter((b) => b.district === "residential");
  const pool = residential.length ? residential : buildings;
  return rngChoice(rng, pool);
}

type PickedRoad = { poly: RoadPoly; segIndex: number };

// A road "with traffic": prefer local streets (the in-city, walk-the-block
// feel the owner wants) over arterials, over nothing. Needs >= 2 vertices to
// have a direction to look along.
function pickRoadSegment(rng: () => number, city: CityData): PickedRoad | null {
  const candidates = (city.streets.length ? city.streets : city.arterials).filter(
    (r) => r.vertices.length >= 2,
  );
  if (!candidates.length) return null;
  const poly = rngChoice(rng, candidates);
  const segIndex = Math.floor(rng() * (poly.vertices.length - 1));
  return { poly, segIndex };
}

function poseFrom(
  position: [number, number, number],
  lookAt: [number, number, number],
  fov: number,
): ViewLinkPose {
  return { position, lookAt, fov, projection: "perspective" };
}

// Direction toward the moon's sky position, per Moon.tsx's convention:
// azimuthDeg 0 = +z, 90 = +x; elevationDeg 0 = horizon, 90 = zenith.
function moonDirection(): [number, number, number] {
  const az = DEFAULT_MOON.azimuthDeg * DEG2RAD;
  const el = DEFAULT_MOON.elevationDeg * DEG2RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

/**
 * Deterministic shot list for a seed + city + vignette kind. Pure function of
 * (masterSeed, city, kind) — same inputs always produce the same shots, so
 * this can run on the main thread with no gate1/golden implications (it reads
 * the already-generated city, never mutates generation).
 */
export function generateVignette(masterSeed: string, city: CityData, kind: VignetteKind): Vignette {
  const rng = seedrandom(`${masterSeed}::vignette::${kind}`);
  if (kind !== "establishing") {
    // Only one kind exists today — kept as a switch so a second kind is an
    // additive branch, not a signature change.
    throw new Error(`Unknown vignette kind: ${kind satisfies never}`);
  }

  const wideSkyline = poseFrom(DEFAULT_INTENT.position, DEFAULT_INTENT.lookAt, DEFAULT_INTENT.fov);

  const moonDir = moonDirection();
  const moonPose = poseFrom(
    DEFAULT_INTENT.position,
    [
      DEFAULT_INTENT.position[0] + moonDir[0] * 500,
      DEFAULT_INTENT.position[1] + moonDir[1] * 500,
      DEFAULT_INTENT.position[2] + moonDir[2] * 500,
    ],
    22,
  );

  const district = pickDistrict(rng, city.districts);
  const districtHeight = 650;
  const districtJitter = rngRange(rng, -60, 60);
  const districtPose = poseFrom(
    [district.centroidX + districtJitter, districtHeight, district.centroidZ + districtJitter],
    [district.centroidX, 0, district.centroidZ],
    50,
  );

  const facadeBuilding = pickTallDowntownBuilding(rng, city.buildings);
  const facadeAngle = rngRange(rng, 0, Math.PI * 2);
  const facadeDist = Math.max(facadeBuilding.width, facadeBuilding.depth) * 2.2 + 60;
  const facadeY = facadeBuilding.height * 0.55;
  const facadePose = poseFrom(
    [
      facadeBuilding.x + Math.sin(facadeAngle) * facadeDist,
      facadeY,
      facadeBuilding.z + Math.cos(facadeAngle) * facadeDist,
    ],
    [facadeBuilding.x, facadeY, facadeBuilding.z],
    38,
  );

  const windowBuilding = pickResidentialBuilding(rng, city.buildings);
  const windowAngle = rngRange(rng, 0, Math.PI * 2);
  const windowDist = rngRange(rng, 22, 35);
  const windowTargetY = windowBuilding.height * rngRange(rng, 0.2, 0.5);
  const windowPose = poseFrom(
    [
      windowBuilding.x + Math.sin(windowAngle) * windowDist,
      2.5,
      windowBuilding.z + Math.cos(windowAngle) * windowDist,
    ],
    [windowBuilding.x, windowTargetY, windowBuilding.z],
    28,
  );

  const roadPick = pickRoadSegment(rng, city);
  const streetPose = (() => {
    if (!roadPick) {
      // No road generated (degenerate/tiny city) — fall back to the window shot's
      // ground plane so the shot list still has 7 entries instead of throwing.
      return poseFrom(
        [windowBuilding.x, 3, windowBuilding.z + 40],
        [windowBuilding.x, 3, windowBuilding.z],
        55,
      );
    }
    const a = roadPick.poly.vertices[roadPick.segIndex];
    const b = roadPick.poly.vertices[roadPick.segIndex + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const along = rngRange(rng, 0.2, 0.8);
    const px = a.x + dx * along;
    const pz = a.z + dz * along;
    return poseFrom([px, 3, pz], [px + ux * 100, 3, pz + uz * 100], 55);
  })();

  const holds = {
    wide: roundHalf(rngRange(rng, 5, 8)),
    moon: roundHalf(rngRange(rng, 4, 6)),
    district: roundHalf(rngRange(rng, 5, 7)),
    facade: roundHalf(rngRange(rng, 4, 6)),
    window: roundHalf(rngRange(rng, 4, 7)),
    street: roundHalf(rngRange(rng, 5, 8)),
    back: roundHalf(rngRange(rng, 4, 6)),
  };

  const transitionSec = () => roundHalf(rngRange(rng, 2, 4));

  const shots: VignetteShot[] = [
    {
      id: "wide-skyline",
      label: "Wide Skyline",
      pose: wideSkyline,
      holdSec: holds.wide,
      move: "push-in",
      transitionIn: "cut",
      mccloud: "scene-to-scene",
    },
    {
      id: "the-moon",
      label: "The Moon",
      pose: moonPose,
      holdSec: holds.moon,
      move: "static",
      transitionIn: "cut",
      mccloud: "aspect-to-aspect",
    },
    {
      id: "district-from-above",
      label: "District From Above",
      pose: districtPose,
      holdSec: holds.district,
      move: "orbit",
      transitionIn: "cut",
      mccloud: "scene-to-scene",
    },
    {
      id: "building-facade",
      label: "Building Facade",
      pose: facadePose,
      holdSec: holds.facade,
      move: "static",
      transitionIn: "move",
      transitionSec: transitionSec(),
      mccloud: "aspect-to-aspect",
    },
    {
      id: "lit-window",
      label: "Lit Window",
      pose: windowPose,
      holdSec: holds.window,
      move: "static",
      transitionIn: "cut",
      mccloud: "aspect-to-aspect",
    },
    {
      id: "street-with-traffic",
      label: "Street With Traffic",
      pose: streetPose,
      holdSec: holds.street,
      move: "drift",
      transitionIn: "move",
      transitionSec: transitionSec(),
      mccloud: "action-to-action",
    },
    {
      id: "back-to-wide",
      label: "Back To Wide",
      pose: wideSkyline,
      holdSec: holds.back,
      move: "static",
      transitionIn: "move",
      transitionSec: transitionSec(),
      mccloud: "scene-to-scene",
    },
  ];

  return { seed: masterSeed, kind, shots };
}
