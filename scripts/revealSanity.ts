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
import { buildRevealSchedule, type RevealTier, type RevealPolyInput } from "@/lib/scene/roadReveal";
import { buildRoadGeometry } from "@/lib/seed/roadMesh";

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

const tiers: Array<[RevealTier, RevealPolyInput[]]> = [
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

// 5. closed ring — synthetic fixture (current seeds may have no rings, but
//    topology kinds ring/ring-radial produce closed highways): the wave grows
//    both ways around and never exceeds 1.
{
  const ring = [
    {
      vertices: [
        { x: 0, z: -200 },
        { x: 200, z: 0 },
        { x: 0, z: 200 },
        { x: -200, z: 0 },
      ],
      closed: true as const,
    },
  ];
  const rs = buildRevealSchedule(ring, [], [], { x: 0, z: 0 });
  const info = rs.polyInfo(0, 0);
  let ringMax = -Infinity;
  for (let f = 0; f <= 1.0001; f += 0.02) {
    const t = rs.revealAt(0, 0, info.len * f);
    if (t > ringMax) ringMax = t;
  }
  check("closed ring max ≤ 1", ringMax <= 1 + 1e-9, `max=${ringMax}`);
}

// 6. geometry back-compat — aReveal exists, one value per vertex, all zero
//    without revealOf (back-compat with Roads.tsx before Task 4 wires it in).
{
  const stPolys = city.streets.map((s) => ({ vertices: s.vertices, width: s.width }));
  const geoPlain = buildRoadGeometry(stPolys);
  const plainReveal = geoPlain.getAttribute("aReveal");
  const allZero = (plainReveal.array as Float32Array).every((x) => x === 0);
  check(
    "geometry back-compat",
    plainReveal.count === geoPlain.getAttribute("position").count && allZero,
  );

  // 7. geometry reveal range — schedule-fed values all within [0, 1+1e-9].
  const geo = buildRoadGeometry(stPolys, (p, arc) => sched.revealAt(2, p, arc));
  const arr = geo.getAttribute("aReveal").array as Float32Array;
  let out = 0;
  for (const x of arr) if (x < 0 || x > 1 + 1e-9) out++;
  check("geometry reveal range", out === 0, `${out} out of range`);
}

console.log(failed === 0 ? "\nREVEAL SANITY PASS" : `\nREVEAL SANITY FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
