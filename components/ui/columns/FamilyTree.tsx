"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Network, X } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSceneStore } from "@/lib/state/sceneStore";
import type { Persona } from "@/lib/seed/personas";
import type { EntityIndexes } from "./entityData";
import { IconTip } from "./EntityColumns";
import { PersonaColumn } from "./PersonaColumn";

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

type Chart = {
  left: Persona;
  right?: Persona;
  leftSide: Side;
  rightSide?: Side;
  sharedChildren: Persona[];
  leftOnlyChildren: Persona[];
  rightOnlyChildren: Persona[];
  grandchildGroups: Array<{ parentId: string; kids: Persona[] }>;
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
  const sharedChildren = claim(byAge(shared));
  const leftOnlyChildren = claim(byAge(leftOnly));
  const rightOnlyChildren = claim(byAge(rightOnly));

  const grandchildGroups: Array<{ parentId: string; kids: Persona[] }> = [];
  for (const child of [...leftOnlyChildren, ...sharedChildren, ...rightOnlyChildren]) {
    const kids = claim(byAge(byRole(child, "child")));
    if (kids.length) grandchildGroups.push({ parentId: child.id, kids });
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

type Seg = { x1: number; y1: number; x2: number; y2: number };

function PersonBox({
  persona,
  focused,
  onSelect,
  boxRef,
}: {
  persona: Persona;
  focused: boolean;
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
      <span className={cn("whitespace-nowrap", focused ? "font-semibold" : "font-medium")}>
        {persona.givenName} {persona.familyName}
      </span>
      <span className="text-muted-foreground">{persona.age}</span>
    </button>
  );
}

function FamilyChart({
  chart,
  focusId,
  onSelect,
}: {
  chart: Chart;
  focusId: string;
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
      const coupleAnchor = (aId: string, bId?: string): { x: number; y: number } | null => {
        const a = box(aId);
        if (!a) return null;
        const b = bId ? box(bId) : null;
        if (!b) return { x: a.cx, y: a.bottom };
        const [l, r] = a.cx <= b.cx ? [a, b] : [b, a];
        const y = (Math.max(l.top, r.top) + Math.min(l.bottom, r.bottom)) / 2;
        next.push({ x1: l.right + 1, y1: y, x2: r.left - 1, y2: y });
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
          chart.sharedChildren.map((c) => c.id),
        );
      }
      // Prior-relationship children hang from their own parent's box, not the
      // union line (remarriage split — user 2026-07-08).
      if (chart.leftOnlyChildren.length) {
        const a = box(chart.left.id);
        if (a)
          connect(
            { x: a.cx - 14, y: a.bottom },
            chart.leftOnlyChildren.map((c) => c.id),
          );
      }
      if (chart.rightOnlyChildren.length && chart.right) {
        const b = box(chart.right.id);
        if (b)
          connect(
            { x: b.cx + 14, y: b.bottom },
            chart.rightOnlyChildren.map((c) => c.id),
          );
      }
      for (const g of chart.grandchildGroups) {
        connect(
          coupleAnchor(g.parentId),
          g.kids.map((k) => k.id),
        );
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
      onSelect={() => onSelect(p.id)}
      boxRef={refFor(p.id)}
    />
  );
  const coupleRow = (people: Persona[]) => (
    <div className="flex items-start gap-2.5">{people.map(renderBox)}</div>
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
    <div ref={hostRef} className="relative flex w-max min-w-full flex-col items-center gap-9 p-3">
      <svg
        className="text-border pointer-events-none absolute top-0 left-0"
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
            strokeWidth={1}
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
        <div className="flex items-start justify-center gap-2.5">{childrenRow.map(renderBox)}</div>
      )}
      {chart.grandchildGroups.length > 0 && (
        <div className="flex items-start justify-center gap-8">
          {chart.grandchildGroups.map((g) => (
            <div key={g.parentId} className="flex items-start gap-2.5">
              {g.kids.map(renderBox)}
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
        <DialogPopup>
          <DialogContent className="max-h-[85vh] w-full max-w-5xl gap-3 overflow-hidden border-border bg-popover p-5 text-popover-foreground tabular-nums">
            <DialogClose aria-label="Close family tree">
              <X className="size-4" />
            </DialogClose>
            <DialogTitle className="text-sm font-medium text-foreground">
              The {focus.familyName} Family
              {origin && focus.id !== origin.id && (
                <button
                  type="button"
                  onClick={() => setFocusId(origin.id)}
                  className="ml-2 text-xs font-normal text-muted-foreground hover:underline"
                >
                  back to {origin.givenName}
                </button>
              )}
            </DialogTitle>
            <div className="flex min-h-0 gap-4">
              {/* Left: the hourglass chart. Clicking a box re-roots on them. */}
              <div className="max-h-[68vh] min-w-0 flex-1 overflow-auto">
                <FamilyChart chart={chart} focusId={focus.id} onSelect={setFocusId} />
                {focus.offstage.length > 0 && (
                  <div className="px-3 pb-2 text-xs text-muted-foreground">
                    Elsewhere: {focus.offstage.map((rel) => `${rel.name} (${rel.role})`).join(" · ")}
                  </div>
                )}
              </div>
              {/* Right: the SAME persona card the inspector columns show. */}
              <div className="flex w-80 shrink-0 flex-col border-l border-border pl-4">
                <div className="text-sm font-medium">{focus.fullName}</div>
                <ScrollArea className="mt-1.5 **:data-[slot=scroll-area-viewport]:max-h-[58vh]">
                  <div className="flex flex-col gap-2.5 pr-3">
                    <PersonaColumn id={focus.id} part="pinned" hideFamilyTree />
                    <Separator />
                    <PersonaColumn id={focus.id} part="rest" hideFamilyTree />
                  </div>
                </ScrollArea>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2 self-start"
                  onClick={() => {
                    push({ kind: "persona", id: focus.id });
                    setOpen(false);
                  }}
                >
                  Open Full Card
                </Button>
              </div>
            </div>
          </DialogContent>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
