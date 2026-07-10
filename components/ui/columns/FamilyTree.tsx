"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  Blend,
  Maximize2,
  Network,
  Palette,
  PanelRightClose,
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
import { buildFamilyWeb, type FamilyWeb, type UnionNode } from "./familyWeb";

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
// (user 2026-07-10: "red + green = yellow", done perceptually). Union lines
// follow genogram semantics (genopro.com/genogram/family-relationships):
// married = solid, dating = dashed. Display layers (Lineage Colors, Gender
// Tint) and Minimize Card are dialog-local toggles — colors only, never
// layout. The right pane is the SAME persona card the inspector columns use
// (PersonaColumn), not a bespoke summary.

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

type Seg = { x1: number; y1: number; x2: number; y2: number; dashed?: boolean };

// Gender Tint layer: subtle desaturated oklch backgrounds by identity —
// alpha kept low (~11%) so borders and lineage stripes still dominate; the
// gender icon remains the primary signal (user 2026-07-10).
function genderTintCss(identity: Persona["genderIdentity"]): string {
  const hue =
    identity === "cis man" || identity === "trans man"
      ? 240
      : identity === "cis woman" || identity === "trans woman"
        ? 40
        : 150;
  return `oklch(0.7 0.07 ${hue} / 0.11)`;
}

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
  // Gender Tint background; undefined when the layer is off or the box is
  // focused (the primary tint wins there). Colors only — never layout.
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
        // pixel (user 2026-07-10: "borders inside the rect").
        "flex w-max flex-col items-center rounded-md border px-2.5 py-1 text-xs transition-colors",
        blood ? "border-solid" : "border-dashed",
        focused
          ? "border-primary bg-primary/10"
          : "border-muted-foreground/80 bg-background hover:bg-muted",
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
  onSelect,
}: {
  web: FamilyWeb;
  focusId: string;
  originId?: string;
  lineage: boolean;
  tint: boolean;
  onSelect: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxRefs = useRef(new Map<string, HTMLButtonElement>());
  const [segs, setSegs] = useState<Seg[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const refFor = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) boxRefs.current.set(id, el);
    else boxRefs.current.delete(id);
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      // Union block wrappers are found by data attribute (not a ref map —
      // ref access during render trips react-hooks/refs).
      const blockEls = new Map<string, HTMLElement>();
      for (const el of host.querySelectorAll<HTMLElement>("[data-block-key]")) {
        blockEls.set(el.dataset.blockKey as string, el);
      }
      // Natural-layout read: clear transforms from a previous pass first.
      // Transforms never affect layout, so this cannot loop the observer.
      for (const el of blockEls.values()) el.style.transform = "";

      const hostRect = host.getBoundingClientRect();
      type Box = { left: number; right: number; top: number; bottom: number; cx: number };
      const rel = (el: HTMLElement): Box => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left - hostRect.left,
          right: r.right - hostRect.left,
          top: r.top - hostRect.top,
          bottom: r.bottom - hostRect.top,
          cx: r.left - hostRect.left + r.width / 2,
        };
      };
      // Pending translateX per repositioned person. box() folds it in, so
      // connector math and the applied transforms always agree.
      const shiftFor = new Map<string, number>();
      const box = (id: string): Box | null => {
        const el = boxRefs.current.get(id);
        if (!el) return null;
        const r = rel(el);
        const dx = shiftFor.get(id) ?? 0;
        return dx ? { ...r, left: r.left + dx, right: r.right + dx, cx: r.cx + dx } : r;
      };

      // Bottom-up placement: the DEEPEST row keeps its natural flex layout
      // (already in data order); every row above packs its union blocks over
      // the mean x of their children in the (already positioned) rows below.
      // Row order is semantic (data-driven), so packRow runs in row order —
      // blocks are NOT re-sorted by target. Childless unions target their
      // natural spot so they stay by their siblings. Pure function of data +
      // layout — no focus dependence (user 2026-07-10).
      for (let r = web.rows.length - 2; r >= 0; r -= 1) {
        const calc = web.rows[r].flatMap((u) => {
          const el = blockEls.get(u.key);
          if (!el) return [];
          const rect = rel(el);
          const kids = u.childIds.map(box).filter(Boolean) as Box[];
          const target = kids.length
            ? kids.reduce((s, k) => s + k.cx, 0) / kids.length
            : rect.cx;
          return [{ u, el, rect, target }];
        });
        if (calc.length === 0) continue;
        const widths = calc.map((c) => c.rect.right - c.rect.left);
        const lefts = packRow(
          calc.map((c, i) => ({ desired: c.target - widths[i] / 2, width: widths[i] })),
          24,
        );
        // Clamp the packed row into the host; if it cannot fit, prefer
        // anchoring its left edge (right overflow scrolls, left would not).
        const minLeft = Math.min(...lefts);
        let shift = Math.max(0, -minLeft);
        const over = Math.max(...lefts.map((l, i) => l + widths[i])) + shift - hostRect.width;
        if (over > 0) shift = Math.max(shift - over, -minLeft);
        calc.forEach((c, i) => {
          const dx = lefts[i] + shift - c.rect.left;
          for (const m of c.u.members) shiftFor.set(m.id, dx);
          c.el.style.transform = dx ? `translateX(${dx}px)` : "";
        });
      }

      const next: Seg[] = [];
      // Union line between adjacent partners; returns the anchor children
      // hang from (line midpoint for a couple, box bottom for a single).
      // Genogram semantics: married = solid, dating = dashed.
      const coupleAnchor = (
        aId: string,
        bId?: string,
        dashed?: boolean,
      ): { x: number; y: number } | null => {
        const a = box(aId);
        if (!a) return null;
        const b = bId ? box(bId) : null;
        if (!b) return { x: a.cx, y: a.bottom };
        const [l, r] = a.cx <= b.cx ? [a, b] : [b, a];
        const y = (Math.max(l.top, r.top) + Math.min(l.bottom, r.bottom)) / 2;
        next.push({ x1: l.right + 1, y1: y, x2: r.left - 1, y2: y, dashed });
        return { x: (l.right + r.left) / 2, y };
      };
      // Parent→children connections are gathered first and emitted per
      // child-row below, so buses that would overlap on the same y can take
      // separate lanes.
      type Conn = { anchor: { x: number; y: number }; kids: Box[] };
      const pending: Conn[] = [];
      const connect = (anchor: { x: number; y: number } | null, kidIds: string[]) => {
        if (!anchor) return;
        const kids = kidIds.map(box).filter(Boolean) as Box[];
        if (kids.length > 0) pending.push({ anchor, kids });
      };

      for (const row of web.rows) {
        for (const u of row) {
          const anchor = coupleAnchor(u.members[0].id, u.members[1]?.id, u.dashed);
          if (u.sharedChildIds.length > 0) connect(anchor, u.sharedChildIds);
          // Prior-relationship children hang from their own parent's box,
          // not the union line (remarriage split — user 2026-07-08).
          for (const solo of u.soloChildIds) {
            const m = box(solo.memberId);
            if (!m) continue;
            const isLeftMember = u.members.length === 2 && solo.memberId === u.members[0].id;
            connect({ x: m.cx + (isLeftMember ? -14 : 14), y: m.bottom }, solo.kids);
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
        const key = Math.round(Math.min(...c.kids.map((k) => k.top)));
        busRows.set(key, [...(busRows.get(key) ?? []), c]);
      }
      for (const rowTop of [...busRows.keys()].sort((a, b) => a - b)) {
        const conns = (busRows.get(rowTop) as Conn[])
          .map((c) => {
            const xs = c.kids.map((k) => k.cx);
            return {
              ...c,
              x1: Math.min(...xs, c.anchor.x),
              x2: Math.max(...xs, c.anchor.x),
            };
          })
          .sort(
            (p, q) => p.x2 - p.x1 - (q.x2 - q.x1) || p.x1 - q.x1 || p.anchor.x - q.anchor.x,
          );
        const lanes: Array<Array<{ x1: number; x2: number }>> = [];
        for (const c of conns) {
          let lane = 0;
          while ((lanes[lane] ?? []).some((s) => c.x1 <= s.x2 + 10 && s.x1 - 10 <= c.x2)) lane += 1;
          (lanes[lane] ??= []).push({ x1: c.x1, x2: c.x2 });
          const busY = rowTop - 8 - lane * 7;
          next.push({ x1: c.anchor.x, y1: c.anchor.y, x2: c.anchor.x, y2: busY });
          if (c.x2 - c.x1 > 0.5) next.push({ x1: c.x1, y1: busY, x2: c.x2, y2: busY });
          for (const k of c.kids) next.push({ x1: k.cx, y1: busY, x2: k.cx, y2: k.top });
        }
      }

      setSegs(next);
      setSize({ w: host.scrollWidth, h: host.scrollHeight });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [web, focusId]);

  const renderBox = (p: Persona) => (
    <PersonBox
      key={p.id}
      persona={p}
      focused={p.id === focusId}
      blood={web.bloodIds.has(p.id)}
      pinned={p.id === originId}
      stripe={lineage ? web.stripes.get(p.id) : undefined}
      tint={tint && p.id !== focusId ? genderTintCss(p.genderIdentity) : undefined}
      onSelect={() => onSelect(p.id)}
      boxRef={refFor(p.id)}
    />
  );
  // One union = one glued block (couple or single), the unit the measure
  // pass repositions. Flex only provides the initial layout; the packing
  // above centers each block over its own children (user 2026-07-10).
  const renderUnion = (u: UnionNode) => (
    <div key={u.key} data-block-key={u.key} className="flex items-start gap-2.5">
      {u.members.map(renderBox)}
    </div>
  );

  return (
    <div
      ref={hostRef}
      className="relative flex w-max min-w-full flex-1 flex-col items-center justify-center gap-9 p-3"
    >
      <svg
        className="text-muted-foreground/80 pointer-events-none absolute top-0 left-0"
        width={size.w}
        height={size.h}
        aria-hidden
      >
        {segs.map((s, i) => (
          <line
            key={i}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={s.dashed ? "2 5" : undefined}
          />
        ))}
      </svg>
      {web.rows.map((row, i) => (
        <div key={row[0]?.key ?? i} className="flex items-start justify-center gap-4">
          {row.map(renderUnion)}
        </div>
      ))}
    </div>
  );
}

