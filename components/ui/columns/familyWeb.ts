// familyWeb.ts — data model for the family tree's descendant-breadth chart
// (user 2026-07-10, replacing the v3 hourglass window): ROOTS are the topmost
// unions reached by climbing ≤2 blood generations from the focus (and from
// their partner, if any); every root then renders with its FULL in-window
// descent — children, glued spouses, grandchildren, down to the data's
// depth — so aunts/uncles/cousins are visible as the other branches. Every
// person renders exactly once; a union whose two members descend from two
// different roots JOINS the two descent trees (e.g. focus + spouse).
//
// Everything here is a pure function of (indexes, focus) and derives from
// the DATA (ages, persona ids, family links) — never from selection state —
// so any two focuses that resolve the same root set produce identical
// output; FamilyTree.tsx renders it and adds the measured positioning.

import type { Persona } from "@/lib/seed/personas";
import type { EntityIndexes } from "./entityData";

// Deterministic couple ordering: OLDER on the left, younger on the right —
// ties (equal age) break by persona id. Depends only on the two people's own
// data, so it returns the SAME pair order whichever member is the focus
// (user 2026-07-10).
export function orderByAge(x: Persona, y: Persona): [Persona, Persona] {
  if (x.age !== y.age) return x.age > y.age ? [x, y] : [y, x];
  return x.id <= y.id ? [x, y] : [y, x];
}

// Chart convention: siblings/children render oldest → youngest, left → right;
// ties break by persona id so ordering never depends on which person
// triggered the render (user 2026-07-10).
export function byAge(list: Persona[]): Persona[] {
  return [...list].sort((a, b) => (b.age !== a.age ? b.age - a.age : a.id <= b.id ? -1 : 1));
}

export type UnionNode = {
  key: string; // canonical: sorted member ids
  members: Persona[]; // 1-2, older first (age rule)
  gen: number; // focus-relative generation (roots smallest)
  // All blood children of this union in the window, age-ordered — drives
  // row layout and the union's centering target.
  childIds: string[];
  // Children partitioned for connectors: shared children hang from the
  // union line's midpoint; a single member's prior-relationship children
  // hang from that member's own box (remarriage split, user 2026-07-08 —
  // preserved from the hourglass chart).
  sharedChildIds: string[];
  soloChildIds: Array<{ memberId: string; kids: string[] }>;
  // Union line style, genogram semantics (genopro.com/genogram/
  // family-relationships): married = solid, dating (or non-partnered
  // co-parents) = dashed. Replaces the old dotted married-in distinction —
  // blood vs married-in already reads from box borders + stripes.
  dashed: boolean;
  // Lexicographic sort path: [rootIndex, childIndex, childIndex, …]. Row
  // order = path order, so each root's subtree stays contiguous and the
  // whole layout is focus-independent.
  path: number[];
  // Effective lineage color for this union's CONNECTOR set (partner line,
  // drop, bus, stubs) when Lineage Colors is on: the members' shared line
  // hue, or a solid circular-midpoint blend where the union merges two
  // lines — SVG lines can't gradient along arbitrary paths, so the box
  // stripes carry the full gradient story and connectors take the blend
  // (user 2026-07-10: "the lines connecting people would be colorized …
  // maybe we could have both"). Undefined (no colored member) falls back to
  // the muted connector color.
  lineColor?: string;
};

export type FamilyWeb = {
  rows: UnionNode[][]; // top generation first; each row path-ordered
  // person id → CSS background for the 2px lineage bar: a solid root hue,
  // or a left→right gradient where two lines merged ("red + green =
  // yellow", done perceptually in OKLCH — user 2026-07-10). Married-ins
  // with no in-window parents have no entry.
  stripes: Map<string, string>;
  // person id → effective lineage HUE (the number behind the stripe; a
  // blend midpoint where two lines merged). The fan chart colors its
  // wedges from this so both views tell the same lineage story.
  hues: Map<string, number>;
  bloodIds: Set<string>; // blood-of-focus (solid borders)
  trimmed: number; // persons cut by the box cap ("+N more in this line…")
};

// Soft cap on total rendered people: cross-building family weaves can chain
// wide, so the deepest generation trims first (never the focus's own
// ancestors/descendants/siblings), youngest lines first (user 2026-07-10).
const BOX_CAP = 60;

// Circular hue midpoint along the shorter arc.
function hueMid(a: number, b: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d / 2 + 360) % 360;
}

