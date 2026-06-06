# Road Reveal Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roads draw themselves in centre-out (highways → arterials → streets, each sprouting from its junction) instead of snapping in; the GenTrace blueprint softens into the cascade during worker generation.

**Architecture:** A pure schedule builder (`lib/scene/roadReveal.ts`) computes per-poly reveal times from road geometry (junction-attach by proximity, radial fallback for orphans). `buildRoadGeometry` threads a per-vertex `aReveal` attribute; a minimal ShaderMaterial clips fragments past `uProgress` with a bright wavefront tip. One shared uniform singleton drives all tiers; a ticker advances it from time-since-cityReady. GenTrace gains per-vertex birth/fraction attributes for line draw-on and fades under the cascade.

**Tech Stack:** Three.js + R3F, Zustand, Bun scripts for headless verification (no jest — this repo verifies via `scripts/*.ts` PASS/FAIL + visual gate).

**Spec:** `docs/specs/2026-06-05-road-reveal-cascade.md` (approved 2026-06-05).

**Project gates (override skill defaults):**
- Branch: `feature/road-reveal` off `dev` (Task 0).
- **Commits require a user signal per project CLAUDE.md.** Ask once at execution start: "commit after each task as I go?" If declined, skip every Commit step and report instead.
- Determinism contract: schedule is a pure function of geometry; `scripts/cityGolden.ts` must stay byte-identical throughout.

---

### Task 0: Branch

- [ ] **Step 0.1:** `git checkout dev && git pull && git checkout -b feature/road-reveal`

---

### Task 1: Schedule builder (pure) + sanity script

**Files:**
- Create: `lib/scene/roadReveal.ts`
- Create: `scripts/revealSanity.ts`

- [ ] **Step 1.1: Write the failing sanity script**

```ts
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
  let min = Infinity, max = -Infinity;
  for (const [tier, polys] of tiers)
    for (let p = 0; p < polys.length; p++) {
      const info = sched.polyInfo(tier, p);
      for (const arc of [0, info.len * 0.25, info.len * 0.5, info.len]) {
        const t = sched.revealAt(tier, p, arc);
        min = Math.min(min, t); max = Math.max(max, t);
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
  let bad = 0, attached = 0;
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
```

- [ ] **Step 1.2: Run to verify it fails**

Run: `bun run scripts/revealSanity.ts`
Expected: FAIL — `Cannot find module '@/lib/scene/roadReveal'`

- [ ] **Step 1.3: Implement `lib/scene/roadReveal.ts`**

