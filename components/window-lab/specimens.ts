import seedrandom from "seedrandom";
import type { Archetype, Building } from "@/lib/seed/cityGen";

// The Window Lab specimen rack: a small, fixed, deterministic set of buildings
// arranged to reproduce the three window-artifact regimes from #82 in one scene —
//   graze wall   — a row of towers seen edge-on (anisotropic footprint churn)
//   mid cluster  — the 2.5–8 px cell band (moiré / mullion beat)
//   far forest   — sub-pixel cells in BOTH axes (per-cell confetti)
// Every approach renders this same list, so differences on screen are the
// approach, never the specimens. Coordinates are three.js world space (Y up,
// rack extends away from the default camera along -Z).

export const LAB_SEED = "window-lab";

// World-space X offset between the two racks (slot A at x=0, slot B at +RACK_GAP).
export const RACK_GAP = 900;

// Facade metres per window column / per floor, mirroring cityGen's archetype
// pitch so specimen window grids land in the same density regime as the city.
const PITCH: Partial<Record<Archetype, { col: number; floor: number }>> = {
  "office-block": { col: 3.4, floor: 3.6 },
  "residential-tower": { col: 3.6, floor: 3.0 },
  "narrow-tower": { col: 3.0, floor: 3.4 },
  "mid-rise": { col: 3.8, floor: 3.1 },
  "low-rise": { col: 4.0, floor: 3.0 },
  warehouse: { col: 5.0, floor: 4.2 },
};

const DISTRICT_FOR: Partial<Record<Archetype, Building["district"]>> = {
  "office-block": "downtown",
  "narrow-tower": "downtown",
  "residential-tower": "residential",
  "low-rise": "residential",
  "mid-rise": "oldtown",
  warehouse: "industrial",
};

// One entry per specimen group: name + ground-outline colour + the artifact
// regime it reproduces (shown behind the legend's "?" marker). rect is the
// group's ground bounding box in rack-local space, computed from the specimens.
export type SpecimenGroup = {
  id: string;
  name: string;
  color: string;
  blurb: string;
  rect: { x0: number; z0: number; x1: number; z1: number };
};