// Lineage color token (single source for stripes, connectors, fan wedges);
// optional alpha for translucent fills like the fan's wedge interiors.
export const hueCss = (h: number, alpha?: number) =>
  `oklch(0.72 0.14 ${Math.round(h * 10) / 10}${alpha !== undefined ? ` / ${alpha}` : ""})`;

// Gender Tint layer: oklch backgrounds by identity — GREEN men / ORANGE
// women / PURPLE other (user 2026-07-10, second strengthening pass: ~11%
// then ~24% both read too faint; now unmistakable at a glance while borders
// and lineage stripes still dominate). The gender icon remains the primary
// signal. Shared by the box view and the fan's wedge fills.
export function genderTintCss(identity: Persona["genderIdentity"]): string {
  const hue =
    identity === "cis man" || identity === "trans man"
      ? 150
      : identity === "cis woman" || identity === "trans woman"
        ? 55
        : 305;
  return `oklch(0.72 0.13 ${hue} / 0.35)`;
}

type Role = Persona["family"][number]["role"];

export function buildFamilyWeb(
  indexes: EntityIndexes,
  focus: Persona,
  opts?: {
    // View-aware trim (user 2026-07-11): a generation with more people than
    // this would overflow the chart region even at the scale floor and force
    // a scrollbar — trim it into the "+N more" note instead. The focus's
    // protected line is never trimmed, so a huge protected core can still
    // legitimately overflow (and scroll).
    maxPerGeneration?: number;
  },
): FamilyWeb {
  const get = (id: string) => indexes.directory.personas.get(id);
  const byRole = (p: Persona, role: Role) =>
    p.family
      .filter((l) => l.role === role)
      .map((l) => get(l.personaId))
      .filter(Boolean) as Persona[];
  const partnerOf = (p: Persona) => (p.partnerId ? get(p.partnerId) : undefined);

  const unions = new Map<string, UnionNode>();
  const memberUnionOf = new Map<string, string>(); // person id → their union key
  const parentUnionOf = new Map<string, string>(); // person id → parent union key
  const placed = new Set<string>(); // person ids in the window

  const makeUnion = (people: Persona[], gen: number): UnionNode => {
    const members = people.length === 2 ? [...orderByAge(people[0], people[1])] : [...people];
    const key = members
      .map((m) => m.id)
      .sort()
      .join("|");
    const existing = unions.get(key);
    if (existing) return existing;
    const [a, b] = members;
    const linked = !!b && a.partnerId === b.id;
    const node: UnionNode = {
      key,
      members,
      gen,
      childIds: [],
      sharedChildIds: [],
      soloChildIds: [],
      dashed:
        !!b &&
        (!linked || a.relationshipStatus === "dating" || b.relationshipStatus === "dating"),
      path: [],
    };
    unions.set(key, node);
    for (const m of members) {
      memberUnionOf.set(m.id, key);
      placed.add(m.id);
    }
    return node;
  };

  // ---- Roots: climb ≤2 blood generations from focus AND partner. --------
  const hasAbove = new Set<string>();
  const focusPartner = partnerOf(focus);
  const u0 = makeUnion(focusPartner ? [focus, focusPartner] : [focus], 0);
  const ancestorUnions: UnionNode[] = [u0];
  for (const person of u0.members) {
    const ps = byRole(person, "parent").slice(0, 2);
    if (ps.length === 0) continue;
    const pu = makeUnion(ps, -1);
    parentUnionOf.set(person.id, pu.key);
    hasAbove.add(u0.key);
    ancestorUnions.push(pu);
    for (const parent of pu.members) {
      const gps = byRole(parent, "parent").slice(0, 2);
      if (gps.length === 0) continue;
      const gu = makeUnion(gps, -2);
      parentUnionOf.set(parent.id, gu.key);
      hasAbove.add(pu.key);
      ancestorUnions.push(gu);
    }
  }
  const rootsAll = [...new Map(ancestorUnions.map((u) => [u.key, u])).values()].filter(
    (u) => !hasAbove.has(u.key),
  );
  // Root order (age rule on each root's eldest member) fixes the global
  // left-to-right lean of every subtree AND the lineage hue assignment.
  rootsAll.sort((a, b) => {
    const ea = a.members[0];
    const eb = b.members[0];
    if (ea.age !== eb.age) return eb.age - ea.age;
    return ea.id <= eb.id ? -1 : 1;
  });

  // ---- Descent: BFS from the roots, full depth. --------------------------
  const pushSolo = (u: UnionNode, memberId: string, kid: string) => {
    const entry = u.soloChildIds.find((s) => s.memberId === memberId);
    if (entry) entry.kids.push(kid);
    else u.soloChildIds.push({ memberId, kids: [kid] });
  };
  const processed = new Set<string>();
  const queue: UnionNode[] = [...rootsAll];
  while (queue.length > 0) {
    const u = queue.shift() as UnionNode;
    if (processed.has(u.key)) continue;
    processed.add(u.key);
    // Children = both members' child links, expanded once with each child's
    // sibling links — cross-building links (Pass 3.5 in personas.ts) can
    // attach a parent edge without the reciprocal child edge, and the
    // sibling hop catches those (carried over from the v3 chart).
    const seenKid = new Set<string>();
    const kids: Persona[] = [];
    const addKid = (c: Persona) => {
      if (seenKid.has(c.id) || u.members.some((m) => m.id === c.id)) return;
      seenKid.add(c.id);
      kids.push(c);
    };
    const direct = u.members.flatMap((m) => byRole(m, "child"));
    for (const c of direct) addKid(c);
    for (const c of direct) for (const s of byRole(c, "sibling")) addKid(s);
    const memberKidIds = u.members.map((m) => new Set(byRole(m, "child").map((c) => c.id)));
    for (const c of byAge(kids)) {
      // One parent union per person (first wins, in deterministic root/BFS
      // order) — every child hangs from exactly one bus.
      if (!parentUnionOf.has(c.id)) parentUnionOf.set(c.id, u.key);
      else if (parentUnionOf.get(c.id) !== u.key) continue;
      u.childIds.push(c.id);
      if (u.members.length === 2) {
        const ofA = memberKidIds[0].has(c.id);
        const ofB = memberKidIds[1].has(c.id);
        if (ofA && !ofB) pushSolo(u, u.members[0].id, c.id);
        else if (ofB && !ofA) pushSolo(u, u.members[1].id, c.id);
        else u.sharedChildIds.push(c.id);
      } else {
        u.sharedChildIds.push(c.id);
      }
      const existingKey = memberUnionOf.get(c.id);
      if (existingKey) {
        // Already a member somewhere (e.g. via their partner from another
        // root — the JOIN case): reuse that union, just make sure its own
        // descent gets processed.
        const w = unions.get(existingKey) as UnionNode;
        if (!processed.has(w.key)) queue.push(w);
      } else {
        const cp = partnerOf(c);
        queue.push(makeUnion(cp ? [c, cp] : [c], u.gen + 1));
      }
    }
  }

  // ---- Trim to the box cap. ----------------------------------------------
  // Protected: the focus's own blood line — ancestors (transitive),
  // descendants (transitive), siblings — never trimmed. The focus's partner
  // is safe implicitly: a union is only trimmable when EVERY member is
  // unprotected.
  const protectedIds = new Set<string>([focus.id]);
  {
    const up = [focus];
    while (up.length > 0) {
      const p = up.pop() as Persona;
      for (const q of byRole(p, "parent"))
        if (!protectedIds.has(q.id)) {
          protectedIds.add(q.id);
          up.push(q);
        }
    }
    const down = [focus];
    while (down.length > 0) {
      const p = down.pop() as Persona;
      for (const q of byRole(p, "child"))
        if (!protectedIds.has(q.id)) {
          protectedIds.add(q.id);
          down.push(q);
        }
    }
    for (const s of byRole(focus, "sibling")) protectedIds.add(s.id);
    for (const p of byRole(focus, "parent"))
      for (const c of byRole(p, "child")) protectedIds.add(c.id);
  }
  let trimmed = 0;
  // Deepest generation first; within it the youngest line (eldest-member
  // age ascending, key tie); only leaf unions (no on-screen children).
  const pickTrimmable = (gen?: number): UnionNode | undefined => {
    let pick: UnionNode | undefined;
    for (const u of unions.values()) {
      if (gen !== undefined && u.gen !== gen) continue;
      if (u.childIds.length > 0) continue;
      if (u.members.some((m) => protectedIds.has(m.id))) continue;
      if (
        !pick ||
        u.gen > pick.gen ||
        (u.gen === pick.gen &&
          (u.members[0].age < pick.members[0].age ||
            (u.members[0].age === pick.members[0].age && u.key < pick.key)))
      )
        pick = u;
    }
    return pick;
  };
  const removeUnion = (pick: UnionNode) => {
    unions.delete(pick.key);
    for (const m of pick.members) {
      placed.delete(m.id);
      memberUnionOf.delete(m.id);
      trimmed += 1;
      const parent = unions.get(parentUnionOf.get(m.id) ?? "");
      if (parent) {
        parent.childIds = parent.childIds.filter((id) => id !== m.id);
        parent.sharedChildIds = parent.sharedChildIds.filter((id) => id !== m.id);
        for (const s of parent.soloChildIds) s.kids = s.kids.filter((id) => id !== m.id);
        parent.soloChildIds = parent.soloChildIds.filter((s) => s.kids.length > 0);
      }
    }
  };
  while (placed.size > BOX_CAP) {
    const pick = pickTrimmable();
    if (!pick) break;
    removeUnion(pick);
  }
  // Per-generation height budget (see opts.maxPerGeneration).
  if (opts?.maxPerGeneration) {
    const unfixable = new Set<number>();
    for (;;) {
      const counts = new Map<number, number>();
      for (const u of unions.values()) {
        counts.set(u.gen, (counts.get(u.gen) ?? 0) + u.members.length);
      }
      let target: number | undefined;
      for (const [g, n] of counts) {
        if (n > opts.maxPerGeneration && !unfixable.has(g)) {
          if (target === undefined || g > target) target = g;
        }
      }
      if (target === undefined) break;
      const pick = pickTrimmable(target);
      if (!pick) {
        // Everything left in this generation is protected or load-bearing —
        // accept the overflow (the chart scrolls) rather than cut the
        // focus's own line.
        unfixable.add(target);
        continue;
      }
      removeUnion(pick);
    }
  }

  // ---- Sort paths (post-trim, so indices are stable per window). ---------
  const liveRoots = rootsAll.filter((u) => unions.has(u.key));
  liveRoots.forEach((u, i) => {
    u.path = [i];
  });
  const assign = (u: UnionNode) => {
    u.childIds.forEach((cid, j) => {
      const w = unions.get(memberUnionOf.get(cid) ?? "");
      if (!w || w.path.length > 0) return;
      // Primary parent for ordering = the parent union of the union's OLDER
      // member that has one (members are age-ordered) — a joined union sits
      // inside its older blood member's line.
      const primary = w.members
        .map((m) => parentUnionOf.get(m.id))
        .find((k) => k && unions.has(k));
      if (primary !== u.key) return;
      w.path = [...u.path, j];
      assign(w);
    });
  };
  liveRoots.forEach(assign);
  // Defensive fallback: anything left pathless (odd weaves) appends after
  // all assigned subtrees in stable key order.
  let orphan = 0;
  for (const u of [...unions.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (u.path.length === 0) u.path = [liveRoots.length + orphan++];
  }

  // ---- Rows: generation ascending, path order within each. ---------------
  const byGen = new Map<number, UnionNode[]>();
  for (const u of unions.values()) byGen.set(u.gen, [...(byGen.get(u.gen) ?? []), u]);
  const cmpPath = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const d = (a[i] ?? -1) - (b[i] ?? -1);
      if (d !== 0) return d;
    }
    return 0;
  };
  const rows = [...byGen.keys()]
    .sort((a, b) => a - b)
    .map((g) => (byGen.get(g) as UnionNode[]).sort((x, y) => cmpPath(x.path, y.path)));

  // ---- Lineage hues: evenly spaced OKLCH wheel over the live roots. ------
  const stripes = new Map<string, string>();
  const effHue = new Map<string, number>(); // person id → hue passed to kids
  const n = Math.max(liveRoots.length, 1);
  liveRoots.forEach((u, i) => {
    const hue = (i * 360) / n;
    for (const m of u.members) {
      effHue.set(m.id, hue);
      stripes.set(m.id, hueCss(hue));
    }
  });
  for (const row of rows) {
    for (const u of row) {
      for (const m of u.members) {
        if (effHue.has(m.id)) continue; // roots already colored
        const pu = unions.get(parentUnionOf.get(m.id) ?? "");
        if (!pu) continue; // married-in, no in-window parents: no stripe
        const [pl, pr] = pu.members;
        const hl = effHue.get(pl.id);
        const hr = pr ? effHue.get(pr.id) : undefined;
        if (hl === undefined && hr === undefined) continue;
        if (hl !== undefined && hr !== undefined && Math.abs(hl - hr) > 0.5) {
          // Two lines merged: left→right gradient matching the parents'
          // on-screen order; deeper generations inherit the blend via the
          // circular midpoint.
          effHue.set(m.id, hueMid(hl, hr));
          stripes.set(m.id, `linear-gradient(90deg, ${hueCss(hl)}, ${hueCss(hr)})`);
        } else {
          const h = (hl ?? hr) as number;
          effHue.set(m.id, h);
          stripes.set(m.id, hueCss(h));
        }
      }
      // Connector color for the whole union: both members share a hue →
      // that hue; two different lines meet → their circular midpoint; only
      // one member colored (married-in partner) → the blood member's hue.
      const hues = u.members
        .map((m) => effHue.get(m.id))
        .filter((h): h is number => h !== undefined);
      if (hues.length === 2 && Math.abs(hues[0] - hues[1]) > 0.5) {
        u.lineColor = hueCss(hueMid(hues[0], hues[1]));
      } else if (hues.length > 0) {
        u.lineColor = hueCss(hues[0]);
      }
    }
  }

  // ---- Blood of focus: BFS over blood links within the window. -----------
  const bloodIds = new Set<string>([focus.id]);
  const stack = [focus];
  while (stack.length > 0) {
    const p = stack.pop() as Persona;
    for (const role of ["parent", "child", "sibling"] as const) {
      for (const q of byRole(p, role)) {
        if (!placed.has(q.id) || bloodIds.has(q.id)) continue;
        bloodIds.add(q.id);
        stack.push(q);
      }
    }
  }

  return { rows, stripes, hues: effHue, bloodIds, trimmed };
}