```ts
// Road-reveal cascade schedule (spec: docs/specs/2026-06-05-road-reveal-cascade.md).
// Pure function of road geometry → per-poly reveal times, normalized 0..1.
// Highways grow from their point nearest the centre; arterials attach to the
// nearest highway point (within EPS) and sprout when the wavefront reveals
// that junction; streets attach to arterials the same way. Orphans (random
// infill seeds with no parent in range) fall back to a radial wavefront so
// they join the wave instead of popping. Never stored — recomputed with the
// geometry (two-tier state rule).

export type RevealVec2 = { x: number; z: number };
export type RevealPolyInput = { vertices: RevealVec2[]; closed?: boolean };
export type RevealTier = 0 | 1 | 2; // 0 highways, 1 arterials, 2 streets

// Abstract m/s — only ratios matter (the result is normalized). LAG is the
// beat between a junction lighting up and its child starting to grow.
const SPEED: Record<RevealTier, number> = { 0: 1200, 1: 700, 2: 900 };
const RADIAL_SPEED = 900;
const ATTACH_EPS = 60; // m — max junction distance for a parent attach
const LAG = 0.15; // s

type PolySched = {
  start: number; // seconds at which growth begins from attachArc
  attachArc: number;
  speed: number;
  len: number;
  closed: boolean;
  cum: number[]; // cumulative arc length per vertex
  parentTime: number | null; // parent junction reveal time (null = radial orphan)
};

export type RevealSchedule = {
  /** Normalized reveal time (0..1) at arc-distance `arc` along poly `p` of `tier`. */
  revealAt(tier: RevealTier, p: number, arc: number): number;
  /** Introspection for sanity checks / geometry building. */
  polyInfo(tier: RevealTier, p: number): PolySched;
};

function cumLengths(v: RevealVec2[], closed: boolean): number[] {
  const cum = [0];
  const n = closed ? v.length + 1 : v.length;
  for (let i = 1; i < n; i++) {
    const a = v[(i - 1) % v.length];
    const b = v[i % v.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return cum;
}

// Arc distance between two arcs on a poly (shortest way around for rings).
function arcDist(a: number, b: number, len: number, closed: boolean): number {
  const d = Math.abs(a - b);
  return closed ? Math.min(d, len - d) : d;
}

// Spatial hash of parent points → nearest (point, polyIdx, arc) lookup.
class PointHash {
  private cells = new Map<string, Array<{ x: number; z: number; poly: number; arc: number }>>();
  constructor(private cell: number) {}
  add(x: number, z: number, poly: number, arc: number) {
    const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    const list = this.cells.get(k);
    const e = { x, z, poly, arc };
    if (list) list.push(e);
    else this.cells.set(k, [e]);
  }
  nearest(x: number, z: number, maxDist: number) {
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best: { poly: number; arc: number; d: number } | null = null;
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const list = this.cells.get(`${ix},${iz}`);
        if (!list) continue;
        for (const e of list) {
          const d = Math.hypot(e.x - x, e.z - z);
          if (d <= maxDist && (!best || d < best.d)) best = { poly: e.poly, arc: e.arc, d };
        }
      }
    return best;
  }
}

export function buildRevealSchedule(
  highways: RevealPolyInput[],
  arterials: RevealPolyInput[],
  streets: RevealPolyInput[],
  centre: RevealVec2,
): RevealSchedule {
  const tiers: PolySched[][] = [[], [], []];
  const inputs: RevealPolyInput[][] = [highways, arterials, streets];

  // Un-normalized reveal time at (tier, poly, arc).
  const rawAt = (tier: RevealTier, p: number, arc: number): number => {
    const s = tiers[tier][p];
    return s.start + arcDist(arc, s.attachArc, s.len, s.closed) / s.speed;
  };

  // --- Tier 0: highways grow from their point nearest the centre. -----------
  for (let p = 0; p < highways.length; p++) {
    const poly = highways[p];
    const closed = poly.closed ?? false;
    const cum = cumLengths(poly.vertices, closed);
    const len = cum[cum.length - 1];
    let attachArc = 0;
    let bestD = Infinity;
    for (let i = 0; i < poly.vertices.length; i++) {
      const v = poly.vertices[i];
      const d = Math.hypot(v.x - centre.x, v.z - centre.z);
      if (d < bestD) {
        bestD = d;
        attachArc = cum[i];
      }
    }
    tiers[0].push({
      start: bestD / RADIAL_SPEED, // farther-from-centre highways start later
      attachArc,
      speed: SPEED[0],
      len,
      closed,
      cum,
      parentTime: null,
    });
  }

  // --- Tiers 1, 2: attach to the previous tier by proximity. ----------------
  for (const tier of [1, 2] as RevealTier[]) {
    const parentTier = (tier - 1) as RevealTier;
    const hash = new PointHash(100);
    inputs[parentTier].forEach((poly, pi) => {
      const cum = tiers[parentTier][pi].cum;
      poly.vertices.forEach((v, i) => hash.add(v.x, v.z, pi, cum[i]));
    });

    for (let p = 0; p < inputs[tier].length; p++) {
      const poly = inputs[tier][p];
      const closed = poly.closed ?? false;
      const cum = cumLengths(poly.vertices, closed);
      const len = cum[cum.length - 1];

      // Find this poly's vertex closest to ANY parent point.
      let attach: { arc: number; parentPoly: number; parentArc: number; d: number } | null = null;
      for (let i = 0; i < poly.vertices.length; i++) {
        const v = poly.vertices[i];
        const hit = hash.nearest(v.x, v.z, ATTACH_EPS);
        if (hit && (!attach || hit.d < attach.d))
          attach = { arc: cum[i], parentPoly: hit.poly, parentArc: hit.arc, d: hit.d };
      }

      if (attach) {
        const parentTime = rawAt(parentTier, attach.parentPoly, attach.parentArc);
        tiers[tier].push({
          start: parentTime + LAG,
          attachArc: attach.arc,
          speed: SPEED[tier],
          len,
          closed,
          cum,
          parentTime,
        });
      } else {
        // Radial orphan: join the wave at its nearest-to-centre vertex.
        let bestD = Infinity;
        let attachArc = 0;
        for (let i = 0; i < poly.vertices.length; i++) {
          const v = poly.vertices[i];
          const d = Math.hypot(v.x - centre.x, v.z - centre.z);
          if (d < bestD) {
            bestD = d;
            attachArc = cum[i];
          }
        }
        tiers[tier].push({
          start: bestD / RADIAL_SPEED + LAG,
          attachArc,
          speed: SPEED[tier],
          len,
          closed,
          cum,
          parentTime: null,
        });
      }
    }
  }

  // --- Normalize so the slowest endpoint lands at exactly 1. ----------------
  let maxT = 0;
  for (const tier of [0, 1, 2] as RevealTier[])
    for (let p = 0; p < tiers[tier].length; p++) {
      const s = tiers[tier][p];
      maxT = Math.max(maxT, rawAt(tier, p, 0), rawAt(tier, p, s.len));
    }
  const inv = maxT > 0 ? 1 / maxT : 1;

  return {
    revealAt: (tier, p, arc) => rawAt(tier, p, arc) * inv,
    polyInfo: (tier, p) => tiers[tier][p],
  };
}
```