function makeSpecimens(): { list: Building[]; groups: SpecimenGroup[] } {
  const rng = seedrandom(`${LAB_SEED}::specimens`);
  const list: Building[] = [];
  const groups: SpecimenGroup[] = [];
  let id = 0;

  // Wraps a group's add() calls, then bounds the footprints it produced
  // (half-diagonal covers rotated boxes) into the legend/outline rect.
  const group = (gid: string, name: string, color: string, blurb: string, build: () => void) => {
    const start = list.length;
    build();
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = start; i < list.length; i++) {
      const b = list[i];
      const r = Math.hypot(b.width, b.depth) / 2;
      x0 = Math.min(x0, b.x - r);
      x1 = Math.max(x1, b.x + r);
      z0 = Math.min(z0, b.z - r);
      z1 = Math.max(z1, b.z + r);
    }
    const pad = 16;
    groups.push({
      id: gid,
      name,
      color,
      blurb,
      rect: { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad },
    });
  };

  const add = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    archetype: Archetype,
    rotationY: number,
  ) => {
    const pitch = PITCH[archetype] ?? { col: 3.5, floor: 3.4 };
    list.push({
      id: id++,
      x,
      z,
      width,
      depth,
      height,
      rotationY,
      archetype,
      layer: "mid",
      district: DISTRICT_FOR[archetype] ?? "downtown",
      districtId: "lab",
      coreProximity: rng(),
      windowSeed: rng(),
      rowsPerFloor: 1,
      colsPerFace: Math.max(3, Math.round(width / pitch.col)),
      floors: Math.max(3, Math.round(height / pitch.floor)),
    });
  };

  // Graze wall: identical footprints in a straight file so the +X faces form a
  // near-continuous plane the camera can sight along.
  group(
    "graze",
    "Graze wall",
    "#3fd0e0",
    "Towers in a file, seen edge-on. Grazing faces compress window cells in one screen axis — the anisotropic regime (vertical stripe churn, diagonal crawl).",
    () => {
      const wallArch: Archetype[] = ["office-block", "residential-tower", "office-block"];
      for (let i = 0; i < 5; i++) {
        add(-140, -60 - i * 160, 45, 45, 120 + rng() * 70, wallArch[i % 3], 0);
      }
    },
  );

  // Mid cluster: mixed archetypes (bands, curtain offices, a warehouse) at the
  // distance where cells sit a few pixels wide from the default poses.
  group(
    "mid",
    "Mid cluster",
    "#ffd166",
    "Mixed archetypes at the distance where window cells sit 2.5-8 px wide — the moire / mullion-beat band.",
    () => {
      const midArch: Archetype[] = [
        "office-block",
        "residential-tower",
        "warehouse",
        "narrow-tower",
        "mid-rise",
        "office-block",
        "residential-tower",
        "office-block",
        "mid-rise",
      ];
      for (let i = 0; i < 9; i++) {
        const gx = -60 + (i % 3) * 90;
        const gz = -700 - Math.floor(i / 3) * 120;
        const arch = midArch[i];
        const h = arch === "warehouse" ? 24 + rng() * 14 : 90 + rng() * 110;
        const w = arch === "warehouse" ? 80 : 40 + rng() * 25;
        add(gx, gz, w, w * (0.8 + rng() * 0.4), h, arch, (rng() - 0.5) * 0.5);
      }
    },
  );

  // Suburbs: small low-rise stock in the empty patch between the graze wall
  // and the mid cluster (user 2026-07-03, red-rectangle screenshot). Few-cell
  // window grids close to the camera — the regime where per-window integrity
  // matters most (any wash/LOD misfire reads as swelling immediately).
  group(
    "suburb",
    "Suburbs",
    "#5fcf7a",
    "Small low-rise buildings with few-cell window grids. Windows are large on screen, so any LOD misfire (swelling, dimming) is immediately visible here.",
    () => {
      for (let i = 0; i < 18; i++) {
        const gx = 30 + (i % 4) * 62;
        const gz = -190 - Math.floor(i / 4) * 76;
        const warehouse = i % 7 === 3;
        add(
          gx + (rng() - 0.5) * 18,
          gz + (rng() - 0.5) * 18,
          warehouse ? 34 : 14 + rng() * 12,
          warehouse ? 26 : 12 + rng() * 12,
          warehouse ? 10 + rng() * 4 : 7 + rng() * 12,
          warehouse ? "warehouse" : "low-rise",
          (rng() - 0.5) * 0.7,
        );
      }
    },
  );

  // Far forest: a slightly rotated grid so faces hit many grazing angles at
  // once — the confetti regime under any telephoto-ish pose.
  group(
    "far",
    "Far forest",
    "#b388ff",
    "A rotated grid far enough out that window cells drop under a pixel in BOTH axes — the per-cell confetti regime.",
    () => {
      const farArch: Archetype[] = ["office-block", "residential-tower", "narrow-tower"];
      for (let i = 0; i < 30; i++) {
        const gx = -200 + (i % 6) * 100;
        const gz = -2000 - Math.floor(i / 6) * 200;
        add(
          gx + (rng() - 0.5) * 30,
          gz + (rng() - 0.5) * 40,
          50 + rng() * 20,
          50 + rng() * 20,
          100 + rng() * 160,
          farArch[i % 3],
          (rng() - 0.5) * 0.9,
        );
      }
    },
  );

  return { list, groups };
}

const built = makeSpecimens();
export const SPECIMENS: Building[] = built.list;
export const SPECIMEN_GROUPS: SpecimenGroup[] = built.groups;

// Camera presets, one per artifact regime (aimed at rack A; pan right for B).
export type LabPose = { id: string; name: string; pos: [number, number, number]; target: [number, number, number] };
export const LAB_POSES: LabPose[] = [
  { id: "overview", name: "Overview", pos: [450, 420, 860], target: [450, 60, -1200] },
  { id: "graze", name: "Graze wall", pos: [-100, 60, 60], target: [-125, 110, -700] },
  { id: "mid", name: "Mid cluster", pos: [30, 150, -380], target: [30, 90, -860] },
  { id: "suburb", name: "Suburbs", pos: [150, 55, -40], target: [120, 8, -380] },
  { id: "far", name: "Far forest", pos: [0, 170, 250], target: [50, 110, -2400] },
];
