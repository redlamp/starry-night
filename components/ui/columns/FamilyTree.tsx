"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  Blend,
  Fan,
  Maximize2,
  Network,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Pin,
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
// their final left-to-right order with desired left edges; output: left
// edges that preserve that order with at least `gap` between blocks while
// staying collectively as close to the desired positions as possible —
// "keeping each as close to its target as the packing allows" (user
// 2026-07-10). In prefix-space (subtract the cumulative width+gap ahead of
// each block) the min-gap constraint becomes plain "non-decreasing", so the
// closest fit is isotonic regression: pool adjacent blocks while they
// violate, place each pool at its mean.
function packRow(items: Array<{ desired: number; width: number }>, gap: number): number[] {
  const prefix: number[] = [];
  let acc = 0;
  for (const it of items) {
    prefix.push(acc);
    acc += it.width + gap;
  }
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
  stripe,
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
  // Lineage stripe: CSS background (solid root hue, or a left→right
  // gradient where two lines merged) for the constant-height 2px bar atop
  // the box. Undefined (married-in, or Lineage Colors off) renders the bar
  // transparent — the slot always exists, so toggling the layer never
  // changes layout (user 2026-07-10).
  stripe?: string;
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
      style={tint ? { backgroundColor: tint } : undefined}
      className={cn(
        // Border WIDTH is constant across every state (focused / blood /
        // non-blood / hover) — only color and style (solid vs dashed)
        // change — so selecting or re-rooting never reflows a box by even a
        // pixel (user 2026-07-10: "borders inside the rect"). The focused
        // box reads THICKER via an inset ring (box-shadow — zero layout)
        // and keeps the same background as everyone else (user 2026-07-10:
        // gender tint stays visible on the selection).
        "flex w-max flex-col items-center rounded-md border px-2.5 py-1 text-xs transition-colors",
        blood ? "border-solid" : "border-dashed",
        "bg-background hover:bg-muted",
        focused ? "border-primary ring-2 ring-primary ring-inset" : "border-muted-foreground/80",
      )}
    >
      <span
        aria-hidden
        className="mb-0.5 h-0.5 w-full rounded-full"
        style={{ background: stripe ?? "transparent" }}
      />
      {/* Weight is CONSTANT — semibold-on-focus made the name (and so the
          content-sized box, row, and w-fit panel) wider on every selection
          (user 2026-07-10: "divs changing size"). Focus reads from the
          primary border + tint alone. */}
      <span className="flex items-center gap-1 font-medium whitespace-nowrap">
        {persona.givenName} {persona.familyName}
        {pinned && <Pin className="text-muted-foreground size-3 shrink-0" aria-hidden />}
      </span>
      {/* Same row: gender icon left, age right (user 2026-07-10). */}
      <span className="flex w-full items-center justify-between gap-2">
        <GenderIcon identity={persona.genderIdentity} className="text-muted-foreground size-3" />
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The un-transformed layout root: flex lays rows out here, blocks shift
  // within it, and the normalize step translates/scales it as one unit so
  // boxes and connectors always move together.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const boxRefs = useRef(new Map<string, HTMLButtonElement>());
  const [segs, setSegs] = useState<Seg[]>([]);
  // Fitted content-box size (w/h drive the sized wrapper; svgW/svgH the
  // overlay's nominal size — it draws outside via overflow-visible).
  const [view, setView] = useState({ w: 0, h: 0, svgW: 0, svgH: 0 });

  const refFor = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) boxRefs.current.set(id, el);
    else boxRefs.current.delete(id);
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
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
      // (blocks AND the normalize/fit transform on the content root).
      // Transforms never affect layout, so this cannot loop the observer.
      for (const el of blockEls.values()) el.style.transform = "";
      contentEl.style.transform = "";

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
      const packGap = vertical ? 14 : 24;
      const packToward = (row: UnionNode[], targetFor: (u: UnionNode, cur: Box) => number) => {
        const calc = row.flatMap((u) => {
          const cur = blockBox(u);
          return cur ? [{ u, cur, target: targetFor(u, cur) }] : [];
        });
        if (calc.length === 0) return;
        const widths = calc.map((c) => packE(c.cur) - packS(c.cur));
        const lefts = packRow(
          calc.map((c, i) => ({ desired: c.target - widths[i] / 2, width: widths[i] })),
          packGap,
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
      passUp();
      passDown();
      passUp();
      passDown();

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
      ): { p: number; g: number } | null => {
        const a = box(aId);
        if (!a) return null;
        const b = bId ? box(bId) : null;
        if (!b) return { p: packC(a), g: genE(a) };
        const [l, r] = packC(a) <= packC(b) ? [a, b] : [b, a];
        const g = (Math.max(genS(l), genS(r)) + Math.min(genE(l), genE(r))) / 2;
        next.push(toSeg(packE(l) + 1, g, packS(r) - 1, g, dashed, color));
        return { p: (packE(l) + packS(r)) / 2, g };
      };
      // Parent→children connections are gathered first and emitted per
      // child-row below, so buses that would overlap at the same gen-axis
      // offset can take separate lanes.
      type Conn = { anchor: { p: number; g: number }; kids: Box[]; color?: string };
      const pending: Conn[] = [];
      const connect = (
        anchor: { p: number; g: number } | null,
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
            connect({ p: packC(m) + (isFirst ? -14 : 14), g: genE(m) }, solo.kids, u.lineColor);
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
        const lanes: Array<Array<{ p1: number; p2: number }>> = [];
        for (const c of conns) {
          let lane = 0;
          while ((lanes[lane] ?? []).some((s) => c.p1 <= s.p2 + 10 && s.p1 - 10 <= c.p2)) lane += 1;
          (lanes[lane] ??= []).push({ p1: c.p1, p2: c.p2 });
          const busG = rowG - 8 - lane * 7;
          const color = c.color;
          next.push(toSeg(c.anchor.p, c.anchor.g, c.anchor.p, busG, undefined, color));
          if (c.p2 - c.p1 > 0.5) next.push(toSeg(c.p1, busG, c.p2, busG, undefined, color));
          for (const k of c.kids) {
            next.push(toSeg(packC(k), busG, packC(k), genS(k), undefined, color));
          }
        }
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

      // NORMALIZE + FIT (user 2026-07-10: "no horizontal scroll despite
      // fitting", "adjust to fit the vertical size"). The flex layout
      // centers content naturally, then the pack shifts move blocks — which
      // extends the scrollable bounds without shrinking the stale w-max
      // extents (phantom scroll + dead margins). Fix: translate the whole
      // content root so the actual bounding box starts at the padding, and
      // size an explicit wrapper to exactly that box. Then, if the content
      // is taller than the panel's available chart region, scale the root
      // down to fit — boxes and SVG scale together — with a 0.65 floor so
      // text stays legible (below the floor, scrolling returns).
      const pad = 12;
      const w0 = maxX - minX + pad * 2;
      const h0 = maxY - minY + pad * 2;
      // Available chart height = the panel's height cap minus its fixed
      // rows (header/footer/controls) and vertical padding+border. Derived
      // from the caps, not the live shell size, so the result can't feed
      // back into itself through the ResizeObserver.
      const panel = host.parentElement;
      let fixedH = 0;
      if (panel) {
        for (const child of panel.children) {
          if (child !== host) fixedH += (child as HTMLElement).offsetHeight;
        }
      }
      const panelCap = Math.max(480, window.innerHeight * 0.85); // min-h-[30rem] / max-h-[85vh]
      const avail = Math.max(160, panelCap - fixedH - 34);
      const scale = h0 > avail ? Math.max(0.65, avail / h0) : 1;
      // Right-to-left application: translate in natural coords, then scale
      // about the top-left origin.
      contentEl.style.transform = `scale(${scale}) translate(${pad - minX}px, ${pad - minY}px)`;

      setSegs(next);
      setView({
        w: w0 * scale,
        h: h0 * scale,
        svgW: Math.max(0, maxX),
        svgH: Math.max(0, maxY),
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [web, focusId, vertical]);

  const renderBox = (p: Persona) => (
    <PersonBox
      key={p.id}
      persona={p}
      focused={p.id === focusId}
      blood={web.bloodIds.has(p.id)}
      pinned={p.id === originId}
      stripe={lineage ? web.stripes.get(p.id) : undefined}
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
      className={cn("flex gap-2.5", vertical ? "flex-col items-start" : "items-start")}
    >
      {u.members.map(renderBox)}
    </div>
  );

  return (
    // Shell: the chart's OWN scroll viewport (user 2026-07-10: header and
    // footer rows stay fixed; only the tree scrolls) — min-h-0 caps it at
    // the flex slot, overflow-auto scrolls internally when even the
    // 0.65-scale floor cannot fit. The sized wrapper is the ONLY element
    // contributing layout size (exactly the normalized+scaled content box —
    // no phantom scroll from stale w-max extents or transform overflow);
    // m-auto (not items-center) centers it when smaller AND keeps all edges
    // scroll-reachable when larger — centered flex content clips its
    // overflowing top. The content root inside is absolute, laid out at
    // natural size, then translated/scaled by the measure pass.
    <div ref={hostRef} className="flex min-h-0 flex-1 overflow-auto">
      <div className="relative m-auto shrink-0" style={{ width: view.w, height: view.h }}>
        <div
          ref={contentRef}
          className={cn(
            "absolute top-0 left-0 flex w-max origin-top-left items-center justify-center",
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
  );
}

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
  const [lineage, setLineage] = useState(true);
  const [tintOn, setTintOn] = useState(false);
  const [cardMin, setCardMin] = useState(false);
  // Display mode (user 2026-07-10): Rows = the web chart, Columns = the
  // same chart transposed (generations as columns — often a better fit for
  // the panel with 3-4 generations), Fan = the bow-tie blood-lineage fan.
  const [mode, setMode] = useState<"rows" | "columns" | "fan">("rows");
  // Re-root on the sheet's persona whenever the dialog is opened for a new one.
  const [prevPersonaId, setPrevPersonaId] = useState(personaId);
  if (personaId !== prevPersonaId) {
    setPrevPersonaId(personaId);
    setFocusId(personaId);
  }

  const focus = indexes.directory.personas.get(focusId) ?? indexes.directory.personas.get(personaId);
  if (!focus) return null;
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
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Open family tree">
              <Network />
            </Button>
          }
        />
      </IconTip>
      <DialogPortal>
        <DialogBackdrop />
        {/* Top-anchored (not centered): the panels keep the SAME Y as the
            tree grows/shrinks between re-roots, so the resident card never
            bounces (user 2026-07-08). */}
        <DialogPopup className="items-start pt-[6vh]">
          <DialogContent className="w-fit max-w-[96vw] border-0 bg-transparent p-0 shadow-none">
            <div className="flex items-start gap-3">
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
              <div className="relative flex max-h-[85vh] min-h-[30rem] w-fit min-w-[44rem] max-w-[calc(96vw-19.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover/95 p-4 text-popover-foreground shadow-lg backdrop-blur-md tabular-nums">
                {/* One header row — title left; back control + X share the
                    right cluster so they align on the same vertical center
                    (user 2026-07-08: the absolute X sat off the title line).
                    Layer toggles live in the bottom controls row (user
                    2026-07-10). */}
                {/* w-0 min-w-full: the header sizes to the panel (whose width
                    the CHART drives) and truncates internally — a long title
                    ("The {surname} Family" changes with the focus) can never
                    widen the panel on selection (user 2026-07-10). */}
                <div className="flex w-0 min-w-full items-center justify-between gap-3">
                  <DialogTitle className="truncate text-sm font-medium text-foreground">
                    The {focus.familyName} Family
                  </DialogTitle>
                  <div className="flex items-center gap-2">
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
                {/* Fixed-height slot, rendered whether or not there's
                    content: FamilyChart above is flex-1 and centers its own
                    rows within whatever space is left, so any change in this
                    footer's height (wrapping, or appearing/disappearing
                    between empty and non-empty) would re-center — and
                    visibly shift — the whole chart. Single line, truncated,
                    never wraps (user 2026-07-10). */}
                <div className="h-5 shrink-0 truncate px-3 text-xs text-muted-foreground">
                  {footerBits.join(" · ")}
                </div>
                {/* Fixed-height controls row (always rendered, constant
                    height like the footer slot above, so the chart never
                    shifts): layer toggles bottom-left, the resident-card
                    show/hide bottom-right (user 2026-07-10). */}
                <div className="flex h-8 shrink-0 items-center justify-between">
                  <div className="flex items-center gap-1">
                    {/* 3-way display-mode cluster — exactly one active
                        (user 2026-07-10: rows / columns / fan). */}
                    {/* Network glyph reads as the tree itself: upright for
                        rows, rotated 90° CCW for columns so the flow arrow
                        matches each mode's direction (user 2026-07-10). */}
                    <LayerToggle
                      label="Row View"
                      pressed={mode === "rows"}
                      onToggle={() => setMode("rows")}
                    >
                      <Network />
                    </LayerToggle>
                    <LayerToggle
                      label="Column View"
                      pressed={mode === "columns"}
                      onToggle={() => setMode("columns")}
                    >
                      <Network className="-rotate-90" />
                    </LayerToggle>
                    <LayerToggle
                      label="Fan View"
                      pressed={mode === "fan"}
                      onToggle={() => setMode("fan")}
                    >
                      <Fan />
                    </LayerToggle>
                    <div className="bg-border mx-1 h-4 w-px" aria-hidden />
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
                  </div>
                  {/* Icon pair reads as panel show/hide and swaps with
                      state; the tooltip is the pending ACTION's name. */}
                  <LayerToggle
                    label={cardMin ? "Show Card" : "Minimize Card"}
                    pressed={cardMin}
                    onToggle={() => setCardMin((v) => !v)}
                  >
                    {cardMin ? <PanelRightOpen /> : <PanelRightClose />}
                  </LayerToggle>
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
                        <Maximize2 />
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