Note: `polyInfo(...).parentTime` is un-normalized (raw seconds) while `revealAt` is normalized — the sanity check compares `revealAt(attachArc)` against `parentTime` so multiply `parentTime` by the same factor. Simplest fix: in step 1.1's check 4, compare raw values instead — change `polyInfo` to also expose `startNorm`: skip — instead make check 4 compare `sched.revealAt(tier, p, info.attachArc) >= sched.revealAtParentJunction(tier, p)`. To keep the API minimal, normalize `parentTime` inside `polyInfo` before returning (multiply by `inv` in the returned object: `parentTime: s.parentTime === null ? null : s.parentTime * inv`). Implement it that way.

- [ ] **Step 1.4: Run sanity — verify PASS**

Run: `bun run scripts/revealSanity.ts`
Expected: 5 PASS lines + `REVEAL SANITY PASS`, exit 0.

- [ ] **Step 1.5: Determinism gate**

Run: `bun run scripts/cityGolden.ts`
Expected: unchanged (schedule never touches gen).

- [ ] **Step 1.6: Commit** (with user signal)

```bash
git add lib/scene/roadReveal.ts scripts/revealSanity.ts
git commit -m "feat(reveal): pure cascade schedule from road geometry"
```

---

### Task 2: `aReveal` vertex attribute in the ribbon builder

**Files:**
- Modify: `lib/seed/roadMesh.ts` (whole file is ~100 lines; quad/disc emitters at lines 23–54, poly loop at 56–93)
- Modify: `scripts/revealSanity.ts` (append a geometry check)

- [ ] **Step 2.1: Extend `buildRoadGeometry`**

Add an optional `revealOf(polyIndex, arcDist) → number` parameter. Track cumulative arc through the segment loop; every emitted vertex pushes its reveal value. Replace the file's builder with:

```ts
export function buildRoadGeometry(
  polys: RoadPoly[],
  revealOf?: (polyIndex: number, arcDist: number) => number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const reveals: number[] = [];

  // pushQuad emits two triangles; rA/rB are the reveal values at the segment's
  // two ends (every vertex on an end shares its end's arc).
  const quad = (
    ax: number, az: number, bx: number, bz: number,
    cx: number, cz: number, dx: number, dz: number,
    rA: number, rB: number,
  ) => {
    positions.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
    positions.push(ax, 0, az, cx, 0, cz, dx, 0, dz);
    reveals.push(rA, rA, rB, rA, rB, rB);
  };

  const disc = (vx: number, vz: number, r: number, rv: number) => {
    for (let k = 0; k < JOIN_SEGS; k++) {
      const a0 = (k / JOIN_SEGS) * Math.PI * 2;
      const a1 = ((k + 1) / JOIN_SEGS) * Math.PI * 2;
      positions.push(
        vx, 0, vz,
        vx + Math.cos(a0) * r, 0, vz + Math.sin(a0) * r,
        vx + Math.cos(a1) * r, 0, vz + Math.sin(a1) * r,
      );
      reveals.push(rv, rv, rv);
    }
  };

  for (let pi = 0; pi < polys.length; pi++) {
    const p = polys[pi];
    const v = p.vertices;
    if (v.length < 2) continue;
    const half = p.width / 2;
    const segCount = p.closed ? v.length : v.length - 1;

    // Cumulative arc per vertex (matches roadReveal.ts's cumLengths walk).
    const cum = [0];
    for (let i = 1; i <= segCount; i++) {
      const a = v[(i - 1) % v.length];
      const b = v[i % v.length];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const rv = (arc: number) => (revealOf ? revealOf(pi, arc) : 0);

    for (let i = 0; i < segCount; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      const dxs = b.x - a.x;
      const dzs = b.z - a.z;
      const len = Math.hypot(dxs, dzs) || 1;
      const nx = (-dzs / len) * half;
      const nz = (dxs / len) * half;
      quad(
        a.x + nx, a.z + nz, a.x - nx, a.z - nz,
        b.x - nx, b.z - nz, b.x + nx, b.z + nz,
        rv(cum[i]), rv(cum[i + 1]),
      );
    }

    for (let i = 0; i < v.length; i++) {
      const interior = i > 0 && i < v.length - 1;
      const isEndCap = !p.closed && (i === 0 || i === v.length - 1);
      if (interior || p.closed) {
        const prev = v[(i - 1 + v.length) % v.length];
        const next = v[(i + 1) % v.length];
        const a1 = Math.atan2(v[i].z - prev.z, v[i].x - prev.x);
        const a2 = Math.atan2(next.z - v[i].z, next.x - v[i].x);
        let d = Math.abs(a2 - a1) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < JOIN_ANGLE) continue;
      } else if (!isEndCap) {
        continue;
      }
      disc(v[i].x, v[i].z, half, rv(cum[Math.min(i, cum.length - 1)]));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("aReveal", new THREE.BufferAttribute(new Float32Array(reveals), 1));
  geo.computeVertexNormals();
  return geo;
}
```