// Header layer toggle — icon button following the app's icon-toggle
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
  // Re-root on the sheet's persona whenever the dialog is opened for a new one.
  const [prevPersonaId, setPrevPersonaId] = useState(personaId);
  if (personaId !== prevPersonaId) {
    setPrevPersonaId(personaId);
    setFocusId(personaId);
  }

  const focus = indexes.directory.personas.get(focusId) ?? indexes.directory.personas.get(personaId);
  if (!focus) return null;
  const web = buildFamilyWeb(indexes, focus);
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
              <div className="relative flex max-h-[85vh] min-h-[30rem] w-fit min-w-[44rem] max-w-[calc(96vw-19.5rem)] flex-col overflow-auto rounded-xl border border-border bg-popover/95 p-4 text-popover-foreground shadow-lg backdrop-blur-md tabular-nums">
                {/* One header row — title left; layer toggles + back control
                    + X share the right cluster so they align on the same
                    vertical center (user 2026-07-08: the absolute X sat off
                    the title line). */}
                {/* w-0 min-w-full: the header sizes to the panel (whose width
                    the CHART drives) and truncates internally — a long title
                    ("The {surname} Family" changes with the focus) can never
                    widen the panel on selection (user 2026-07-10). */}
                <div className="flex w-0 min-w-full items-center justify-between gap-3">
                  <DialogTitle className="truncate text-sm font-medium text-foreground">
                    The {focus.familyName} Family
                  </DialogTitle>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
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
                        label="Minimize Card"
                        pressed={cardMin}
                        onToggle={() => setCardMin((v) => !v)}
                      >
                        <PanelRightClose />
                      </LayerToggle>
                    </div>
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
                <FamilyChart
                  web={web}
                  focusId={focus.id}
                  originId={origin?.id}
                  lineage={lineage}
                  tint={tintOn}
                  onSelect={setFocusId}
                />
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
