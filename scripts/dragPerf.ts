/**
 * #61 drag-perf harness — measures the #55 tile-cull frame-loop cost under a
 * simulated camera drag, headless (no browser, no GPU). Replicates exactly what
 * InstancedCity's useFrame does per archetype mesh: visibleTiles → signature
 * compare → compactVisible over the real channel layout (34 floats/instance).
 *
 * Reports, for drag (azimuth sweep) vs static camera:
 *   - churn rate: fraction of frames whose visible-tile signature changed
 *   - CPU ms/frame: AABB tests + signature build vs compaction memcpy
 *   - bytes WRITTEN per churn frame (visible slices)
 *   - bytes UPLOADED per churn frame (Three re-uploads the FULL buffer when
 *     needsUpdate is set with no updateRange — this is the GPU-side proxy)
 *
 *   bun run scripts/dragPerf.ts
 */
import * as THREE from "three";
import { generateCity } from "@/lib/seed/cityGen";
import { setCityTier, type CityTier, CITY_SCALE } from "@/lib/seed/topology";
import {
  partitionByTile,
  reorderToTiles,
  visibleTiles,
  compactVisible,
  type CompactChannel,
  type TilePartition,
} from "@/lib/scene/tileCull";

const SEED = "gate1-0";
const FRAMES = 600; // 10 s at 60 fps
const DT = 1 / 60;
const DRAG_DEG_PER_S = 45; // brisk manual drag
const ORBIT = { centerX: 0, centerZ: -120, radius: 2400 * CITY_SCALE, elevationDeg: 6 };
// itemSizes of InstancedCity's real channels: instanceMatrix + 8 instanced attrs.
const CITY_CHANNEL_SIZES = [16, 2, 2, 3, 3, 1, 1, 3, 3];

type ArchSim = { partition: TilePartition; channels: CompactChannel[]; lastSig: string };

function buildSims(tier: CityTier): { sims: ArchSim[]; buildings: number } {
  setCityTier(tier);
  const { buildings } = generateCity(SEED);
  const byArchetype = new Map<string, { x: number; z: number; height: number }[]>();
  for (const b of buildings) {
    const list = byArchetype.get(b.archetype) ?? [];
    list.push(b);
    byArchetype.set(b.archetype, list);
  }
  const sims: ArchSim[] = [];
  for (const list of byArchetype.values()) {
    const partition = partitionByTile(
      list.length,
      (i) => list[i].x,
      (i) => list[i].z,
      (i) => list[i].height + 10,
    );
    const channels: CompactChannel[] = CITY_CHANNEL_SIZES.map((itemSize) => {
      const flat = new Float32Array(list.length * itemSize); // content irrelevant to cost
      return {
        src: reorderToTiles(partition, flat, itemSize),
        dst: new THREE.BufferAttribute(flat.slice(), itemSize),
        itemSize,
      };
    });
    sims.push({ partition, channels, lastSig: "" });
  }
  return { sims, buildings: buildings.length };
}

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 24000);
  return cam;
}

function poseCamera(cam: THREE.PerspectiveCamera, azimuthRad: number): void {
  const el = (ORBIT.elevationDeg * Math.PI) / 180;
  cam.position.set(
    ORBIT.centerX + ORBIT.radius * Math.cos(el) * Math.cos(azimuthRad),
    ORBIT.radius * Math.sin(el),
    ORBIT.centerZ + ORBIT.radius * Math.cos(el) * Math.sin(azimuthRad),
  );
  cam.lookAt(ORBIT.centerX, 80, ORBIT.centerZ);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
}

type Result = {
  churnFrames: number;
  cullMs: number;
  compactMs: number;
  maxFrameMs: number;
  writtenBytes: number;
  uploadedBytes: number;
};

function run(sims: ArchSim[], drag: boolean): Result {
  const cam = makeCamera();
  const frustum = new THREE.Frustum();
  const visible: number[] = [];
  for (const s of sims) s.lastSig = ""; // first frame always materialises
  const r: Result = {
    churnFrames: 0,
    cullMs: 0,
    compactMs: 0,
    maxFrameMs: 0,
    writtenBytes: 0,
    uploadedBytes: 0,
  };
  for (let f = 0; f < FRAMES; f++) {
    poseCamera(cam, drag ? f * DT * ((DRAG_DEG_PER_S * Math.PI) / 180) : 0.7);
    let frameMs = 0;
    let churned = false;
    for (const sim of sims) {
      const t0 = performance.now();
      const sig = visibleTiles(sim.partition, cam, frustum, visible);
      const t1 = performance.now();
      r.cullMs += t1 - t0;
      frameMs += t1 - t0;
      if (sig !== sim.lastSig) {
        churned = true;
        sim.lastSig = sig;
        const c0 = performance.now();
        const count = compactVisible(sim.partition, visible, sim.channels);
        const c1 = performance.now();
        r.compactMs += c1 - c0;
        frameMs += c1 - c0;
        for (const ch of sim.channels) {
          r.writtenBytes += count * ch.itemSize * 4;
          r.uploadedBytes += (ch.dst.array as Float32Array).byteLength; // full-buffer upload
        }
      }
    }
    if (f > 0 && churned) r.churnFrames++; // frame 0 is the unavoidable first fill
    if (f > 0 && frameMs > r.maxFrameMs) r.maxFrameMs = frameMs;
  }
  return r;
}

const fmt = (n: number) => n.toFixed(3);
const mb = (n: number) => (n / (1024 * 1024)).toFixed(2);

for (const tier of [3, 6] as CityTier[]) {
  const { sims, buildings } = buildSims(tier);
  const tiles = sims.reduce((a, s) => a + s.partition.tiles.length, 0);
  console.log(
    `\n=== tier ${tier} — ${buildings} buildings, ${sims.length} archetypes, ${tiles} tile boxes ===`,
  );
  for (const drag of [false, true]) {
    const res = run(sims, drag);
    const frames = FRAMES - 1;
    const churnPct = ((100 * res.churnFrames) / frames).toFixed(1);
    console.log(
      `${drag ? "DRAG  " : "STATIC"} churn ${churnPct}% of frames | ` +
        `cull ${fmt(res.cullMs / frames)} ms/f | compact ${fmt(res.compactMs / frames)} ms/f | ` +
        `max frame ${fmt(res.maxFrameMs)} ms | ` +
        `written ${mb(res.writtenBytes / frames)} MB/f | uploaded ${mb(res.uploadedBytes / frames)} MB/f`,
    );
  }
}