Keep the existing module docblock, `RoadPoly`, `JOIN_SEGS`, `JOIN_ANGLE` untouched.

- [ ] **Step 2.2: Append a geometry check to `scripts/revealSanity.ts`**

```ts
// 5. geometry — aReveal exists, one value per vertex, all within [0,1] when
//    fed by the schedule; all zero without revealOf (back-compat).
import { buildRoadGeometry } from "@/lib/seed/roadMesh";
{
  const stPolys = city.streets.map((s) => ({ vertices: s.vertices, width: s.width }));
  const geoPlain = buildRoadGeometry(stPolys);
  const plainReveal = geoPlain.getAttribute("aReveal");
  const allZero = (plainReveal.array as Float32Array).every((x) => x === 0);
  check(
    "geometry back-compat",
    plainReveal.count === geoPlain.getAttribute("position").count && allZero,
  );
  const geo = buildRoadGeometry(stPolys, (p, arc) => sched.revealAt(2, p, arc));
  const arr = geo.getAttribute("aReveal").array as Float32Array;
  let out = 0;
  for (const x of arr) if (x < 0 || x > 1 + 1e-9) out++;
  check("geometry reveal range", out === 0, `${out} out of range`);
}
```

- [ ] **Step 2.3: Run** `bun run scripts/revealSanity.ts` — Expected: 7 PASS, exit 0.
- [ ] **Step 2.4: Back-compat sweep** — `bun run scripts/gate1.ts` and `bun run scripts/cityGolden.ts` (roadMesh consumers must be unaffected; attribute is additive). Expected: PASS, golden unchanged.
- [ ] **Step 2.5: Commit** (with user signal)

```bash
git add lib/seed/roadMesh.ts scripts/revealSanity.ts
git commit -m "feat(reveal): per-vertex aReveal attribute on road ribbons"
```

---

### Task 3: Reveal shaders + compile check

**Files:**
- Create: `lib/shaders/roadReveal.ts`
- Modify: `lib/shaders/sharedIntro.ts` (append singleton)
- Modify: `scripts/shaderCheck.ts:9-38` (register cases)

- [ ] **Step 3.1: Shader module**

