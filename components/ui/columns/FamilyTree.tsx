"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Network, Pin, Undo2, X } from "lucide-react";
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

// Family tree explorer v3 (user 2026-07-08): a traditional hourglass chart
// centered on a UNION, not a person — both partners' ancestries render side by
// side, so re-rooting on the partner produces the SAME chart with the
// highlight moved (the consistency rule). Couple ordering follows genogram
// convention: man left / woman right for different-gender couples, stable
// persona-id order otherwise (same-gender, nonbinary) — never click order.
// Children split remarriage-style: shared children hang from the union line's
// midpoint; a partner's children from a previous relationship hang from that
// partner's own box. Connectors are drawn in a measured SVG overlay. The
// right pane is the SAME persona card the inspector columns use
// (PersonaColumn), not a bespoke summary. See wiki research note
// research/family-tree-chart-conventions.

type GrandCouple = { people: Persona[]; childId: string };

type Side = {
  parents: Persona[]; // ordered couple, 0-2
  grandCouples: GrandCouple[]; // one per parent with known parents
  siblings: Persona[]; // of this side's partner, ordered, deduped
};

// A descendant plus their partner (if any) — the partner renders beside them
// joined by a DOTTED union line, marking who married in vs who is direct
// blood in this line (user 2026-07-08).
type Descendant = { person: Persona; partner?: Persona };

type Chart = {
  left: Persona;
  right?: Persona;
  leftSide: Side;
  rightSide?: Side;
  sharedChildren: Descendant[];
  leftOnlyChildren: Descendant[];
  rightOnlyChildren: Descendant[];
  grandchildGroups: Array<{ parentId: string; kids: Descendant[] }>;
};

function isMan(p: Persona): boolean {
  return p.genderIdentity === "cis man" || p.genderIdentity === "trans man";
}
function isWoman(p: Persona): boolean {
  return p.genderIdentity === "cis woman" || p.genderIdentity === "trans woman";
}

// Genogram convention where it applies; otherwise a stable seed-derived order
// (persona id), so the layout never depends on which partner was clicked.
function orderCouple(x: Persona, y: Persona): [Persona, Persona] {
  if (isMan(x) && isWoman(y)) return [x, y];
  if (isMan(y) && isWoman(x)) return [y, x];
  return x.id <= y.id ? [x, y] : [y, x];
}

function buildChart(indexes: EntityIndexes, focus: Persona): Chart {
  const get = (id: string) => indexes.directory.personas.get(id);
  const byRole = (p: Persona, role: string) =>
    p.family
      .filter((l) => l.role === role)
      .map((l) => get(l.personaId))
      .filter(Boolean) as Persona[];

  const partner = focus.partnerId ? get(focus.partnerId) : undefined;
  const [left, right] = partner ? orderCouple(focus, partner) : [focus, undefined];
  // Chart convention: siblings/children render oldest → youngest, left → right.
  const byAge = (list: Persona[]) => [...list].sort((a, b) => b.age - a.age);

  // One person renders exactly once — later collections skip already-placed ids.
  const seen = new Set<string>([left.id, ...(right ? [right.id] : [])]);
  const claim = (list: Persona[]) => {
    const out: Persona[] = [];
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  };

  const sideFor = (person: Persona): Side => {
    const parentsRaw = byRole(person, "parent");
    const parents =
      parentsRaw.length === 2 ? orderCouple(parentsRaw[0], parentsRaw[1]) : parentsRaw;
    const grandCouples: GrandCouple[] = [];
    for (const parent of parents) {
      const gpsRaw = byRole(parent, "parent");
      const gps = gpsRaw.length === 2 ? orderCouple(gpsRaw[0], gpsRaw[1]) : gpsRaw;
      const claimed = claim([...gps]);
      if (claimed.length) grandCouples.push({ people: claimed, childId: parent.id });
    }
    return {
      parents: claim([...parents]),
      grandCouples,
      siblings: claim(byAge(byRole(person, "sibling"))),
    };
  };

  // Grandparents before parents in claim order so both rows fill correctly.
  const leftSide = sideFor(left);
  const rightSide = right ? sideFor(right) : undefined;

  const leftKids = byRole(left, "child");
  const rightKidIds = right ? new Set(byRole(right, "child").map((p) => p.id)) : new Set<string>();
  const shared = right ? leftKids.filter((k) => rightKidIds.has(k.id)) : leftKids;
  const leftOnly = right ? leftKids.filter((k) => !rightKidIds.has(k.id)) : [];
  const rightOnly = right
    ? byRole(right, "child").filter((k) => !leftKids.some((c) => c.id === k.id))
    : [];
  // A descendant's partner joins the chart beside them (dotted union) unless
  // they already render elsewhere.
  const withPartner = (list: Persona[]): Descendant[] =>
    list.map((person) => {
      const q = person.partnerId ? get(person.partnerId) : undefined;
      if (!q || seen.has(q.id)) return { person };
      seen.add(q.id);
      return { person, partner: q };
    });
  const sharedChildren = withPartner(claim(byAge(shared)));
  const leftOnlyChildren = withPartner(claim(byAge(leftOnly)));
  const rightOnlyChildren = withPartner(claim(byAge(rightOnly)));

  const grandchildGroups: Array<{ parentId: string; kids: Descendant[] }> = [];
  for (const child of [...leftOnlyChildren, ...sharedChildren, ...rightOnlyChildren]) {
    const kids = withPartner(claim(byAge(byRole(child.person, "child"))));
    if (kids.length) grandchildGroups.push({ parentId: child.person.id, kids });
  }

  return {
    left,
    right,
    leftSide,
    rightSide,
    sharedChildren,
    leftOnlyChildren,
    rightOnlyChildren,
    grandchildGroups,
  };
}

