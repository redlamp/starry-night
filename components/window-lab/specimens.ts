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
  warehouse: { col: 5.0, floor: 4.2 },
};

const DISTRICT_FOR: Partial<Record<Archetype, Building["district"]>> = {
  "office-block": "downtown",
  "narrow-tower": "downtown",
  "residential-tower": "residential",
  "mid-rise": "oldtown",
  warehouse: "industrial",
};

function makeSpecimens(): Building[] {
  const rng = seedrandom(`${LAB_SEED}::specimens`);
  const list: Building[] = [];
  let id = 0;

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
  const wallArch: Archetype[] = ["office-block", "residential-tower", "office-block"];
  for (let i = 0; i < 5; i++) {
    add(-140, -60 - i * 160, 45, 45, 120 + rng() * 70, wallArch[i % 3], 0);
  }

  // Mid cluster: mixed archetypes (bands, curtain offices, a warehouse) at the
  // distance where cells sit a few pixels wide from the default poses.
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

  // Far forest: a slightly rotated grid so faces hit many grazing angles at
  // once — the confetti regime under any telephoto-ish pose.
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

  return list;
}

export const SPECIMENS: Building[] = makeSpecimens();

// Camera presets, one per artifact regime (aimed at rack A; pan right for B).
export type LabPose = { id: string; name: string; pos: [number, number, number]; target: [number, number, number] };
export const LAB_POSES: LabPose[] = [
  { id: "overview", name: "Overview", pos: [450, 420, 860], target: [450, 60, -1200] },
  { id: "graze", name: "Graze wall", pos: [-100, 60, 60], target: [-125, 110, -700] },
  { id: "mid", name: "Mid cluster", pos: [30, 150, -380], target: [30, 90, -860] },
  { id: "far", name: "Far forest", pos: [0, 170, 250], target: [50, 110, -2400] },
];
