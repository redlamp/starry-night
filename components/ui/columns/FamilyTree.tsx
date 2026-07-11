"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Blend,
  Network,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  SquareArrowOutUpRight,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogPopup,
  DialogContent,
  DialogClose,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useSceneStore } from "@/lib/state/sceneStore";
import type { Persona } from "@/lib/seed/personas";
import type { EntityIndexes } from "./entityData";
import { IconTip, StandaloneEntityCard } from "./EntityColumns";
import { GenderIcon } from "./genderIcon";
import {
  buildFamilyFan,
  buildFamilyWeb,
  genderTintCss,
  hueCss,
  type FamilyWeb,
  type UnionNode,
} from "./familyWeb";
import { FanChart } from "./FamilyFan";

// Family tree explorer v4 (user 2026-07-10): a descendant-breadth chart —
// ROOTS are the topmost unions reached by climbing ≤2 blood generations from
// the focus (and their partner), and every root renders with its FULL
// in-window descent, so aunts/uncles/cousins are visible as the other
// branches; a union whose members descend from two roots joins the trees.
// The window/ordering/trim/lineage model lives in familyWeb.ts (pure data);
// this file renders it. Stability contract (kept from v3): every row's
// order derives from the DATA — oldest left → youngest right, persona-id
// tie-breaks, glued partners on the age-implied side — never from which
// person is focused, so re-rooting within the same window only moves the
// highlight. Union blocks are positioned by measurement: each centers over
// the mean x of its children, packed per row by least-squares (packRow) in
// data order; buses span only their own children's stubs and take stacked
// lanes when spans intersect. Lineage color coding: each root union gets an
// evenly spaced OKLCH hue; blood descendants carry a constant-height 2px
// stripe — solid for one line, a left→right gradient where two lines merged
// (user 2026-07-10: "red + green = yellow", done perceptually) — AND each
// union's connector set takes its effective lineage color (midpoint blend
// where lines merge; stripes carry the full gradient story). Union lines
// follow genogram semantics (genopro.com/genogram/family-relationships):
// married = solid, dating = dashed. THREE display modes (user 2026-07-10):
// Rows (the web chart), Columns (the same chart transposed — the measure
// pass runs in (pack, gen) axis coordinates so one algorithm serves both),
// and Fan (FamilyFan.tsx, a bow-tie blood-lineage fan for fast traversal).
// The mode cluster, display layers (Lineage Colors, Gender Tint), and the
// resident-card show/hide live in a fixed-height bottom controls row;
// layers are colors only, never layout. The right pane is the SAME persona
// card the inspector columns use (PersonaColumn), not a bespoke summary.

// Least-squares row packing (pool-adjacent-violators). Input: blocks in
// their final left-to-right order with desired left edges and a PER-PAIR
// minimum gap (gapBefore = required air between a block and its
// predecessor — couples and child-bearing unions demand more than leaf
// singles); output: left edges that preserve that order while staying
// collectively as close to the desired positions as possible — "keeping
// each as close to its target as the packing allows" (user 2026-07-10). In
// prefix-space (subtract the cumulative width+gap ahead of each block) the
// min-gap constraint becomes plain "non-decreasing", so the closest fit is
// isotonic regression: pool adjacent blocks while they violate, place each
// pool at its mean.
function packRow(items: Array<{ desired: number; width: number; gapBefore: number }>): number[] {
  const prefix: number[] = [];
  let acc = 0;
  items.forEach((it, i) => {
    if (i > 0) acc += it.gapBefore;
    prefix.push(acc);
    acc += it.width;
  });
  const pools: Array<{ sum: number; n: number }> = [];
  items.forEach((it, i) => {
    let pool = { sum: it.desired - prefix[i], n: 1 };
    while (pools.length > 0) {
      const prev = pools[pools.length - 1];
      if (prev.sum / prev.n <= pool.sum / pool.n) break;
      pools.pop();
      pool = { sum: prev.sum + pool.sum, n: prev.n + pool.n };
    }
    pools.push(pool);
  });
  const out: number[] = [];
  let i = 0;
  for (const pool of pools) {
    const base = pool.sum / pool.n;
    for (let k = 0; k < pool.n; k += 1, i += 1) out.push(base + prefix[i]);
  }
  return out;
}

// Segments always CARRY their union's lineage color; whether it is USED is
// decided at render time by the Lineage Colors toggle — so toggling swaps
// strokes without re-measuring (colors only, never layout).
type Seg = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
  color?: string;
};

// genderTintCss (GREEN men / ORANGE women / PURPLE other) moved to
// familyWeb.ts so the fan view shares the exact palette.

function PersonBox({
  persona,
  focused,
  blood,
  pinned,
  lineHue,
  tint,
  onSelect,
  boxRef,
}: {
  persona: Persona;
  focused: boolean;
  // Blood relative of the focus → solid border; married-in/non-blood →
  // dashed, echoing the connector language. Both read the SAME
  // muted-foreground color as the connector lines so box and line feel like
  // one system (user 2026-07-10).
  blood: boolean;
  // The tree's entry point (the sheet that opened it) — marked with a pin,
  // reinforcing the right-aligned "Back to {name}" control (user 2026-07-08).
  pinned?: boolean;
  // Lineage colour applied to the BORDER (user 2026-07-10: replaced the 2px
  // stripe over the name) — the person's effective hue; a midpoint blend
  // where two lines merged, matching their connector colour. Undefined
  // (married-in, or Lineage Colors off) falls back to the muted border.
  lineHue?: string;
  // Gender Tint background; undefined when the layer is off. Applies to the
  // focused box too — its emphasis is the inset ring, not a bg swap (user
  // 2026-07-10). Colors only — never layout.
  tint?: string;
  onSelect: () => void;
  boxRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={boxRef}
      type="button"
      onClick={onSelect}
      aria-pressed={focused}
      style={{ backgroundColor: tint, borderColor: lineHue }}
      className={cn(
        // Border WIDTH is constant across every state (focused / blood /
        // non-blood / hover) — only color and style (solid vs dashed)
        // change — so selecting or re-rooting never reflows a box by even a
        // pixel (user 2026-07-10: "borders inside the rect"). The focused
        // box reads THICKER via an inset ring (box-shadow — zero layout)
        // and keeps the same background as everyone else (user 2026-07-10:
        // gender tint stays visible on the selection). Width is UNIFORM
        // (w-44, names truncate) so layouts stay consistent and three
        // generation-columns always fit the panel (user 2026-07-10). Focus =
        // a WHITE ring OUTSIDE the cell (box-shadow — zero layout, no
        // position shift), leaving the border free to carry the lineage
        // colour (inline borderColor overrides the muted fallback).
        "flex w-44 flex-col items-center rounded-md border px-2.5 py-1 text-xs transition-colors",
        blood ? "border-solid" : "border-dashed",
        "border-muted-foreground/80 bg-background hover:bg-muted",
        focused && "ring-2 ring-white/90",
      )}
    >
      {/* Weight is CONSTANT — semibold-on-focus made the name (and so the
          content-sized box, row, and w-fit panel) wider on every selection
          (user 2026-07-10: "divs changing size"). Focus reads from the
          primary border + tint alone. */}
      <span className="flex w-full items-center justify-center gap-1 font-medium">
        <span className="truncate">
          {persona.givenName} {persona.familyName}
        </span>
        {pinned && <Pin className="text-muted-foreground size-3 shrink-0" aria-hidden />}
      </span>
      {/* Same row: gender icon left, age right (user 2026-07-10). */}
      <span className="flex w-full items-center justify-between gap-2">
        <GenderIcon identity={persona.genderIdentity} className="size-4" />
        <span className="text-muted-foreground">{persona.age}</span>
      </span>
    </button>
  );
}