// ---- Fan chart data (user 2026-07-10: "can help with larger families"). ---
// A bow-tie double fan is a BLOOD-LINEAGE device: top semicircle = parents
// (2 wedges) + grandparents (4), bottom = the focus's children, each
// subdivided by their own children. Partners/married-ins do not appear (the
// web views keep the full social picture; the dialog notes the partner
// under the fan). Pure function of (focus, family links) — a fan is
// inherently focus-centered, so re-rooting redraws around the new center.

export type FanSlot = { persona: Persona; hue?: number };

export type FamilyFanData = {
  focus: FanSlot;
  // Exactly 2: [older-left, younger-right] by the couple age rule; null =
  // missing ancestor (renders as a dimmed empty wedge, geometry stable).
  parents: Array<FanSlot | null>;
  // Exactly 4, two per parent wedge, each pair age-ordered (older left).
  grandparents: Array<FanSlot | null>;
  children: FanSlot[]; // age-ordered, oldest left
  grandchildren: FanSlot[][]; // grandchildren[i] = children[i]'s kids
  partnerName?: string;
};

export function buildFamilyFan(
  indexes: EntityIndexes,
  focus: Persona,
  web: FamilyWeb,
): FamilyFanData {
  const get = (id: string) => indexes.directory.personas.get(id);
  const byRole = (p: Persona, role: Role) =>
    p.family
      .filter((l) => l.role === role)
      .map((l) => get(l.personaId))
      .filter(Boolean) as Persona[];
  // Hues come from the SAME web build (stripes/effHue) so fan wedges and
  // box stripes never disagree about a person's lineage color.
  const slot = (p?: Persona): FanSlot | null =>
    p ? { persona: p, hue: web.hues.get(p.id) } : null;

  const parentsRaw = byRole(focus, "parent").slice(0, 2);
  const parents =
    parentsRaw.length === 2 ? [...orderByAge(parentsRaw[0], parentsRaw[1])] : parentsRaw;
  const grandparents: Array<FanSlot | null> = [];
  for (let i = 0; i < 2; i += 1) {
    const parent = parents[i];
    if (!parent) {
      grandparents.push(null, null);
      continue;
    }
    const gRaw = byRole(parent, "parent").slice(0, 2);
    const g = gRaw.length === 2 ? [...orderByAge(gRaw[0], gRaw[1])] : gRaw;
    grandparents.push(slot(g[0]), slot(g[1]));
  }
  const children = byAge(byRole(focus, "child")).map(
    (c): FanSlot => ({ persona: c, hue: web.hues.get(c.id) }),
  );
  const grandchildren = children.map((c) =>
    byAge(byRole(c.persona, "child")).map(
      (k): FanSlot => ({ persona: k, hue: web.hues.get(k.id) }),
    ),
  );
  const partner = focus.partnerId ? get(focus.partnerId) : undefined;
  return {
    focus: { persona: focus, hue: web.hues.get(focus.id) },
    parents: [slot(parents[0]), slot(parents[1])],
    grandparents,
    children,
    grandchildren,
    partnerName: partner ? `${partner.givenName} ${partner.familyName}` : undefined,
  };
}