```ts
// Road reveal cascade (docs/specs/2026-06-05-road-reveal-cascade.md): fragments
// past the wavefront are discarded; a short band behind the front lightens
// toward white as the "construction tip". Roads render toneMapped:false flat
// colour, so the tip is a colour lerp, not an HDR boost. The tip retires as
// progress reaches 1 so a finished network is exactly the flat tier colour.
export const roadRevealVertexShader = `
attribute float aReveal;
varying float vReveal;
void main() {
  vReveal = aReveal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const roadRevealFragmentShader = `
uniform vec3 uColor;
uniform float uProgress;
uniform float uTipWidth;
varying float vReveal;
void main() {
  if (vReveal > uProgress) discard;
  float tip = 1.0 - smoothstep(0.0, uTipWidth, uProgress - vReveal);
  tip *= 1.0 - smoothstep(0.95, 1.0, uProgress);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), tip * 0.85), 1.0);
}
`;
```

- [ ] **Step 3.2: Singleton** — append to `lib/shaders/sharedIntro.ts`:

```ts
// Road reveal cascade (spec 2026-06-05): 0 → drawing, 1 → settled. Driven by
// RoadRevealTicker; consumed by the three Roads tier materials + GenTrace's
// fade. Starts at 1 so anything rendered before the ticker mounts is visible.
export const sharedRoadRevealProgress: { value: number } = { value: 1 };
```

- [ ] **Step 3.3: Register in shaderCheck** — add to imports and `CASES` in `scripts/shaderCheck.ts`:

```ts
import { roadRevealVertexShader, roadRevealFragmentShader } from "@/lib/shaders/roadReveal";
// in CASES:
  ["roadReveal.vertex", VERTEX_PRELUDE, roadRevealVertexShader],
  ["roadReveal.fragment", FRAGMENT_PRELUDE, roadRevealFragmentShader],
```

- [ ] **Step 3.4: Run** `bun run scripts/shaderCheck.ts` — Expected: `roadReveal.vertex PARSE OK`, `roadReveal.fragment PARSE OK`, exit 0.
- [ ] **Step 3.5: Commit** (with user signal)

```bash
git add lib/shaders/roadReveal.ts lib/shaders/sharedIntro.ts scripts/shaderCheck.ts
git commit -m "feat(reveal): cascade clip shader + shared progress singleton"
```

---

### Task 4: Roads material swap + reveal ticker

**Files:**
- Modify: `components/scene/Roads.tsx` (useMemo at 34–63, `RoadTier` at 108–140)
- Create: `components/scene/RoadRevealTicker.tsx`
- Modify: `components/scene/Scene.tsx:58-62` (mount ticker), `Scene.tsx:95-112` (pass cityReady)

- [ ] **Step 4.1: Build schedule + reveal geometries in Roads**

In `Roads.tsx`'s `useMemo` (line 34), after `const city = generateCity(...)`:

```ts
import { buildRevealSchedule } from "@/lib/scene/roadReveal";
// inside useMemo, after the three *Polys arrays are built:
const schedule = buildRevealSchedule(
  hwPolys.map((p) => ({ vertices: p.vertices, closed: p.closed })),
  artPolys.map((p) => ({ vertices: p.vertices })),
  stPolys.map((p) => ({ vertices: p.vertices })),
  { x: 0, z: 0 },
);
return {
  geometries: {
    highways: buildRoadGeometry(hwPolys, (p, arc) => schedule.revealAt(0, p, arc)),
    arterials: buildRoadGeometry(artPolys, (p, arc) => schedule.revealAt(1, p, arc)),
    streets: buildRoadGeometry(stPolys, (p, arc) => schedule.revealAt(2, p, arc)),
  },
  // ...kind/counts unchanged
};
```

(City centre is `(0, 0)` in gen space — `DEFAULT_ORBIT.centerZ = -120` is a camera framing offset, not the gen centre. Verify against `CITY_CENTER` in `lib/seed/topology.ts` at implementation time and use that constant if exported.)

- [ ] **Step 4.2: Swap `RoadTier` material**

```tsx
import { useMemo, useEffect } from "react";
import { sharedRoadRevealProgress } from "@/lib/shaders/sharedIntro";
import { roadRevealVertexShader, roadRevealFragmentShader } from "@/lib/shaders/roadReveal";

function RoadTier({ geometry, color, order, wireframe }: { /* unchanged props */ }) {
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader: roadRevealVertexShader,
      fragmentShader: roadRevealFragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uProgress: sharedRoadRevealProgress, // shared singleton by reference
        uTipWidth: { value: 0.04 },
      },
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  material.uniforms.uColor.value.set(color);
  material.wireframe = wireframe;
  return <mesh geometry={geometry} material={material} position={[0, ROAD_Y, 0]} renderOrder={order} />;
}
```

Caveat: `ShaderMaterial` ignores `fog`/`toneMapped` differently than meshBasicMaterial — both were already disabled, so behavior matches. `uProgress: sharedRoadRevealProgress` must be the OBJECT reference (sharedTime pattern, see `InstancedCity.tsx:316` for precedent — do not clone through UniformsUtils).

- [ ] **Step 4.3: Ticker**

```tsx
"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { sharedRoadRevealProgress } from "@/lib/shaders/sharedIntro";
import { sketchKey } from "@/lib/seed/citySketch";
import type { CityTier } from "@/lib/seed/topology";

// Advances the road-reveal cascade: 0 at the moment a NEW city's data is ready,
// → 1 over the (tier-scaled) duration. Holds at 1 for a known city. Honors
// `paused` (same contract as TimeTicker). durationSec 0 or reduced-motion →
// snaps to 1 (today's behavior).
const TIER_DURATION_MUL: Record<CityTier, number> = { town: 0.7, city: 1, metro: 1.4 };

const reducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function RoadRevealTicker({ cityReady }: { cityReady: boolean }) {
  const masterSeed = useSceneStore((s) => s.masterSeed);
  const cityShape = useSceneStore((s) => s.cityShape);
  const cityShapeScale = useSceneStore((s) => s.cityShapeScale);
  const citySize = useSceneStore((s) => s.citySize);
  const fieldDeviation = useSceneStore((s) => s.fieldDeviation);
  const key = `${masterSeed}::${cityShape}::${cityShapeScale}::${citySize}::${sketchKey()}::${fieldDeviation}`;

  const lastKey = useRef<string | null>(null);
  const elapsed = useRef(0);
  if (lastKey.current !== key) {
    lastKey.current = key;
    elapsed.current = 0; // new city → cascade restarts when its data lands
  }

  useFrame((_, dt) => {
    const s = useSceneStore.getState();
    const dur = s.roadReveal.durationSec * TIER_DURATION_MUL[s.citySize];
    if (dur <= 0 || reducedMotion) {
      sharedRoadRevealProgress.value = 1;
      return;
    }
    if (!cityReady) {
      sharedRoadRevealProgress.value = 0; // waiting on the worker — hold at start
      return;
    }
    if (!s.paused) elapsed.current += dt;
    sharedRoadRevealProgress.value = Math.min(1, elapsed.current / dur);
  });

  return null;
}
```

(References `s.roadReveal` — added in Task 5. Tasks 4+5 typecheck together; commit after both.)

- [ ] **Step 4.4: Mount in Scene** — `Scene.tsx`: add `<RoadRevealTicker cityReady={cityReady} />` next to `<IntroTicker />` (line 62).
- [ ] **Step 4.5: continue to Task 5 before verifying** (store field needed to compile).

---

### Task 5: Store field + Roads-panel slider

**Files:**
- Modify: `lib/state/sceneStore.ts` (TUNABLE_FIELDS ~line 414, SavedConfig ~line 452, state type + setter — mirror the `lod`/`setLod` pattern)
- Modify: `components/ui/RoadsPanel.tsx:35-68` (`RoadsSection`)

- [ ] **Step 5.1: Store**

```ts
// near the other DEFAULT_* consts:
export const DEFAULT_ROAD_REVEAL = { durationSec: 4 };
// in SceneState type (next to lod):
roadReveal: { durationSec: number };
setRoadReveal: (p: Partial<{ durationSec: number }>) => void;
// in TUNABLE_FIELDS (after the lod entry):
{ key: "roadReveal", defaultValue: DEFAULT_ROAD_REVEAL, persist: true },
// in SavedConfig type:
roadReveal?: { durationSec: number };
// in the store creator (next to setLod):
setRoadReveal: (p) => set((s) => ({ roadReveal: { ...s.roadReveal, ...p } })),
```

Follow whatever Save/Copy/Revert plumbing the `lod` field has — TUNABLE_FIELDS drives most of it; search for `lod` through the file and mirror each site.

- [ ] **Step 5.2: Slider** — in `RoadsSection` after the Streets `ToggleRow` (line 59), before the `<hr/>`:

```tsx
const revealDuration = useSceneStore((s) => s.roadReveal.durationSec);
const setRoadReveal = useSceneStore((s) => s.setRoadReveal);
// in JSX:
<ValueSlider
  label="reveal s"
  value={revealDuration}
  min={0}
  max={10}
  step={0.5}
  onChange={(v) => setRoadReveal({ durationSec: v })}
/>
```

(`ValueSlider` is local to RoadsPanel.tsx:157 — already in scope. 0 = off → instant roads.)

- [ ] **Step 5.3: Verify** — `bun run lint`, `bunx tsc --noEmit`, `bun run scripts/revealSanity.ts`, then `bun dev`: default seed loads → cascade draws over ~4s, gold tips, slider changes pace live on next city, 0 snaps.
- [ ] **Step 5.4: Commit** (with user signal)

```bash
git add components/scene/Roads.tsx components/scene/RoadRevealTicker.tsx components/scene/Scene.tsx lib/state/sceneStore.ts components/ui/RoadsPanel.tsx
git commit -m "feat(reveal): cascade material, ticker, duration slider"
```

---

### Task 6: Choreography — roads lead, buildings follow

**Files:**
- Modify: `components/scene/IntroTicker.tsx:44-48` (auto-fire effect) and `:50` (useFrame)

- [ ] **Step 6.1: Gate the auto-fire**

Replace the mount effect + add a pending check in useFrame:

```tsx
import { sharedRoadRevealProgress } from "@/lib/shaders/sharedIntro";

const REVEAL_GATE = 0.35; // intro holds until the road wave is this far out

export function IntroTicker() {
  const pendingIntro = useRef(false);
  const armed = useRef(false);
  // ...lastPlaying/lastProgress unchanged

  useEffect(() => {
    if (armed.current) return;
    armed.current = true;
    pendingIntro.current = true; // fire via useFrame once the road wave leads
  }, []);

  useFrame((_, dt) => {
    if (pendingIntro.current && sharedRoadRevealProgress.value >= REVEAL_GATE) {
      pendingIntro.current = false;
      useSceneStore.getState().playAllIntros();
    }
    // ...rest of the existing useFrame body unchanged
  });
}
```

Notes: manual replays (panel button → `playAllIntros`) stay ungated — mid-session the cascade sits at 1 ≥ 0.35 anyway. Streetlights inherit the gate for free (`sharedStreetlightIntroProgress` derives from the intro timeline, IntroTicker:81-85). If `roadReveal.durationSec` is 0 or reduced-motion, progress is pinned at 1 → intro fires on the first frame exactly as today.

- [ ] **Step 6.2: Verify** — `bun dev`, hard reload: roads start drawing first; building windows begin waking once the wave is ~1/3 out; streetlights follow the buildings as before. Set slider 0 + reload: behavior identical to pre-feature.
- [ ] **Step 6.3: Commit** (with user signal)

```bash
git add components/scene/IntroTicker.tsx
git commit -m "feat(reveal): gate intro wake until road wave leads"
```

---

### Task 7: GenTrace soften — draw-on, dim, fade beneath the cascade

**Files:**
- Create: `lib/shaders/genTrace.ts`
- Modify: `components/scene/GenTrace.tsx` (whole file, ~84 lines)
- Modify: `components/scene/Scene.tsx:95-112` (GenTrace mounts unconditionally)
- Modify: `scripts/shaderCheck.ts` (register the new pair)

- [ ] **Step 7.1: Trace shader**

```ts
// GenTrace draw-on + cascade fade. Each segment vertex carries its line's
// batch-arrival time (aBirth, sharedTime seconds) and its fraction along the
// line (aFrac); fragments past the drawn fraction discard, so every accepted
// streamline strokes on over uDrawDur instead of popping. uFade (1 − cascade
// progress) dims the whole blueprint as the real network sweeps over it.
export const genTraceVertexShader = `
attribute vec3 aColor;
attribute float aBirth;
attribute float aFrac;
varying vec3 vColor;
varying float vBirth;
varying float vFrac;
void main() {
  vColor = aColor;
  vBirth = aBirth;
  vFrac = aFrac;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const genTraceFragmentShader = `