type Seg = { x1: number; y1: number; x2: number; y2: number; dotted?: boolean };

function PersonBox({
  persona,
  focused,
  pinned,
  onSelect,
  boxRef,
}: {
  persona: Persona;
  focused: boolean;
  // The tree's entry point (the sheet that opened it) — marked with a pin,
  // reinforcing the right-aligned "Back to {name}" control (user 2026-07-08).
  pinned?: boolean;
  onSelect: () => void;
  boxRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={boxRef}
      type="button"
      onClick={onSelect}
      aria-pressed={focused}
      className={cn(
        "flex w-max flex-col items-center rounded-md border px-2.5 py-1 text-xs transition-colors",
        focused ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1 whitespace-nowrap",
          focused ? "font-semibold" : "font-medium",
        )}
      >
        {persona.givenName} {persona.familyName}
        {pinned && <Pin className="text-muted-foreground size-3 shrink-0" aria-hidden />}
      </span>
      <span className="text-muted-foreground">{persona.age}</span>
    </button>
  );
}

function FamilyChart({
  chart,
  focusId,
  originId,
  onSelect,
}: {
  chart: Chart;
  focusId: string;
  originId?: string;
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
      const box = (id: string): Box | null => {
        const el = boxRefs.current.get(id);
        return el ? rel(el) : null;
      };

      const next: Seg[] = [];
      // Union line between adjacent partners; returns the anchor children
      // hang from (line midpoint for a couple, box bottom for a single).
      // Dotted unions mark a partner who married INTO this line (descendants'
      // spouses); blood connectors stay solid.
      const coupleAnchor = (
        aId: string,
        bId?: string,
        dotted?: boolean,
      ): { x: number; y: number } | null => {
        const a = box(aId);
        if (!a) return null;
        const b = bId ? box(bId) : null;
        if (!b) return { x: a.cx, y: a.bottom };
        const [l, r] = a.cx <= b.cx ? [a, b] : [b, a];
        const y = (Math.max(l.top, r.top) + Math.min(l.bottom, r.bottom)) / 2;
        next.push({ x1: l.right + 1, y1: y, x2: r.left - 1, y2: y, dotted });
        return { x: (l.right + r.left) / 2, y };
      };
      // Drop + horizontal bus + a stub into each child's top edge.
      const connect = (anchor: { x: number; y: number } | null, kidIds: string[]) => {
        if (!anchor) return;
        const kids = kidIds.map(box).filter(Boolean) as Array<NonNullable<ReturnType<typeof box>>>;
        if (kids.length === 0) return;
        const busY = Math.min(...kids.map((k) => k.top)) - 8;
        next.push({ x1: anchor.x, y1: anchor.y, x2: anchor.x, y2: busY });
        const xs = [...kids.map((k) => k.cx), anchor.x];
        next.push({ x1: Math.min(...xs), y1: busY, x2: Math.max(...xs), y2: busY });
        for (const k of kids) next.push({ x1: k.cx, y1: busY, x2: k.cx, y2: k.top });
      };

      const sideEdges = (side: Side, self: Persona) => {
        for (const gc of side.grandCouples) {
          connect(coupleAnchor(gc.people[0].id, gc.people[1]?.id), [gc.childId]);
        }
        if (side.parents.length) {
          connect(coupleAnchor(side.parents[0].id, side.parents[1]?.id), [
            self.id,
            ...side.siblings.map((s) => s.id),
          ]);
        }
      };
      sideEdges(chart.leftSide, chart.left);
      if (chart.rightSide && chart.right) sideEdges(chart.rightSide, chart.right);

      const union = coupleAnchor(chart.left.id, chart.right?.id);
      if (chart.sharedChildren.length) {
        connect(
          union,
          chart.sharedChildren.map((c) => c.person.id),
        );
      }
      // Prior-relationship children hang from their own parent's box, not the
      // union line (remarriage split — user 2026-07-08).
      if (chart.leftOnlyChildren.length) {
        const a = box(chart.left.id);
        if (a)
          connect(
            { x: a.cx - 14, y: a.bottom },
            chart.leftOnlyChildren.map((c) => c.person.id),
          );
      }
      if (chart.rightOnlyChildren.length && chart.right) {
        const b = box(chart.right.id);
        if (b)
          connect(
            { x: b.cx + 14, y: b.bottom },
            chart.rightOnlyChildren.map((c) => c.person.id),
          );
      }
      // Descendant unions: dotted line to the married-in partner; the couple's
      // own children then hang from that union's midpoint.
      const allDescendants = [
        ...chart.leftOnlyChildren,
        ...chart.sharedChildren,
        ...chart.rightOnlyChildren,
      ];
      const descendantAnchors = new Map<string, { x: number; y: number } | null>();
      for (const d of allDescendants) {
        descendantAnchors.set(d.person.id, coupleAnchor(d.person.id, d.partner?.id, true));
      }
      for (const g of chart.grandchildGroups) {
        connect(
          descendantAnchors.get(g.parentId) ?? coupleAnchor(g.parentId),
          g.kids.map((k) => k.person.id),
        );
        for (const k of g.kids) {
          if (k.partner) coupleAnchor(k.person.id, k.partner.id, true);
        }
      }

      setSegs(next);
      setSize({ w: host.scrollWidth, h: host.scrollHeight });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [chart, focusId]);

  const renderBox = (p: Persona) => (
    <PersonBox
      key={p.id}
      persona={p}
      focused={p.id === focusId}
      pinned={p.id === originId}
      onSelect={() => onSelect(p.id)}
      boxRef={refFor(p.id)}
    />
  );
  const coupleRow = (people: Persona[]) => (
    <div className="flex items-start gap-2.5">{people.map(renderBox)}</div>
  );
  // Married-in partners sit on the OUTSIDE of the tree (user 2026-07-08): in
  // the left half of a row the partner renders before the blood member, in
  // the right half after — the blood line stays contiguous in the middle.
  const descPair = (d: Descendant, outboardLeft: boolean) => (
    <div key={d.person.id} className="flex items-start gap-2.5">
      {outboardLeft && d.partner && renderBox(d.partner)}
      {renderBox(d.person)}
      {!outboardLeft && d.partner && renderBox(d.partner)}
    </div>
  );

  const grandCouples = [
    ...chart.leftSide.grandCouples,
    ...(chart.rightSide?.grandCouples ?? []),
  ];
  const childrenRow = [
    ...chart.leftOnlyChildren,
    ...chart.sharedChildren,
    ...chart.rightOnlyChildren,
  ];

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
            strokeDasharray={s.dotted ? "2 5" : undefined}
          />
        ))}
      </svg>
      {grandCouples.length > 0 && (
        <div className="flex items-start justify-center gap-10">
          {grandCouples.map((gc) => (
            <div key={gc.childId + gc.people[0].id}>{coupleRow(gc.people)}</div>
          ))}
        </div>
      )}
      {(chart.leftSide.parents.length > 0 || (chart.rightSide?.parents.length ?? 0) > 0) && (
        <div className="flex items-start justify-center gap-16">
          {chart.leftSide.parents.length > 0 && coupleRow(chart.leftSide.parents)}
          {chart.rightSide && chart.rightSide.parents.length > 0 && coupleRow(chart.rightSide.parents)}
        </div>
      )}
      <div className="flex items-start justify-center gap-2.5">
        {[...chart.leftSide.siblings].reverse().map(renderBox)}
        {renderBox(chart.left)}
        {chart.right && renderBox(chart.right)}
        {chart.rightSide?.siblings.map(renderBox)}
      </div>
      {childrenRow.length > 0 && (
        <div className="flex items-start justify-center gap-4">
          {childrenRow.map((d, i) => descPair(d, i < (childrenRow.length - 1) / 2))}
        </div>
      )}
      {chart.grandchildGroups.length > 0 && (
        <div className="flex items-start justify-center gap-8">
          {chart.grandchildGroups.map((g, gi) => (
            <div key={g.parentId} className="flex items-start gap-4">
              {g.kids.map((d) =>
                descPair(d, gi < (chart.grandchildGroups.length - 1) / 2),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FamilyTree({ personaId, indexes }: { personaId: string; indexes: EntityIndexes }) {
  const push = useSceneStore((s) => s.pushColumn);
  // Controlled so "Open Full Card" can close programmatically — DialogClose's
  // absolute-positioning classes can't be overridden through a render prop
  // (base-ui concatenates classNames there; twMerge never sees the conflict).
  const [open, setOpen] = useState(false);
  const [focusId, setFocusId] = useState(personaId);
  // Re-root on the sheet's persona whenever the dialog is opened for a new one.
  const [prevPersonaId, setPrevPersonaId] = useState(personaId);
  if (personaId !== prevPersonaId) {
    setPrevPersonaId(personaId);
    setFocusId(personaId);
  }

  const focus = indexes.directory.personas.get(focusId) ?? indexes.directory.personas.get(personaId);
  if (!focus) return null;
  const chart = buildChart(indexes, focus);
  const origin = indexes.directory.personas.get(personaId);

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
                  (user 2026-07-08). */}
              <div className="relative flex max-h-[85vh] min-h-[26rem] w-fit min-w-[36rem] max-w-[calc(96vw-19.5rem)] flex-col overflow-auto rounded-xl border border-border bg-popover/95 p-4 text-popover-foreground shadow-lg backdrop-blur-md tabular-nums">
                <DialogClose aria-label="Close family tree">
                  <X className="size-4" />
                </DialogClose>
                <DialogTitle className="flex items-center justify-between gap-2 pr-8 text-sm font-medium text-foreground">
                  <span>The {focus.familyName} Family</span>
                  {origin && focus.id !== origin.id && (
                    <button
                      type="button"
                      onClick={() => setFocusId(origin.id)}
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-normal"
                    >
                      Back to {origin.givenName}
                      <Undo2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </DialogTitle>
                <FamilyChart
                  chart={chart}
                  focusId={focus.id}
                  originId={origin?.id}
                  onSelect={setFocusId}
                />
                {focus.offstage.length > 0 && (
                  <div className="px-3 pb-1 text-xs text-muted-foreground">
                    Elsewhere: {focus.offstage.map((rel) => `${rel.name} (${rel.role})`).join(" · ")}
                  </div>
                )}
              </div>
              {/* The member's details: the SAME card the columns dock shows,
                  standing beside the tree — not nested in its container. */}
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
            </div>
          </DialogContent>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
