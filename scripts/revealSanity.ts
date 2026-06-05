/**
 * Road-reveal schedule sanity (#spec 2026-06-05-road-reveal-cascade):
 *  1. DETERMINISM: two builds over the same city are identical.
 *  2. RANGE: every reveal time is in [0, 1]; max ≈ 1.
 *  3. GROWTH: along any poly, reveal time is minimal at the attach arc and
 *     non-decreasing with distance from it.
 *  4. CHILD-AFTER-PARENT: an attached arterial starts no earlier than its
 *     highway junction reveals; same for streets vs arterials.
 *
 *   bun run scripts/revealSanity.ts
 */
import { generateCity } from "@/lib/seed/cityGen";
import { setCityTier } from "@/lib/seed/topology";
import { buildRevealSchedule, type RevealTier } from "@/lib/scene/roadReveal";

setCityTier("city");
const city = generateCity("gate1-0");
const highways = city.topology.highways.map((h) => ({ vertices: h.vertices, closed: h.closed }));
const arterials = city.arterials.map((a) => ({ vertices: a.vertices }));
const streets = city.streets.map((s) => ({ vertices: s.vertices }));
const centre = { x: 0, z: 0 };

const build = () => buildRevealSchedule(highways, arterials, streets, centre);
const sched = build();
const sched2 = build();

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${name.padEnd(28)} ${ok ? "PASS" : `FAIL ${detail}`}`);
  if (!ok) failed++;
};

const tiers: Array<[RevealTier, { vertices: { x: number; z: number }[] }[]]> = [
  [0, highways],
  [1, arterials],
  [2, streets],
];

// 1. determinism — sample reveal times across all polys, compare builds.
{
  let mismatch = 0;
  for (const [tier, polys] of tiers)
    for (let p = 0; p < polys.length; p++)
      for (const arc of [0, 1, 50, 200])
        if (sched.revealAt(tier, p, arc) !== sched2.revealAt(tier, p, arc)) mismatch++;
  check("determinism", mismatch === 0, `${mismatch} mismatches`);
}

// 2. range — all sampled times in [0,1], max close to 1.
{
  let min = Infinity,
    max = -Infinity;
  for (const [tier, polys] of tiers)
    for (let p = 0; p < polys.length; p++) {
      const info = sched.polyInfo(tier, p);
      for (const arc of [0, info.len * 0.25, info.len * 0.5, info.len]) {
        const t = sched.revealAt(tier, p, arc);
        min = Math.min(min, t);
        max = Math.max(max, t);
      }
    }
  check("range [0,1]", min >= 0 && max <= 1 + 1e-9, `min=${min} max=${max}`);
  check("max ≈ 1", max > 0.999, `max=${max}`);
}

// 3. growth — time at attachArc ≤ time anywhere else on the poly.
{
  let bad = 0;
  for (const [tier, polys] of tiers)
    for (let p = 0; p < polys.length; p++) {
      const info = sched.polyInfo(tier, p);
      const tAttach = sched.revealAt(tier, p, info.attachArc);
      for (const arc of [0, info.len * 0.5, info.len])
        if (sched.revealAt(tier, p, arc) < tAttach - 1e-9) bad++;
    }
  check("growth from attach", bad === 0, `${bad} violations`);
}

// 4. child-after-parent — attached children start ≥ parent junction time.
{
  let bad = 0,
    attached = 0;
  for (const tier of [1, 2] as RevealTier[]) {
    const polys = tier === 1 ? arterials : streets;
    for (let p = 0; p < polys.length; p++) {
      const info = sched.polyInfo(tier, p);
      if (info.parentTime === null) continue; // radial orphan — no constraint
      attached++;
      if (sched.revealAt(tier, p, info.attachArc) < info.parentTime - 1e-9) bad++;
    }
  }
  check("child after parent", bad === 0, `${bad}/${attached} attached violate`);
  console.log(`  (info) ${attached} attached children`);
}

console.log(failed === 0 ? "\nREVEAL SANITY PASS" : `\nREVEAL SANITY FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