uniform float uTime;
uniform float uDrawDur;
uniform float uOpacity;
uniform float uFade;
varying vec3 vColor;
varying float vBirth;
varying float vFrac;
void main() {
  float drawn = clamp((uTime - vBirth) / uDrawDur, 0.0, 1.0);
  if (vFrac > drawn) discard;
  gl_FragColor = vec4(vColor, uOpacity * uFade);
}
`;
```

- [ ] **Step 7.2: Rework GenTrace**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useSceneStore } from "@/lib/state/sceneStore";
import { subscribeGenProgress } from "@/lib/workers/cityGenClient";
import { sharedTime } from "@/lib/shaders/sharedTime";
import { sharedRoadRevealProgress } from "@/lib/shaders/sharedIntro";
import { genTraceVertexShader, genTraceFragmentShader } from "@/lib/shaders/genTrace";

// #59 Phase B, softened (spec 2026-06-05-road-reveal-cascade): accepted
// streamlines stroke on (draw-on via aBirth/aFrac) in a dim blueprint palette,
// then the whole overlay fades beneath the road cascade (uFade = 1 − progress)
// and disposes itself once invisible. Mounted unconditionally — renders null
// when there is nothing to show. Display-only; nothing deterministic reads it.
const TRACE_Y = 0.6;
const DRAW_DUR = 0.4; // s per accepted line
const ARTERIAL_RGB: [number, number, number] = [0.38, 0.48, 0.66]; // dimmed from #59
const MINOR_RGB: [number, number, number] = [0.12, 0.18, 0.32];