function FamilyChart({
  web,
  focusId,
  originId,
  lineage,
  tint,
  vertical,
  onSelect,
}: {
  web: FamilyWeb;
  focusId: string;
  originId?: string;
  lineage: boolean;
  tint: boolean;
  // Column view (user 2026-07-10: "generations-as-columns may fit the
  // panel's space better"): SAME data/semantics transposed — generations
  // advance left→right instead of top→down, blocks pack on Y instead of X.
  // The measure pass below is written in (pack, gen) axis coordinates, so
  // one algorithm serves both orientations.
  vertical: boolean;
  onSelect: (id: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // The gesture layer between viewport and content: pan/zoom land here as a
  // single translate+scale, so the measured chart underneath never reflows.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // The un-transformed layout root: flex lays rows out here, blocks shift
  // within it, and the normalize step translates/scales it as one unit so
  // boxes and connectors always move together.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const boxRefs = useRef(new Map<string, HTMLButtonElement>());
  const [segs, setSegs] = useState<Seg[]>([]);
  // Fitted content-box size (w/h drive the sized wrapper; svgW/svgH the
  // overlay's nominal size — it draws outside via overflow-visible).
  const [view, setView] = useState({ w: 0, h: 0, svgW: 0, svgH: 0 });

  // Infinite-canvas gesture state (user 2026-07-11: pinch zoom + pan, like a
  // map). Lives in refs and lands as a direct style transform — no React
  // render per pointermove. `touched` distinguishes "user has navigated"
  // (keep their view across re-measures) from "still on the automatic fit".
  const gesture = useRef({ tx: 0, ty: 0, s: 1, touched: false, suppressClick: false });
  // Chart's natural size + per-generation column starts (content px, post-
  // normalize), refreshed by the measure pass for fit + snap math.
  const sizeRef = useRef({ w: 0, h: 0 });
  const genStartsRef = useRef<number[]>([]);

  const applyTransform = () => {
    const el = canvasRef.current;
    if (!el) return;
    const g = gesture.current;
    el.style.transform = `translate(${g.tx}px, ${g.ty}px) scale(${g.s})`;
  };
  // Keep at least a corner of the chart on screen — a pan can never lose it.
  const clampPan = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    const g = gesture.current;
    const w = sizeRef.current.w * g.s;
    const h = sizeRef.current.h * g.s;
    const keepX = Math.min(48, w);
    const keepY = Math.min(48, h);
    g.tx = Math.min(Math.max(g.tx, keepX - w), vp.clientWidth - keepX);
    g.ty = Math.min(Math.max(g.ty, keepY - h), vp.clientHeight - keepY);
  };
  // The header/footer hover OVER the canvas (user 2026-07-11) — the fit
  // keeps the tree clear of them; panning can still travel underneath.
  const FIT_PAD_X = 16;
  const FIT_PAD_TOP = 56;
  const FIT_PAD_BOTTOM = 72;
  const fitScale = () => {
    const vp = viewportRef.current;
    const { w, h } = sizeRef.current;
    if (!vp || !w || !h) return 1;
    const aw = Math.max(80, vp.clientWidth - FIT_PAD_X * 2);
    const ah = Math.max(80, vp.clientHeight - FIT_PAD_TOP - FIT_PAD_BOTTOM);
    return Math.min(1, aw / w, ah / h);
  };
  const fitTarget = () => {
    const vp = viewportRef.current;
    const { w, h } = sizeRef.current;
    if (!vp || !w || !h) return null;
    const s = fitScale();
    const ah = Math.max(80, vp.clientHeight - FIT_PAD_TOP - FIT_PAD_BOTTOM);
    return {
      s,
      tx: (vp.clientWidth - w * s) / 2,
      ty: FIT_PAD_TOP + (ah - h * s) / 2,
    };
  };
  // The automatic view: whole tree visible, centered between the overlays,
  // never upscaled past 1.
  const fitView = () => {
    const t = fitTarget();
    if (!t) return;
    const g = gesture.current;
    g.s = t.s;
    g.tx = t.tx;
    g.ty = t.ty;
    applyTransform();
  };
  // Double-click reset TWEENS home (user 2026-07-11 round 3) — ease-out
  // cubic over ~280ms; any new gesture cancels it and takes over. UI-only
  // animation, never an input to scene state.
  const tweenRaf = useRef<number | null>(null);
  const cancelTween = () => {
    if (tweenRaf.current !== null) {
      cancelAnimationFrame(tweenRaf.current);
      tweenRaf.current = null;
    }
  };
  const tweenToFit = () => {
    const t = fitTarget();
    if (!t) return;
    cancelTween();
    const g = gesture.current;
    const from = { tx: g.tx, ty: g.ty, s: g.s };
    const t0 = performance.now();
    const D = 280;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / D);
      const e = 1 - Math.pow(1 - k, 3);
      g.tx = from.tx + (t.tx - from.tx) * e;
      g.ty = from.ty + (t.ty - from.ty) * e;
      g.s = from.s + (t.s - from.s) * e;
      applyTransform();
      tweenRaf.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    tweenRaf.current = requestAnimationFrame(step);
  };

  const refFor = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) boxRefs.current.set(id, el);
    else boxRefs.current.delete(id);
  };

  useLayoutEffect(() => {
    const host = viewportRef.current;
    if (!host) return;

    const measure = () => {
      const contentEl = contentRef.current;
      if (!contentEl) return;
      // Union block wrappers are found by data attribute (not a ref map —
      // ref access during render trips react-hooks/refs).
      const blockEls = new Map<string, HTMLElement>();
      for (const el of host.querySelectorAll<HTMLElement>("[data-block-key]")) {
        blockEls.set(el.dataset.blockKey as string, el);
      }
      // Natural-layout read: clear transforms from a previous pass first
      // (blocks AND the normalize/fit transform on the content root, AND the
      // pan/zoom transform on the canvas layer — a scale there would scale
      // every rect delta below and corrupt the pack shifts; it's restored
      // after the pass, all inside one synchronous task, so nothing paints
      // in between). Transforms never affect layout, so this cannot loop
      // the observer.
      for (const el of blockEls.values()) el.style.transform = "";
      contentEl.style.transform = "";
      if (canvasRef.current) canvasRef.current.style.transform = "";

      // All coordinates below are relative to the content root's natural
      // (un-transformed) box — the same space the SVG overlay draws in.
      const hostRect = contentEl.getBoundingClientRect();
      type Box = {
        left: number;
        right: number;
        top: number;
        bottom: number;
        cx: number;
        cy: number;
      };
      const rel = (el: HTMLElement): Box => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left - hostRect.left,
          right: r.right - hostRect.left,
          top: r.top - hostRect.top,
          bottom: r.bottom - hostRect.top,
          cx: r.left - hostRect.left + r.width / 2,
          cy: r.top - hostRect.top + r.height / 2,
        };
      };

      // ---- Axis mapping (user 2026-07-10: column view). The PACK axis is
      // where packToward slides blocks (x in row view, y in column view);
      // the GEN axis is where generations advance (y in rows, x in
      // columns). Everything below is written in (pack, gen) coordinates
      // and converted only at the Seg boundary — one shared algorithm, two
      // orientations, no Y-variant fork.
      const packS = (b: Box) => (vertical ? b.top : b.left); // pack-axis start
      const packE = (b: Box) => (vertical ? b.bottom : b.right); // pack-axis end
      const packC = (b: Box) => (vertical ? b.cy : b.cx); // pack-axis center
      const genS = (b: Box) => (vertical ? b.left : b.top); // gen-axis start
      const genE = (b: Box) => (vertical ? b.right : b.bottom); // gen-axis end
      const toSeg = (
        p1: number,
        g1: number,
        p2: number,
        g2: number,
        dashed?: boolean,
        color?: string,
      ): Seg =>
        vertical
          ? { x1: g1, y1: p1, x2: g2, y2: p2, dashed, color }
          : { x1: p1, y1: g1, x2: p2, y2: g2, dashed, color };

      // Pending pack-axis translate per repositioned person. box() folds it
      // in, so connector math and the applied transforms always agree.
      const shiftFor = new Map<string, number>();
      // Pending translate per union BLOCK — applied in one batch after the
      // connector math (see the double-shift note below).
      const blockShifts = new Map<string, number>();
      const shifted = (r: Box, dx: number): Box =>
        !dx
          ? r
          : vertical
            ? { ...r, top: r.top + dx, bottom: r.bottom + dx, cy: r.cy + dx }
            : { ...r, left: r.left + dx, right: r.right + dx, cx: r.cx + dx };
      const box = (id: string): Box | null => {
        const el = boxRefs.current.get(id);
        return el ? shifted(rel(el), shiftFor.get(id) ?? 0) : null;
      };

      // Current (accumulated-shift) box for a union BLOCK element.
      const blockBox = (u: UnionNode): Box | null => {
        const el = blockEls.get(u.key);
        return el ? shifted(rel(el), blockShifts.get(u.key) ?? 0) : null;
      };
      // person id → owning union, for the top-down pass's parent lookups.
      const unionOf = new Map<string, UnionNode>();
      for (const row of web.rows) for (const u of row) for (const m of u.members) unionOf.set(m.id, u);

      // Pack one row toward per-block target centers (order preserved,
      // tighter min gap in column mode where vertical space is the scarce
      // axis), ACCUMULATING into shiftFor/blockShifts. NO viewport clamp:
      // rows place purely by their targets — the old clamp bounded each row
      // into the VISIBLE region, so a row taller/wider than it (e.g. a
      // grandchildren column) was displaced wholesale relative to its
      // parents' row, landing children off their union anchors (user
      // 2026-07-10: Joshua ~25px below Adam+Jennifer's midpoint). The
      // normalize step after the connector math re-origins the global
      // bounding box instead, so negative coordinates are fine here. Do NOT
      // apply transforms mid-pass: box() reads live rects, so a transform
      // landing early would be counted twice in every later read (the v6
      // double-shift bug) — they land in one batch later.
      // Spacing grammar (user 2026-07-10 pass): SIBLING singles sit at the
      // SAME gap as partners inside a couple (gap-2 = 8px — one visual
      // rhythm for "these people belong together"), while COUPLE blocks get
      // 3× that on either side, so groups of partners read as separate
      // units and their drop lines have air. The tight gap requires ACTUAL
      // siblinghood — same parent union — so cousin-group boundaries (e.g.
      // Joseph Ortiz under the Gonzales kids) get the wide gap too (user
      // 2026-07-11).
      const wideGap = vertical ? 24 : 28;
      const tightGap = vertical ? 8 : 10;
      const wantsAir = (u: UnionNode) => u.members.length > 1;
      const parentKeyOf = new Map<string, string | undefined>();
      for (const row of web.rows) {
        for (const u of row) {
          let pk: string | undefined;
          for (const m of u.members) {
            const pid = m.family.find(
              (l) => l.role === "parent" && unionOf.has(l.personaId),
            )?.personaId;
            if (pid) {
              pk = unionOf.get(pid)?.key;
              break;
            }
          }
          parentKeyOf.set(u.key, pk);
        }
      }
      const siblings = (a: UnionNode, b: UnionNode) => {
        const pa = parentKeyOf.get(a.key);
        return pa !== undefined && pa === parentKeyOf.get(b.key);
      };
      const packToward = (row: UnionNode[], targetFor: (u: UnionNode, cur: Box) => number) => {
        const calc = row.flatMap((u) => {
          const cur = blockBox(u);
          return cur ? [{ u, cur, target: targetFor(u, cur) }] : [];
        });
        if (calc.length === 0) return;
        const widths = calc.map((c) => packE(c.cur) - packS(c.cur));
        const lefts = packRow(
          calc.map((c, i) => ({
            desired: c.target - widths[i] / 2,
            width: widths[i],
            gapBefore:
              i > 0 &&
              !wantsAir(calc[i - 1].u) &&
              !wantsAir(c.u) &&
              siblings(calc[i - 1].u, c.u)
                ? tightGap
                : wideGap,
          })),
        );
        calc.forEach((c, i) => {
          const delta = lefts[i] - packS(c.cur);
          if (Math.abs(delta) < 0.01) return;
          const dx = (blockShifts.get(c.u.key) ?? 0) + delta;
          blockShifts.set(c.u.key, dx);
          for (const m of c.u.members) shiftFor.set(m.id, dx);
        });
      };

      // Two-direction placement (user 2026-07-10: "keep children close to
      // alignment with their parents — now each row is centered"): the
      // bottom-up pass centers each union over the mean x of its CHILDREN;
      // the top-down pass then pulls each union toward the mean anchor x of
      // its members' PARENT unions (a join union splits the difference
      // between its two families). Alternating twice converges visually —
      // ending top-down so children sit under their parents, which is the
      // read the user asked for; the bus jog absorbs the residual on the
      // parent side. Deterministic, focus-independent, order-preserving.
      const passUp = () => {
        for (let r = web.rows.length - 2; r >= 0; r -= 1) {
          packToward(web.rows[r], (u, cur) => {
            const kids = u.childIds.map(box).filter(Boolean) as Box[];
            return kids.length
              ? kids.reduce((s, k) => s + packC(k), 0) / kids.length
              : packC(cur);
          });
        }
      };
      // The exact pack-axis point a child HANGS from: the union-line
      // midpoint between the parent couple's boxes (same formula as
      // coupleAnchor), the member's own box center for a single parent, or
      // the ±14 member-box offset for remarriage-split solo children. The
      // children group must center on this point — the block's geometric
      // center is only equal to it when both member boxes are the same size
      // and nothing else skews the block (user 2026-07-10 rule).
      const hangPointFor = (pu: UnionNode, childId: string): number | null => {
        const solo = pu.soloChildIds.find((s) => s.kids.includes(childId));
        if (solo) {
          const m = box(solo.memberId);
          if (!m) return null;
          const isFirst = pu.members.length === 2 && solo.memberId === pu.members[0].id;
          return packC(m) + (isFirst ? -14 : 14);
        }
        const a = box(pu.members[0].id);
        if (!a) return null;
        const b = pu.members[1] ? box(pu.members[1].id) : null;
        if (!b) return packC(a);
        const [l, r] = packC(a) <= packC(b) ? [a, b] : [b, a];
        return (packE(l) + packS(r)) / 2;
      };
      const passDown = () => {
        for (let r = 1; r < web.rows.length; r += 1) {
          packToward(web.rows[r], (u, cur) => {
            const anchors: number[] = [];
            for (const m of u.members) {
              const parentIds = m.family
                .filter((l) => l.role === "parent")
                .map((l) => l.personaId);
              const parentUnion = parentIds.map((pid) => unionOf.get(pid)).find(Boolean);
              const p = parentUnion ? hangPointFor(parentUnion, m.id) : null;
              if (p !== null) anchors.push(p);
            }
            return anchors.length
              ? anchors.reduce((s, a) => s + a, 0) / anchors.length
              : packC(cur);
          });
        }
      };
      // Alternate until the layout settles (user 2026-07-11: group spacing
      // vs child alignment). The fixed point is the tidy-tree layout —
      // parents spread to sit over their subtree widths, children exactly
      // on their forks; two rounds left visible residual when cousin groups
      // outgrew their parents' spacing. Four rounds converge in practice
      // (≤60 blocks, each pass is trivial); ending on passDown keeps the
      // child-under-parent read exact, with any last residual on the parent
      // side where the bus jog absorbs it.
      for (let i = 0; i < 4; i++) {
        passUp();
        passDown();
      }

      const next: Seg[] = [];
      // Union line between adjacent partners; returns the anchor children
      // hang from (line midpoint for a couple, gen-axis end of the box for
      // a single: bottom edge in rows, right edge in columns). Genogram
      // semantics: married = solid, dating = dashed. The whole connector
      // set of a union (partner line, drop, bus, stubs) takes the union's
      // effective lineage color — a midpoint blend where two lines merge
      // (user 2026-07-10: colorized connectors, "have both").
      const coupleAnchor = (
        aId: string,
        bId?: string,
        dashed?: boolean,
        color?: string,
      ): { p: number; g: number; gEdge: number } | null => {
        const a = box(aId);
        if (!a) return null;
        const b = bId ? box(bId) : null;
        if (!b) return { p: packC(a), g: genE(a), gEdge: genE(a) };
        const [l, r] = packC(a) <= packC(b) ? [a, b] : [b, a];
        // Couple BRACKET (user 2026-07-11: "hard to see Ashley and Jacob's
        // connection"): the old union line lived in the 8px alley between
        // partners — a ~6px sliver, invisible when dashed (dating).
        // Genogram-style instead: a solid stub exits each partner's trailing
        // edge, joined by the marriage bar just outside the boxes — long
        // enough for dashes to actually read — and children hang from the
        // bar's midpoint. gEdge = the bar, so the connector channel begins
        // past it and nothing downstream overlaps cells.
        const bracketG = Math.max(genE(l), genE(r)) + 8;
        next.push(toSeg(packC(l), genE(l), packC(l), bracketG, undefined, color));
        next.push(toSeg(packC(r), genE(r), packC(r), bracketG, undefined, color));
        next.push(toSeg(packC(l), bracketG, packC(r), bracketG, dashed, color));
        return { p: (packC(l) + packC(r)) / 2, g: bracketG, gEdge: bracketG };
      };
      // Parent→children connections are gathered first and emitted per
      // child-row below, so buses that would overlap at the same gen-axis
      // offset can take separate lanes.
      type Conn = {
        anchor: { p: number; g: number; gEdge: number };
        kids: Box[];
        color?: string;
      };
      const pending: Conn[] = [];
      const connect = (
        anchor: { p: number; g: number; gEdge: number } | null,
        kidIds: string[],
        color?: string,
      ) => {
        if (!anchor) return;
        const kids = kidIds.map(box).filter(Boolean) as Box[];
        if (kids.length > 0) pending.push({ anchor, kids, color });
      };

      for (const row of web.rows) {
        for (const u of row) {
          const anchor = coupleAnchor(u.members[0].id, u.members[1]?.id, u.dashed, u.lineColor);
          if (u.sharedChildIds.length > 0) connect(anchor, u.sharedChildIds, u.lineColor);
          // Prior-relationship children hang from their own parent's box,
          // not the union line (remarriage split — user 2026-07-08).
          for (const solo of u.soloChildIds) {
            const m = box(solo.memberId);
            if (!m) continue;
            const isFirst = u.members.length === 2 && solo.memberId === u.members[0].id;
            connect(
              { p: packC(m) + (isFirst ? -14 : 14), g: genE(m), gEdge: genE(m) },
              solo.kids,
              u.lineColor,
            );
          }
        }
      }

      // Emit drops, buses, and stubs. A bus spans only its own children's
      // stubs (plus a jog out to the drop when packing displaced the parent
      // block past that span); it may still pass over an unrelated box when
      // the children straddle one — acceptable now that the parent sits
      // centered above its children. Buses over the same row whose spans
      // intersect take stacked y-lanes, NARROW spans low and wide straddling
      // spans higher, so a stub rarely crosses a foreign bus (user
      // 2026-07-10: a single-child drop landing inside another couple's bus
      // span must not read as that couple's parentage).
      const busRows = new Map<number, Conn[]>();
      for (const c of pending) {
        const key = Math.round(Math.min(...c.kids.map(genS)));
        busRows.set(key, [...(busRows.get(key) ?? []), c]);
      }
      for (const rowG of [...busRows.keys()].sort((a, b) => a - b)) {
        const conns = (busRows.get(rowG) as Conn[])
          .map((c) => {
            const ps = c.kids.map(packC);
            return {
              ...c,
              p1: Math.min(...ps, c.anchor.p),
              p2: Math.max(...ps, c.anchor.p),
            };
          })
          .sort(
            (p, q) => p.p2 - p.p1 - (q.p2 - q.p1) || p.p1 - q.p1 || p.anchor.p - q.anchor.p,
          );
        // The TRUE inter-column channel for this group: from the widest
        // parent union's trailing edge to the child row's leading edge —
        // buses live strictly inside it, so lines never overlap cells
        // (user 2026-07-10).
        const parentEdge = Math.max(...conns.map((c) => c.anchor.gEdge));
        const lanes: Array<Array<{ p1: number; p2: number }>> = [];
        for (const c of conns) {
          let lane = 0;
          while ((lanes[lane] ?? []).some((s) => c.p1 <= s.p2 + 10 && s.p1 - 10 <= c.p2)) lane += 1;
          (lanes[lane] ??= []).push({ p1: c.p1, p2: c.p2 });
          // Fork sits at the CENTER of the channel; parallel buses fan
          // alternately around it (only when lanes are actually needed),
          // clamped inside the channel with a 6px margin off the cells.
          const laneOff = lane === 0 ? 0 : lane % 2 === 1 ? -7 * Math.ceil(lane / 2) : 7 * (lane / 2);
          const busG = Math.min(
            Math.max((parentEdge + rowG) / 2 + laneOff, parentEdge + 6),
            rowG - 6,
          );
          const color = c.color;
          next.push(toSeg(c.anchor.p, c.anchor.g, c.anchor.p, busG, undefined, color));
          if (c.p2 - c.p1 > 0.5) next.push(toSeg(c.p1, busG, c.p2, busG, undefined, color));
          for (const k of c.kids) {
            next.push(toSeg(packC(k), busG, packC(k), genS(k), undefined, color));
          }
        }
      }

      // Per-generation snap targets (user 2026-07-11: "some snapping for
      // columns"): the gen-axis start of each generation row. Pack shifts
      // move blocks along the pack axis only, so genS here is final.
      const rowGenStarts: number[] = [];
      for (const row of web.rows) {
        let g0 = Infinity;
        for (const u of row) {
          const b = blockBox(u);
          if (b) g0 = Math.min(g0, genS(b));
        }
        if (Number.isFinite(g0)) rowGenStarts.push(g0);
      }

      // Content bounding box across shifted blocks AND connector segments,
      // read BEFORE transforms land (blockBox double-counts afterwards).
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const row of web.rows) {
        for (const u of row) {
          const b = blockBox(u);
          if (!b) continue;
          minX = Math.min(minX, b.left);
          minY = Math.min(minY, b.top);
          maxX = Math.max(maxX, b.right);
          maxY = Math.max(maxY, b.bottom);
        }
      }
      for (const s of next) {
        minX = Math.min(minX, s.x1, s.x2);
        minY = Math.min(minY, s.y1, s.y2);
        maxX = Math.max(maxX, s.x1, s.x2);
        maxY = Math.max(maxY, s.y1, s.y2);
      }
      if (!Number.isFinite(minX)) {
        minX = minY = 0;
        maxX = maxY = 0;
      }

      // NOW land the block transforms, in one batch — no box() read happens
      // after this point, so nothing can see a rect that already moved (the
      // double-shift). Transforms never affect layout → no observer loop.
      // The translate runs along the pack axis: X in rows, Y in columns.
      for (const [key, dx] of blockShifts) {
        const el = blockEls.get(key);
        if (el) {
          el.style.transform = dx
            ? vertical
              ? `translateY(${dx}px)`
              : `translateX(${dx}px)`
            : "";
        }
      }

      // NORMALIZE (user 2026-07-10: "no horizontal scroll despite fitting").
      // The flex layout centers content naturally, then the pack shifts move
      // blocks — extending the natural bounds without shrinking the stale
      // w-max extents. Fix: translate the whole content root so the actual
      // bounding box starts at the padding, and size an explicit wrapper to
      // exactly that box. The panel still grows around the wrapper for small
      // trees; when the panel's caps shrink the viewport, the canvas fit
      // below scales the whole tree into view — navigation from there is
      // pan/pinch-zoom (user 2026-07-11), never scrollbars.
      const pad = 12;
      const w0 = maxX - minX + pad * 2;
      const h0 = maxY - minY + pad * 2;
      contentEl.style.transform = `translate(${pad - minX}px, ${pad - minY}px)`;

      sizeRef.current = { w: Math.ceil(w0), h: Math.ceil(h0) };
      // Snap targets in post-normalize content coordinates.
      const genOrigin = vertical ? pad - minX : pad - minY;
      genStartsRef.current = rowGenStarts.map((g) => g + genOrigin).sort((a, b) => a - b);

      // Restore the gesture view over the fresh layout: the user's own
      // pan/zoom if they've navigated, else the automatic fit. (A view-size
      // change also re-runs the fit via the layout effect keyed on `view`,
      // once the new explicit width/height have landed in the DOM.)
      if (gesture.current.touched) {
        clampPan();
        applyTransform();
      } else {
        fitView();
      }

      setSegs(next);
      setView({
        w: Math.ceil(w0),
        h: Math.ceil(h0),
        svgW: Math.max(0, maxX),
        svgH: Math.max(0, maxY),
      });
    };

    // A re-root is a new chart — drop any user pan/zoom back to the fit.
    if (prevFocusRef.current !== focusId) {
      prevFocusRef.current = focusId;
      gesture.current.touched = false;
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    // ALSO observe the natural-size content root: late box growth (web-font
    // swap, icon load) doesn't resize the host — its size is pinned by the
    // wrapper WE sized — so without this the chart outgrows a stale wrapper
    // by a sliver (the 33px Amanda case, user 2026-07-11). No feedback:
    // measure only sets a translate transform on this element, which never
    // changes its observed box.
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [web, focusId, vertical]);

  const prevFocusRef = useRef(focusId);

  // A reset tween must not outlive the chart (dialog close mid-tween).
  useEffect(() => cancelTween, []);

  // First measure of a new tree: the explicit width/height only reach the
  // DOM with this render, so the viewport's client size is only now correct
  // for fit math — settle the automatic fit (or re-clamp a user view).
  useLayoutEffect(() => {
    if (gesture.current.touched) {
      clampPan();
      applyTransform();
    } else {
      fitView();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Gesture wiring (user 2026-07-11: "navigable on mobile — pinch zooming
  // and panning around, like an infinite canvas with some snapping for
  // columns"). Native listeners: wheel needs passive:false to preventDefault,
  // and pointer capture is only taken once a drag is real, so plain taps
  // still click the person boxes underneath.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let panStart: { x: number; y: number; tx: number; ty: number } | null = null;
    let dragging = false;
    let pinch: { d0: number; s0: number; mid0: { x: number; y: number }; tx0: number; ty0: number } | null =
      null;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = vp.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const zoomAt = (px: number, py: number, targetS: number) => {
      const g = gesture.current;
      const s2 = Math.min(2.5, Math.max(fitScale() * 0.5, targetS));
      const k = s2 / g.s;
      g.tx = px - (px - g.tx) * k;
      g.ty = py - (py - g.ty) * k;
      g.s = s2;
      g.touched = true;
      clampPan();
      applyTransform();
    };
    // Magnetic column snap on release: if a generation column's leading edge
    // is within reach of the viewport's leading edge, glide it flush. Only
    // when the chart actually overflows on the gen axis — a fitted tree
    // never jumps.
    const snapColumns = () => {
      const g = gesture.current;
      const starts = genStartsRef.current;
      if (starts.length < 2) return;
      const genExtent = (vertical ? sizeRef.current.w : sizeRef.current.h) * g.s;
      const vpExtent = vertical ? vp.clientWidth : vp.clientHeight;
      if (genExtent <= vpExtent + 4) return;
      const t = vertical ? g.tx : g.ty;
      const cNow = (12 - t) / g.s; // content coord at the leading edge + margin
      let best = starts[0];
      for (const c of starts) if (Math.abs(c - cNow) < Math.abs(best - cNow)) best = c;
      const t2 = 12 - best * g.s;
      if (Math.abs(t2 - t) > 40) return;
      if (vertical) g.tx = t2;
      else g.ty = t2;
      clampPan();
      applyTransform();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      cancelTween(); // a new gesture takes over any reset tween
      gesture.current.suppressClick = false;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const g = gesture.current;
        panStart = { x: e.clientX, y: e.clientY, tx: g.tx, ty: g.ty };
        dragging = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const g = gesture.current;
        pinch = {
          d0: Math.hypot(a.x - b.x, a.y - b.y),
          s0: g.s,
          mid0: local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }),
          tx0: g.tx,
          ty0: g.ty,
        };
        panStart = null;
        // Two fingers are never a tap — take the pointers now.
        for (const id of pointers.keys()) vp.setPointerCapture(id);
        gesture.current.suppressClick = true;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        const s2 = Math.min(2.5, Math.max(fitScale() * 0.5, pinch.s0 * (d / Math.max(1, pinch.d0))));
        const k = s2 / pinch.s0;
        // Anchor the content point under the initial midpoint, then follow
        // the midpoint as it moves — zoom and pan in one gesture.
        g.tx = mid.x - (pinch.mid0.x - pinch.tx0) * k;
        g.ty = mid.y - (pinch.mid0.y - pinch.ty0) * k;
        g.s = s2;
        g.touched = true;
        clampPan();
        applyTransform();
        return;
      }
      if (!panStart) return;
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 4) return;
        dragging = true;
        gesture.current.suppressClick = true;
        // Capture only once the drag is real — capturing on pointerdown
        // would retarget pointerup and eat plain clicks on the boxes.
        vp.setPointerCapture(e.pointerId);
      }
      g.tx = panStart.tx + dx;
      g.ty = panStart.ty + dy;
      g.touched = true;
      clampPan();
      applyTransform();
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        // Pinch → single-finger pan continues from the survivor.
        const [rest] = [...pointers.values()];
        const g = gesture.current;
        panStart = { x: rest.x, y: rest.y, tx: g.tx, ty: g.ty };
        dragging = true;
        return;
      }
      if (pointers.size === 0) {
        if (dragging || gesture.current.suppressClick) snapColumns();
        panStart = null;
        dragging = false;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelTween();
      const g = gesture.current;
      // Desktop zoom is deliberate-only (user 2026-07-11: "not sure about
      // desktop"): Ctrl/Cmd+wheel zooms — which is ALSO what trackpad pinch
      // reports as — while a plain wheel PANS, keeping the chart at crisp
      // 1:1 for ordinary scrolling around a big tree.
      if (e.ctrlKey || e.metaKey) {
        const p = local(e);
        zoomAt(p.x, p.y, g.s * Math.exp(-e.deltaY * 0.0035));
        return;
      }
      g.tx -= e.deltaX;
      if (e.shiftKey) g.tx -= e.deltaY;
      else g.ty -= e.deltaY;
      g.touched = true;
      clampPan();
      applyTransform();
    };

    vp.addEventListener("pointerdown", onPointerDown);
    vp.addEventListener("pointermove", onPointerMove);
    vp.addEventListener("pointerup", onPointerEnd);
    vp.addEventListener("pointercancel", onPointerEnd);
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      vp.removeEventListener("pointerdown", onPointerDown);
      vp.removeEventListener("pointermove", onPointerMove);
      vp.removeEventListener("pointerup", onPointerEnd);
      vp.removeEventListener("pointercancel", onPointerEnd);
      vp.removeEventListener("wheel", onWheel);
    };
  }, [vertical]);

  const renderBox = (p: Persona) => (
    <PersonBox
      key={p.id}
      persona={p}
      focused={p.id === focusId}
      blood={web.bloodIds.has(p.id)}
      pinned={p.id === originId}
      lineHue={
        lineage && web.hues.has(p.id) ? hueCss(web.hues.get(p.id) as number) : undefined
      }
      tint={tint ? genderTintCss(p.genderIdentity) : undefined}
      onSelect={() => onSelect(p.id)}
      boxRef={refFor(p.id)}
    />
  );
  // One union = one glued block (couple or single), the unit the measure
  // pass repositions. Flex only provides the initial layout; the packing
  // above centers each block over its own children (user 2026-07-10). In
  // column view the couple stacks vertically and the whole chart transposes.
  const renderUnion = (u: UnionNode) => (
    <div
      key={u.key}
      data-block-key={u.key}
      className={cn("flex gap-2", vertical ? "flex-col items-start" : "items-start")}
    >
      {u.members.map(renderBox)}
    </div>
  );

  return (
    // Shell: an infinite-canvas viewport (user 2026-07-11 — replaced the
    // ScrollArea; there is no scroll container anymore, so the transform
    // ghost-box scrollbars can't come back). The viewport is still sized
    // EXPLICITLY to the measured chart box, so the w-fit panel GROWS to fit
    // small trees exactly as before; min-h-0/max-w-full let flex shrink it
    // when the panel hits its 85vh/96vw caps — and THAT is where the canvas
    // takes over: the automatic fit scales the whole tree into view, then
    // drag pans, wheel/pinch zooms (anchored on cursor/midpoint), release
    // snaps the nearest generation column flush, double-click re-fits.
    // touch-action:none hands touch gestures to the pointer handlers.
    // my-auto: a SHORT chart doesn't fill the panel's 30rem floor — auto
    // margins soak the leftover space so the chart centers and the footer/
    // controls rows stay pinned to the card's BOTTOM (user 2026-07-11).
    <>
      {/* In-flow SIZER: drives the panel's grow-to-fit sizing (chart box +
          overlay allowance) while the canvas itself is ABSOLUTE and fills
          the whole panel — the chart runs edge to edge under the hovering
          header/footer (user 2026-07-11). min-h-0/max-w-full let the panel's
          caps shrink it exactly like the old in-flow viewport. */}
      <div
        aria-hidden
        className="pointer-events-none min-h-0 max-w-full"
        style={{
          width: view.w ? view.w + FIT_PAD_X * 2 : undefined,
          height: view.h ? view.h + FIT_PAD_TOP + FIT_PAD_BOTTOM : undefined,
        }}
      />
      <div
      ref={viewportRef}
      className="absolute inset-0 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
      onClickCapture={(e) => {
        // A pan that ends over a person box must not read as a click.
        if (gesture.current.suppressClick) {
          e.preventDefault();
          e.stopPropagation();
          gesture.current.suppressClick = false;
        }
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        gesture.current.touched = false;
        tweenToFit();
      }}
    >
      {/* The gesture layer: pan/zoom land here as one transform. NO
          will-change — pinning the layer kept its raster cached at layout
          scale, so zooming scaled PIXELS (user 2026-07-11: "very
          pixelated"); without it the browser re-rasterizes the DOM/SVG
          vectors crisp once the gesture settles. */}
      <div ref={canvasRef} className="absolute top-0 left-0 origin-top-left">
        {/* overflow-hidden: the normalize contract puts ALL visible content
            inside this box — the content root's own natural-layout box
            (translated, not resized) can hang past it (the 33px Amanda
            sliver, user 2026-07-11); clipping it can never hide anything
            real. */}
        <div
          className="relative overflow-hidden"
          style={{ width: view.w, height: view.h }}
        >
          <div
            ref={contentRef}
            className={cn(
              "absolute top-0 left-0 flex w-max origin-top-left items-center justify-center",
              // Channel width back to gap-7 — the centered forks made the
              // extra column distance unnecessary (user 2026-07-10).
              vertical ? "flex-row gap-7" : "flex-col gap-9",
            )}
          >
            <svg
              className="text-muted-foreground/80 pointer-events-none absolute top-0 left-0 overflow-visible"
              width={view.svgW}
              height={view.svgH}
              aria-hidden
            >
              {segs.map((s, i) => (
                <line
                  key={i}
                  x1={s.x1}
                  y1={s.y1}
                  x2={s.x2}
                  y2={s.y2}
                  // Lineage Colors on → the union's line hue/blend; off (or no
                  // colored member) → the muted connector color via currentColor.
                  stroke={lineage && s.color ? s.color : "currentColor"}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? "2 5" : undefined}
                />
              ))}
            </svg>
            {web.rows.map((row, i) => (
              <div
                key={row[0]?.key ?? i}
                className={cn(
                  "flex justify-center gap-4",
                  vertical ? "flex-col items-start" : "items-start",
                )}
              >
                {row.map(renderUnion)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// Nav cheat-sheet rows (user 2026-07-11 round 3 follow-up): the same
// kbd-chip anatomy as the main "?" ControlsGuide, laid out as a horizontal
// strip flush to the panel's bottom while the "?" toggle is on.
const CHART_CONTROLS: Array<{ cap: string; label: string }> = [
  { cap: "Drag", label: "Pan" },
  { cap: "Scroll", label: "Pan" },
  { cap: "Shift+Scroll", label: "Sideways" },
  { cap: "Ctrl+Scroll", label: "Zoom" },
  { cap: "Pinch", label: "Zoom" },
  { cap: "2×Click", label: "Reset" },
  { cap: "Click", label: "Re-root" },
];

// Chart control toggle — icon button following the app's icon-toggle
// convention (aria-pressed + bg-primary/30 active state); the tooltip is
// the action name only, Title Case.
function LayerToggle({
  label,
  pressed,
  onToggle,
  children,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <IconTip label={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onToggle}
        className={cn(pressed && "bg-primary/30")}
      >
        {children}
      </Button>
    </IconTip>
  );
}

export function FamilyTree({ personaId, indexes }: { personaId: string; indexes: EntityIndexes }) {
  const push = useSceneStore((s) => s.pushColumn);
  // Controlled so "Open Full Card" can close programmatically — DialogClose's
  // absolute-positioning classes can't be overridden through a render prop
  // (base-ui concatenates classNames there; twMerge never sees the conflict).
  const [open, setOpen] = useState(false);
  const [focusId, setFocusId] = useState(personaId);
  // Display layers (dialog-local): colors only — toggling never changes
  // layout (user 2026-07-10).
  // Both display layers default ON (user 2026-07-10).
  const [lineage, setLineage] = useState(true);
  const [tintOn, setTintOn] = useState(true);
  const [cardMin, setCardMin] = useState(false);
  // "?" is a TOGGLE (user 2026-07-11) — shows the nav strip while pressed.
  const [helpOpen, setHelpOpen] = useState(false);
  // Display mode (user 2026-07-10): Rows = the web chart, Columns = the
  // same chart transposed (generations as columns — often a better fit for
  // the panel with 3-4 generations), Fan = the bow-tie blood-lineage fan.
  // Columns only for now (user 2026-07-10: modes hidden from the UI while
  // the column layout gets dialed in) — the rows/fan render paths stay
  // intact behind this constant for when the cluster returns.
  const mode = "columns" as "rows" | "columns" | "fan";
  // Re-root on the sheet's persona whenever the dialog is opened for a new one.
  const [prevPersonaId, setPrevPersonaId] = useState(personaId);
  if (personaId !== prevPersonaId) {
    setPrevPersonaId(personaId);
    setFocusId(personaId);
  }

  const focus = indexes.directory.personas.get(focusId) ?? indexes.directory.personas.get(personaId);
  if (!focus) return null;
  // No view-aware per-generation budget anymore (user 2026-07-11): the
  // pan/zoom canvas makes oversized generations navigable, so only
  // familyWeb's global box cap still trims (the "+N more" footer note).
  const web = buildFamilyWeb(indexes, focus);
  const fan = mode === "fan" ? buildFamilyFan(indexes, focus, web) : null;
  const origin = indexes.directory.personas.get(personaId);

  // Fixed-height footer content: the box-cap trim notice first, then the
  // offstage relatives — one truncated line (see the slot comment below).
  const footerBits = [
    web.trimmed > 0 ? `+${web.trimmed} more in this line…` : null,
    focus.offstage.length > 0
      ? `Elsewhere: ${focus.offstage.map((rel) => `${rel.name} (${rel.role})`).join(" · ")}`
      : null,
  ].filter(Boolean);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setFocusId(personaId);
      }}
    >
      <IconTip label="Family Tree">
        <DialogTrigger
          nativeButton={false}
          render={
            // Span-rendered (nativeButton={false}) so the trigger can live
            // INSIDE the Family header's CollapsibleTrigger button (user
            // 2026-07-11) — Base UI wires role/keyboard semantics onto the
            // span, same as the directory's pin.
            <Button
              render={<span />}
              nativeButton={false}
              variant="ghost"
              size="icon-sm"
              aria-label="Open family tree"
            >
              <Network />
            </Button>
          }
        />
      </IconTip>
      <DialogPortal>
        <DialogBackdrop />
        {/* Top-anchored (not centered): the panels keep the SAME Y as the
            tree grows/shrinks between re-roots, so the resident card never
            bounces (user 2026-07-08). Scrim clicks close (user 2026-07-11):
            the popup is a fullscreen flex, so the visible scrim is INSIDE it
            and Base UI's outside-click dismiss never fires — self-target
            checks on the popup and the transparent content wrapper catch
            clicks that land on empty scrim area (including the gap between
            the two panels) without touching clicks inside them. */}
        <DialogPopup
          className="items-start pt-[6vh]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <DialogContent
            className="w-fit max-w-[96vw] border-0 bg-transparent p-0 shadow-none"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div
              className="flex items-start gap-3"
              onClick={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
            >
              {/* Tree panel: its own surface, width FITS the chart (user
                  2026-07-08 — mitigate scrollbars); it only scrolls past the
                  viewport caps. Clicking a box re-roots the chart. */}
              {/* Generous minimum so re-rooting between typical families
                  doesn't resize the panel — only genuinely big charts grow
                  (user 2026-07-08). Floor raised 26→30rem / 36→44rem for the
                  re-rolled multi-household city, where three-generation
                  charts are common (user 2026-07-10); the max caps keep
                  small screens working. */}
              {/* overflow-hidden on the PANEL, overflow-auto on the chart
                  viewport below (user 2026-07-10): the header and both footer
                  rows stay fixed in place — only the tree scrolls. */}
              <div
                data-slot="family-tree-panel"
                className="relative flex max-h-[85vh] min-h-[30rem] w-fit min-w-[44rem] max-w-[calc(96vw-19.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-md tabular-nums"
              >
                {mode === "fan" && fan ? (
                  <FanChart fan={fan} lineage={lineage} tint={tintOn} onSelect={setFocusId} />
                ) : (
                  <FamilyChart
                    web={web}
                    focusId={focus.id}
                    originId={origin?.id}
                    lineage={lineage}
                    tint={tintOn}
                    vertical={mode === "columns"}
                    onSelect={setFocusId}
                  />
                )}
                {/* Header HOVERS over the chart on a soft scrim (user
                    2026-07-11: the canvas fills the entire panel) —
                    pointer-events pass through the gradient to the chart;
                    only the controls themselves catch clicks. Title left;
                    back control + X share the right cluster (user
                    2026-07-08). */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 rounded-t-xl bg-gradient-to-b from-popover via-popover/55 to-transparent px-4 pt-3 pb-6">
                  <DialogTitle className="min-w-0 truncate text-sm font-medium text-foreground">
                    The {focus.familyName} Family
                  </DialogTitle>
                  <div className="pointer-events-auto flex items-center gap-2">
                    {/* Always visible (user 2026-07-08) — the anchor reads
                        even before re-rooting; disabled while the focus IS
                        the entry person. */}
                    {origin && (
                      <button
                        type="button"
                        onClick={() => setFocusId(origin.id)}
                        disabled={focus.id === origin.id}
                        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-normal disabled:cursor-default disabled:opacity-45 disabled:hover:text-muted-foreground"
                      >
                        Back to {origin.givenName}
                        <Undo2 className="size-3.5" aria-hidden />
                      </button>
                    )}
                    <DialogClose className="static" aria-label="Close family tree">
                      <X className="size-4" />
                    </DialogClose>
                  </div>
                </div>
                {/* Footer overlay: trim/offstage line + the controls row,
                    hovering over the chart's bottom edge on the mirrored
                    scrim (user 2026-07-11). Both rows keep constant heights
                    so nothing shifts when the note appears. */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-b-xl bg-gradient-to-t from-popover via-popover/55 to-transparent px-4 pt-6 pb-2">
                  <div className="h-5 shrink-0 truncate text-xs text-muted-foreground">
                    {footerBits.join(" · ")}
                  </div>
                  {/* Nav strip (user 2026-07-11): the main "?" guide's
                      kbd-chip anatomy as a horizontal list flush to the
                      panel bottom, shown while the "?" toggle is pressed. */}
                  {helpOpen && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1.5 text-sm">
                      {CHART_CONTROLS.map((c) => (
                        <span key={`${c.cap}:${c.label}`} className="flex items-center gap-1.5">
                          <kbd className="inline-flex justify-center rounded bg-amber-400 px-1.5 py-0.5 font-mono text-xs font-semibold text-black">
                            {c.cap}
                          </kbd>
                          <span className="text-foreground/80">{c.label}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex h-8 shrink-0 items-center justify-between">
                    <div className="pointer-events-auto flex items-center gap-1">
                      {/* Mode cluster (Rows/Columns/Fan) hidden for now (user
                          2026-07-10) — columns only while the layout gets
                          dialed in; the render paths remain behind `mode`. */}
                      <LayerToggle
                        label="Lineage Colors"
                        pressed={lineage}
                        onToggle={() => setLineage((v) => !v)}
                      >
                        <Palette />
                      </LayerToggle>
                      <LayerToggle
                        label="Gender Tint"
                        pressed={tintOn}
                        onToggle={() => setTintOn((v) => !v)}
                      >
                        <Blend />
                      </LayerToggle>
                      <LayerToggle
                        label="Chart Controls"
                        pressed={helpOpen}
                        onToggle={() => setHelpOpen((v) => !v)}
                      >
                        <span className="text-sm leading-none font-semibold">?</span>
                      </LayerToggle>
                    </div>
                    {/* Icon pair reads as panel show/hide and swaps with
                        state; the tooltip is the pending ACTION's name. */}
                    <div className="pointer-events-auto">
                      <LayerToggle
                        label={cardMin ? "Show Card" : "Minimize Card"}
                        pressed={cardMin}
                        onToggle={() => setCardMin((v) => !v)}
                      >
                        {cardMin ? <PanelRightOpen /> : <PanelRightClose />}
                      </LayerToggle>
                    </div>
                  </div>
                </div>
              </div>
              {/* The member's details: the SAME card the columns dock shows,
                  standing beside the tree — not nested in its container.
                  Minimize Card collapses it for a chart-only dialog. */}
              {!cardMin && (
                <StandaloneEntityCard
                  entityRef={{ kind: "persona", id: focus.id }}
                  hideFamilyTree
                  actions={
                    <IconTip label="Open Full Card">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open full card in the columns"
                        onClick={() => {
                          push({ kind: "persona", id: focus.id });
                          setOpen(false);
                        }}
                      >
                        <SquareArrowOutUpRight />
                      </Button>
                    </IconTip>
                  }
                />
              )}
            </div>
          </DialogContent>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