export function GenTrace({ masterSeed }: { masterSeed: string }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const positionsRef = useRef<number[]>([]);
  const colorsRef = useRef<number[]>([]);
  const birthsRef = useRef<number[]>([]);
  const fracsRef = useRef<number[]>([]);

  const materialRef = useRef<THREE.ShaderMaterial>(
    null,
  ) as React.MutableRefObject<THREE.ShaderMaterial | null>;
  if (!materialRef.current) {
    materialRef.current = new THREE.ShaderMaterial({
      vertexShader: genTraceVertexShader,
      fragmentShader: genTraceFragmentShader,
      uniforms: {
        uTime: sharedTime, // singleton by reference
        uDrawDur: { value: DRAW_DUR },
        uOpacity: { value: 0.55 },
        uFade: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
  }

  useEffect(() => {
    positionsRef.current = [];
    colorsRef.current = [];
    birthsRef.current = [];
    fracsRef.current = [];
    const unsubscribe = subscribeGenProgress((e) => {
      const s = useSceneStore.getState();
      if (
        e.seed !== masterSeed ||
        e.tier !== s.citySize ||
        e.shape !== s.cityShape ||
        e.scale !== s.cityShapeScale
      )
        return;
      const pos = positionsRef.current;
      const col = colorsRef.current;
      const birth = birthsRef.current;
      const frac = fracsRef.current;
      const now = sharedTime.value;
      for (const line of e.lines) {
        const rgb = line.tier === "arterial" ? ARTERIAL_RGB : MINOR_RGB;
        const p = line.pts; // [x0, z0, x1, z1, ...]
        // Cumulative length → per-vertex fraction so the line strokes on.
        let total = 0;
        const segLen: number[] = [];
        for (let i = 0; i + 3 < p.length; i += 2) {
          const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
          segLen.push(L);
          total += L;
        }
        let acc = 0;
        for (let k = 0, i = 0; i + 3 < p.length; i += 2, k++) {
          const f0 = total > 0 ? acc / total : 0;
          acc += segLen[k];
          const f1 = total > 0 ? acc / total : 1;
          pos.push(p[i], TRACE_Y, p[i + 1], p[i + 2], TRACE_Y, p[i + 3]);
          col.push(...rgb, ...rgb);
          birth.push(now, now);
          frac.push(f0, f1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos.slice(), 3));
      geo.setAttribute("aColor", new THREE.Float32BufferAttribute(col.slice(), 3));
      geo.setAttribute("aBirth", new THREE.Float32BufferAttribute(birth.slice(), 1));
      geo.setAttribute("aFrac", new THREE.Float32BufferAttribute(frac.slice(), 1));
      setGeometry((old) => {
        old?.dispose();
        return geo;
      });
    });
    return () => {
      unsubscribe();
      positionsRef.current = [];
      colorsRef.current = [];
      birthsRef.current = [];
      fracsRef.current = [];
      setGeometry((old) => {
        old?.dispose();
        return null;
      });
    };
  }, [masterSeed]);

  // Fade beneath the cascade; release the geometry once fully invisible.
  useFrame(() => {
    const m = materialRef.current;
    if (!m) return;
    const fade = 1 - sharedRoadRevealProgress.value;
    m.uniforms.uFade.value = fade;
    if (fade <= 0 && geometry) {
      setGeometry((old) => {
        old?.dispose();
        return null;
      });
    }
  });

  useEffect(() => () => materialRef.current?.dispose(), []);

  if (!geometry) return null;
  return <lineSegments geometry={geometry} material={materialRef.current} frustumCulled={false} />;
}
```

- [ ] **Step 7.3: Scene mount** — `Scene.tsx`: move `<GenTrace masterSeed={masterSeed} />` OUT of the ternary's else-branch so it renders unconditionally (place it right after the `{cityReady ? ... : null}` block; delete the else-branch). The trace must outlive `cityReady` to fade beneath the cascade — the old conditional unmount was the "blink".

- [ ] **Step 7.4: Register shaders** — add `genTrace.vertex` / `genTrace.fragment` cases to `scripts/shaderCheck.ts` (same pattern as Step 3.3).

- [ ] **Step 7.5: Verify** — `bun run scripts/shaderCheck.ts` (exit 0); `bun dev`, switch tier City→Metro (cold gen): trace lines stroke on dim during the wait, cascade sweeps over, trace fades, no blink at the swap.
- [ ] **Step 7.6: Commit** (with user signal)

```bash
git add lib/shaders/genTrace.ts components/scene/GenTrace.tsx components/scene/Scene.tsx scripts/shaderCheck.ts
git commit -m "feat(reveal): GenTrace draw-on + fade beneath the cascade"
```

---

### Task 8: Full verification sweep

- [ ] **Step 8.1: Headless gates**

```bash
bun run lint
bunx tsc --noEmit
bun run build
bun run scripts/revealSanity.ts
bun run scripts/shaderCheck.ts
bun run scripts/gate1.ts
bun run scripts/cityGolden.ts
```

Expected: all PASS / build clean / golden byte-identical.

- [ ] **Step 8.2: Visual gate (HITL — Playwright is broken on this box)**

`bun dev`, then check each:
1. Default seed, hard reload — cascade ~4s, highways lead from centre, tips lighten, buildings wake after ~1/3.
2. New seed — cascade replays (warm path, no trace).
3. Tier → Metro — trace draws on during the ~7s gen, cascade sweeps over, no blink, duration ~5.6s (×1.4).
4. Slider → 0 — instant roads, intro fires immediately (pre-feature behavior).
5. Roads debug wireframe + tier highlight toggles — colors/wireframe still correct mid- and post-cascade.
6. Pause mid-cascade — wave freezes; unpause resumes.
7. Mobile (LAN) — quick smoke, cascade plays.

- [ ] **Step 8.3:** Update `wiki/daily/<date>.md` with the result; close the loop on the spec's verification section.

---

## Self-review (done at plan time)

- **Spec coverage**: schedule §1 → Task 1; geometry §2 → Task 2; render §3 → Tasks 3–4; GenTrace §4 → Task 7; choreography §5 → Task 6; control §6 → Task 5; reduced-motion (deferred item) → Task 4.3 ticker; edge cases — rings (Task 1 arcDist), key reset (Task 4.3), wireframe (Task 4.2 + 8.2), /plan-and-scripts back-compat (Task 2 default-zero + revealSanity check 5).
- **Known judgment call**: gen-space centre assumed `(0,0)` — Step 4.1 carries an explicit verify-against-`CITY_CENTER` instruction.
- **Type consistency**: `revealAt(tier, p, arc)` and `polyInfo(tier, p)` used identically in Tasks 1, 2, 4; `sharedRoadRevealProgress` referenced in Tasks 3, 4, 6, 7.
